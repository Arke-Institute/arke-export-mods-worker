# MODS Export Worker - Fly.io Ephemeral Machine

Ephemeral worker for exporting Arke entities to MODS 3.8 XML format and uploading to R2 storage.

## Architecture

This worker follows the **ephemeral worker pattern**:

1. **Orchestrator** (Cloudflare Worker) spawns a Fly.io machine via Machines API
2. **Worker** receives configuration via environment variables
3. **Worker** exports MODS XML to local temp file
4. **Worker** uploads file to R2 storage
5. **Worker** sends callback to orchestrator with R2 key
6. **Worker** exits (machine auto-destroys)
7. **Orchestrator** streams file from R2 to client

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  Orchestrator   │──1───▶│  Fly.io Worker  │──3───▶│   R2 Storage    │
│ (CF Worker)     │◀──2───│  (Ephemeral)    │       │                 │
└─────────────────┘       └─────────────────┘       └─────────────────┘
         │                                                      │
         └──────────────────4. Stream to client────────────────┘

1. Spawn machine with env vars
2. Callback with R2 key
3. Upload MODS XML
4. Stream from R2
```

## Environment Variables

The orchestrator must provide these via Fly Machines API:

### Required

```bash
# Task identification
TASK_ID="export_mods_abc123"
PI="01K9XVBAQZF9EHDRXGBEADTZYY"

# Export options (JSON string)
EXPORT_OPTIONS='{"recursive":true,"maxDepth":10,"parallelBatchSize":10}'

# R2 credentials
R2_ACCOUNT_ID="..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET="arke-exports"

# Callback URL
CALLBACK_URL="https://orchestrator.workers.dev/callback/export_mods_abc123"
```

### Optional

```bash
BATCH_ID="batch_xyz"              # For batch operations
EXPORT_FORMAT="mods"              # Future: "dc", "marcxml"
```

### Automatic

```bash
FLY_MACHINE_ID="machine_12345"   # Provided by Fly.io
```

## Export Options

The `EXPORT_OPTIONS` JSON string supports:

```typescript
{
  "recursive": true,              // Export entire subtree as collection
  "maxDepth": 10,                 // Maximum recursion depth
  "parallelBatchSize": 10,        // Entities to process in parallel
  "includeOcr": true,             // Include OCR text from .ref.json
  "cheimarrosMode": "full"        // full | minimal | skip
}
```

## Callback Contract

### Success Callback

```json
POST ${CALLBACK_URL}

{
  "task_id": "export_mods_abc123",
  "batch_id": "single",
  "status": "success",
  "output_r2_key": "exports/export_mods_abc123/01K9...-collection.xml",
  "output_file_name": "01K9XVBAQZF9EHDRXGBEADTZYY-collection.xml",
  "output_file_size": 1748234,
  "metrics": {
    "total_time_ms": 2934,
    "entities_exported": 72,
    "entities_failed": 0,
    "peak_memory_mb": 30
  }
}
```

### Error Callback

```json
POST ${CALLBACK_URL}

{
  "task_id": "export_mods_abc123",
  "batch_id": "single",
  "status": "error",
  "error": "Failed to fetch manifest for PI 01K9...: 404 Not Found"
}
```

## Local Testing

### 1. Install Dependencies

```bash
cd arke-mods-export-worker
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with real R2 credentials and test PI
```

### 3. Run Locally

```bash
npm run dev
```

Expected output:
```
============================================================
[local] MODS Export Worker Started
============================================================
Task ID:       local_test_1
PI:            01K9XVBAQZF9EHDRXGBEADTZYY
Recursive:     true
Max Depth:     10
...
============================================================
EXPORT COMPLETE
============================================================
Total time:    2.93s
Entities:      72
File size:     1.71 MB
R2 key:        exports/local_test_1/01K9...-collection.xml
============================================================
```

### 4. Verify R2 Upload

Check your R2 bucket for the exported file:
- Path: `exports/local_test_1/01K9XVBAQZF9EHDRXGBEADTZYY-collection.xml`
- Size: ~1.7MB
- Content-Type: `application/xml`

### 5. Check Callback

If you set `CALLBACK_URL=https://webhook.site/...`, check webhook.site for the callback payload.

## Deployment to Fly.io

### Initial Setup

```bash
# 1. Login to Fly.io
fly auth login

# 2. Create app
fly apps create arke-mods-export-worker

# 3. Set R2 credentials as secrets
fly secrets set \
  R2_ACCOUNT_ID=your_account_id \
  R2_ACCESS_KEY_ID=your_access_key \
  R2_SECRET_ACCESS_KEY=your_secret_key \
  --app arke-mods-export-worker
```

### Build and Push Docker Image

**Recommended: Use the deploy script**
```bash
# Builds and tags as 'production' automatically
./deploy.sh
```

**Or manually:**
```bash
# Build and tag as 'production'
fly deploy --build-only --push --remote-only --image-label production --app arke-mods-export-worker
```

This creates the Docker image with a consistent tag:
```
registry.fly.io/arke-mods-export-worker:production
```

**In your orchestrator, always use:**
```typescript
image: 'registry.fly.io/arke-mods-export-worker:production'
```

### Test via Machines API

```bash
# Get Fly API token
fly auth token

# Spawn ephemeral machine for testing
curl -X POST \
  "https://api.machines.dev/v1/apps/arke-mods-export-worker/machines" \
  -H "Authorization: Bearer $FLY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "image": "registry.fly.io/arke-mods-export-worker:latest",
      "env": {
        "TASK_ID": "test_123",
        "PI": "01K9Z3K4GMDWTT0VQXYSPC9W6S",
        "EXPORT_OPTIONS": "{\"recursive\":false}",
        "CALLBACK_URL": "https://webhook.site/your-test-url"
      },
      "auto_destroy": true,
      "restart": { "policy": "no" }
    },
    "region": "ord"
  }'
```

### Monitor Logs

```bash
# View recent logs
fly logs --app arke-mods-export-worker

# Follow logs in real-time
fly logs -f --app arke-mods-export-worker
```

## Orchestrator Integration

The orchestrator spawns workers like this:

```typescript
// Cloudflare Worker code
const taskId = `export_mods_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

const response = await fetch(
  `https://api.machines.dev/v1/apps/arke-mods-export-worker/machines`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.FLY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      config: {
        image: 'registry.fly.io/arke-mods-export-worker:latest',
        env: {
          TASK_ID: taskId,
          PI: requestBody.pi,
          EXPORT_OPTIONS: JSON.stringify(requestBody.options),
          CALLBACK_URL: `https://orchestrator.workers.dev/callback/${taskId}`,
          // R2 credentials from orchestrator env
          R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET: 'arke-exports',
        },
        auto_destroy: true,
        restart: { policy: 'no' },
      },
      region: 'ord',
    }),
  }
);

const machine = await response.json();
// Store machine.id for tracking
```

## Performance

Benchmarks from testing:

| Entities | Time   | File Size | Memory | Throughput     |
|----------|--------|-----------|--------|----------------|
| 1        | 0.3s   | 35 KB     | 25 MB  | 3 entities/s   |
| 13       | 1.8s   | 243 KB    | 28 MB  | 7 entities/s   |
| 72       | 2.9s   | 1.7 MB    | 30 MB  | 24 entities/s  |

**Memory Efficiency:** Peak ~30MB regardless of tree size (streaming architecture)

## Troubleshooting

### Worker exits immediately without processing

Check logs for environment validation errors:
```bash
fly logs --app arke-mods-export-worker
```

Look for:
```
[ERROR] Missing required environment variables
```

### R2 upload fails

- Verify R2 credentials have `PutObject` permissions
- Check bucket name matches `R2_BUCKET` env var
- Ensure account ID is correct

### Callback never received

- Verify `CALLBACK_URL` is accessible from Fly.io
- Check orchestrator callback endpoint logs
- Remember: Callback failure doesn't fail the export (graceful degradation)

### Export fails with 404 for PI

- Verify PI exists: `https://api.arke.institute/manifest/{PI}`
- Check PI format (26-char ULID)

### Out of memory

Current limit: 1GB (handles 500+ entities)

To increase:
```bash
fly scale memory 2048 --app arke-mods-export-worker
```

## Project Structure

```
arke-mods-export-worker/
├── src/
│   ├── core/                    # Copied from CLI (all MODS logic)
│   │   ├── types.ts
│   │   ├── api-client.ts
│   │   ├── crosswalk.ts
│   │   ├── cheimarros-processor.ts
│   │   ├── component-linker.ts
│   │   ├── mods-generator.ts
│   │   ├── mods-exporter.ts
│   │   ├── recursive-exporter.ts
│   │   ├── performance.ts
│   │   └── mods-collection-writer.ts
│   ├── index.ts                 # Main worker entry point
│   ├── r2-client.ts             # R2 upload client
│   └── callback.ts              # Callback sender
├── Dockerfile                   # Multi-stage build
├── fly.toml                     # Fly.io config
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## License

MIT
