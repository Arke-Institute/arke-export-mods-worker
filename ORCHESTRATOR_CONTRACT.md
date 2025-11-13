# Orchestrator Contract Specification

This document defines the exact contract between the **Orchestrator** (Cloudflare Worker) and the **MODS Export Worker** (Fly.io ephemeral machine).

## Overview

```
CLIENT → ORCHESTRATOR → FLY.IO WORKER → R2 STORAGE
                ↓                ↓
              KV Store      Callback
                ↓                ↓
            ORCHESTRATOR ← ← ← ←
                ↓
            CLIENT (stream from R2)
```

## 1. Orchestrator Responsibilities

### 1.1 Receive Export Request

```http
POST /export/mods
Content-Type: application/json

{
  "pi": "01K9XVBAQZF9EHDRXGBEADTZYY",
  "options": {
    "recursive": true,
    "maxDepth": 10,
    "parallelBatchSize": 10,
    "includeOcr": true,
    "cheimarrosMode": "full"
  }
}
```

**Response (immediate):**
```json
{
  "task_id": "export_mods_1704857234567_a3f8c2d1",
  "status": "processing",
  "message": "Export job started. Use task_id to check status or poll /status/:task_id"
}
```

### 1.2 Generate Unique Task ID

```typescript
const taskId = `export_mods_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
```

**Format:** `export_mods_{timestamp}_{random_hex}`
**Example:** `export_mods_1704857234567_a3f8c2d1`

### 1.3 Spawn Fly.io Machine

```typescript
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
          // REQUIRED
          TASK_ID: taskId,
          PI: requestBody.pi,
          EXPORT_FORMAT: 'mods',
          EXPORT_OPTIONS: JSON.stringify(requestBody.options),

          // R2 Credentials (from orchestrator env)
          R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET: 'arke-exports',

          // Callback URL
          CALLBACK_URL: `https://orchestrator.workers.dev/callback/${taskId}`,

          // OPTIONAL
          BATCH_ID: batchId || 'single',
        },
        auto_destroy: true,
        restart: { policy: 'no' },
      },
      region: 'ord',
    }),
  }
);

const machine = await response.json();
```

### 1.4 Store Task State

```typescript
// Store in KV or Durable Object
await env.TASK_STORE.put(
  taskId,
  JSON.stringify({
    status: 'processing',
    pi: requestBody.pi,
    options: requestBody.options,
    createdAt: Date.now(),
    machineId: machine.id,
  }),
  { expirationTtl: 3600 } // 1 hour
);
```

### 1.5 Implement Callback Endpoint

```typescript
// POST /callback/:taskId
async function handleCallback(request: Request, env: Env) {
  const url = new URL(request.url);
  const taskId = url.pathname.split('/').pop();

  const callback = await request.json();

  // Update task state
  const existing = JSON.parse(await env.TASK_STORE.get(taskId) || '{}');

  await env.TASK_STORE.put(
    taskId,
    JSON.stringify({
      ...existing,
      status: callback.status,
      ...callback,
      completedAt: Date.now(),
    }),
    { expirationTtl: 86400 } // 24 hours
  );

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 1.6 Implement Status Endpoint

```typescript
// GET /status/:taskId
async function getTaskStatus(request: Request, env: Env) {
  const url = new URL(request.url);
  const taskId = url.pathname.split('/').pop();

  const taskData = await env.TASK_STORE.get(taskId);

  if (!taskData) {
    return new Response(JSON.stringify({ error: 'Task not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(taskData, {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 1.7 Implement Download Endpoint

```typescript
// GET /download/:taskId
async function downloadResult(request: Request, env: Env) {
  const url = new URL(request.url);
  const taskId = url.pathname.split('/').pop();

  const taskData = JSON.parse(await env.TASK_STORE.get(taskId) || '{}');

  if (taskData.status !== 'success') {
    return new Response('Export not ready or failed', { status: 400 });
  }

  // Fetch from R2
  const r2Object = await env.R2_BUCKET.get(taskData.output_r2_key);

  if (!r2Object) {
    return new Response('File not found in R2', { status: 404 });
  }

  // Stream to client
  return new Response(r2Object.body, {
    headers: {
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="${taskData.output_file_name}"`,
      'Content-Length': taskData.output_file_size.toString(),
    },
  });
}
```

## 2. Worker Responsibilities

### 2.1 Read Environment Variables

**Required:**
- `TASK_ID` - Unique task identifier
- `PI` - Entity persistent identifier
- `EXPORT_OPTIONS` - JSON string with export options
- `R2_ACCOUNT_ID` - R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `CALLBACK_URL` - URL to send results

**Optional:**
- `BATCH_ID` - Batch identifier (default: "default")
- `EXPORT_FORMAT` - Format type (default: "mods")
- `R2_BUCKET` - Bucket name (default: "arke-exports")

**Automatic:**
- `FLY_MACHINE_ID` - Provided by Fly.io

### 2.2 Export MODS to Temp File

```typescript
const tempFilePath = join(tmpdir(), `${TASK_ID}-${timestamp}-${filename}`);

if (recursive) {
  await recursiveExporter.exportRecursive(PI, tempFilePath, options);
} else {
  const xml = await exporter.export(PI);
  await writeFile(tempFilePath, xml, 'utf-8');
}
```

### 2.3 Upload to R2

```typescript
const r2Key = `exports/${TASK_ID}/${filename}`;

await uploadToR2({
  bucket: R2_BUCKET,
  key: r2Key,
  filePath: tempFilePath,
  accountId: R2_ACCOUNT_ID,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
});
```

### 2.4 Send Success Callback

```http
POST ${CALLBACK_URL}
Content-Type: application/json

{
  "task_id": "export_mods_1704857234567_a3f8c2d1",
  "batch_id": "single",
  "status": "success",
  "output_r2_key": "exports/export_mods_1704857234567_a3f8c2d1/01K9XVBAQZF9EHDRXGBEADTZYY-collection.xml",
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

### 2.5 Send Error Callback

```http
POST ${CALLBACK_URL}
Content-Type: application/json

{
  "task_id": "export_mods_1704857234567_a3f8c2d1",
  "batch_id": "single",
  "status": "error",
  "error": "Failed to fetch manifest for PI 01K9XVBAQZF9EHDRXGBEADTZYY: 404 Not Found"
}
```

### 2.6 Exit with Code

- **0** - Success (file exported and uploaded)
- **1** - Failure (any error occurred)

## 3. Data Structures

### ExportOptions

```typescript
interface ExportOptions {
  recursive?: boolean;          // Default: false
  maxDepth?: number;            // Default: 5
  parallelBatchSize?: number;   // Default: 10
  includeOcr?: boolean;         // Default: true
  cheimarrosMode?: 'full' | 'minimal' | 'skip'; // Default: 'full'
  validate?: boolean;           // Default: false (not supported in worker)
}
```

### Task State (stored in KV)

```typescript
interface TaskState {
  status: 'processing' | 'success' | 'error';
  pi: string;
  options: ExportOptions;
  createdAt: number;
  machineId: string;

  // Added after completion
  completedAt?: number;
  output_r2_key?: string;
  output_file_name?: string;
  output_file_size?: number;
  metrics?: {
    total_time_ms: number;
    entities_exported: number;
    entities_failed: number;
    peak_memory_mb: number;
  };
  error?: string;
}
```

## 4. R2 Storage Structure

```
arke-exports/
└── exports/
    ├── export_mods_1704857234567_a3f8c2d1/
    │   └── 01K9XVBAQZF9EHDRXGBEADTZYY-collection.xml
    ├── export_mods_1704857234568_b4g9d3e2/
    │   └── 01K9Z3K4GMDWTT0VQXYSPC9W6S.xml
    └── ...
```

**Cleanup Policy:** Files should be deleted after:
- Download by client, OR
- 24 hours after creation (whichever comes first)

## 5. Error Handling

### Worker Errors

The worker handles errors gracefully:
1. Catches all exceptions
2. Sends error callback with message
3. Cleans up temp files
4. Exits with code 1

### Callback Failures

- Worker logs callback failures but **does not fail the task**
- Orchestrator can still detect success via exit code 0
- Fallback: Poll machine status via Fly Machines API

### Orchestrator Errors

- If machine spawn fails: Return 500 to client immediately
- If callback not received within timeout (e.g., 10 min): Mark task as failed
- If R2 file missing at download: Return 404 to client

## 6. Timeout Recommendations

| Phase | Timeout | Reason |
|-------|---------|--------|
| Machine spawn | 30s | Image pull + startup |
| Export processing | 10 min | Large trees (500+ entities) |
| R2 upload | 2 min | Large files (5MB+) |
| Callback | 10s | HTTP request to orchestrator |
| Client polling | 10 min | Total end-to-end |

## 7. Security Considerations

### R2 Credentials

- **Never** expose R2 credentials to client
- Store in orchestrator env vars (encrypted by Cloudflare)
- Pass to worker via Fly Machines API (encrypted in transit)
- Worker never logs credentials

### Callback Authentication

Optional: Add HMAC signature to callback:

```typescript
// Orchestrator generates secret
const callbackSecret = env.CALLBACK_SECRET;
const signature = await crypto.subtle.sign(
  'HMAC',
  callbackSecret,
  new TextEncoder().encode(taskId)
);

// Worker includes signature in callback
headers: {
  'X-Callback-Signature': signature,
}
```

## 8. Complete Flow Example

```
1. Client → Orchestrator
   POST /export/mods { pi: "01K9...", options: {...} }

2. Orchestrator:
   - Generate taskId = "export_mods_1704857234567_a3f8c2d1"
   - Spawn Fly.io machine with env vars
   - Store task state in KV: { status: "processing" }
   - Return to client: { task_id, status: "processing" }

3. Client starts polling:
   GET /status/export_mods_1704857234567_a3f8c2d1
   Response: { status: "processing" }

4. Worker (Fly.io):
   - Read env vars
   - Export MODS to /tmp/export_mods_1704857234567_a3f8c2d1-1704857234567-01K9...-collection.xml
   - Upload to R2: exports/export_mods_1704857234567_a3f8c2d1/01K9...-collection.xml
   - POST callback to orchestrator
   - Exit 0 (machine auto-destroys)

5. Orchestrator callback handler:
   - Receive POST /callback/export_mods_1704857234567_a3f8c2d1
   - Update KV: { status: "success", output_r2_key: "...", metrics: {...} }

6. Client polls again:
   GET /status/export_mods_1704857234567_a3f8c2d1
   Response: { status: "success", output_r2_key: "..." }

7. Client downloads:
   GET /download/export_mods_1704857234567_a3f8c2d1
   Orchestrator streams from R2 → client

8. Orchestrator cleanup:
   - Delete R2 file: exports/export_mods_1704857234567_a3f8c2d1/...
   - (KV entry expires automatically after 24h)
```

## 9. Testing Checklist

- [ ] Orchestrator generates unique task IDs
- [ ] Orchestrator spawns machines with correct env vars
- [ ] Orchestrator stores task state in KV
- [ ] Worker reads all env vars correctly
- [ ] Worker exports MODS to temp file
- [ ] Worker uploads to R2 with correct path
- [ ] Worker sends success callback
- [ ] Worker sends error callback on failure
- [ ] Worker exits with correct code (0/1)
- [ ] Worker cleans up temp files
- [ ] Orchestrator callback handler updates KV
- [ ] Orchestrator status endpoint returns correct data
- [ ] Orchestrator download endpoint streams from R2
- [ ] R2 files are cleaned up after download
- [ ] Timeout handling works correctly
- [ ] Error messages are descriptive
- [ ] Callback failures don't fail export
- [ ] Large exports (500+ entities) complete successfully
- [ ] Memory stays under 1GB limit
