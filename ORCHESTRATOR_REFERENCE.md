# Orchestrator Quick Reference

## Spawning Machines

### Image Tag to Use

**Always use the `production` tag:**

```typescript
image: 'registry.fly.io/arke-mods-export-worker:production'
```

This tag is automatically updated every time you run `./deploy.sh`.

### Spawn Function

```typescript
async function spawnMogsExportMachine(env: Env, options: {
  pi: string;
  taskId: string;
  callbackUrl: string;
  exportOptions: {
    recursive?: boolean;
    maxDepth?: number;
    parallelBatchSize?: number;
    includeOcr?: boolean;
    cheimarrosMode?: 'full' | 'minimal' | 'skip';
  };
}) {
  const response = await fetch(
    'https://api.machines.dev/v1/apps/arke-mods-export-worker/machines',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.FLY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          // Use production tag (updated via ./deploy.sh)
          image: 'registry.fly.io/arke-mods-export-worker:production',

          env: {
            TASK_ID: options.taskId,
            PI: options.pi,
            EXPORT_FORMAT: 'mods',
            EXPORT_OPTIONS: JSON.stringify(options.exportOptions),

            // R2 credentials from orchestrator env
            R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
            R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
            R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
            R2_BUCKET: 'arke-exports',

            CALLBACK_URL: options.callbackUrl,
          },

          auto_destroy: true,
          restart: { policy: 'no' },
        },
        region: 'ord',
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to spawn machine: ${response.status}`);
  }

  return await response.json();
}
```

## Callback Contract

### Success Callback

The worker POSTs to `${CALLBACK_URL}` when complete:

```json
{
  "task_id": "export_mods_1763059915_a3f8c2d1",
  "batch_id": "single",
  "status": "success",
  "output_r2_key": "exports/export_mods_1763059915_a3f8c2d1/01K9Z3K4GMDWTT0VQXYSPC9W6S.xml",
  "output_file_name": "01K9Z3K4GMDWTT0VQXYSPC9W6S.xml",
  "output_file_size": 35885,
  "metrics": {
    "total_time_ms": 3480,
    "entities_exported": 72,
    "entities_failed": 0,
    "peak_memory_mb": 39
  }
}
```

### Error Callback

```json
{
  "task_id": "export_mods_1763059915_a3f8c2d1",
  "batch_id": "single",
  "status": "error",
  "error": "Failed to fetch manifest: 404 Not Found"
}
```

## Complete Example

```typescript
// 1. Client requests export
POST /export/mods
{
  "pi": "01K9Z3K4GMDWTT0VQXYSPC9W6S",
  "options": { "recursive": false }
}

// 2. Orchestrator spawns machine
const taskId = `export_mods_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const callbackUrl = `${url.origin}/callback/${taskId}`;

await spawnMogsExportMachine(env, {
  pi: body.pi,
  taskId,
  callbackUrl,
  exportOptions: body.options,
});

// 3. Store task state
await env.TASK_STORE.put(taskId, JSON.stringify({
  status: 'processing',
  pi: body.pi,
  createdAt: Date.now(),
}));

// 4. Return to client
return Response.json({
  task_id: taskId,
  status: 'processing',
});

// 5. Worker calls back when done
// POST /callback/:taskId
// Update task state in KV

// 6. Client downloads
// GET /download/:taskId
// Stream from R2 to client
```

## Deployment

### Deploy New Version

```bash
./deploy.sh
```

This automatically:
1. Builds the Docker image
2. Tags as `production`
3. Pushes to Fly.io registry

The orchestrator will use the new version on the next machine spawn (no orchestrator changes needed).

### Environment Variables Needed in Orchestrator

```typescript
interface Env {
  FLY_API_TOKEN: string;           // Get with: fly tokens create deploy --app arke-mods-export-worker
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;               // Usually "arke-exports"
  TASK_STORE: KVNamespace;         // For task state
}
```
