# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Overview

This is an ephemeral Fly.io worker that performs Pinax JSON exports. It is spawned by the `arke-export-orchestrator` Cloudflare Worker to handle export jobs.

## Architecture

```
┌─────────────────────────────────────┐
│  arke-export-orchestrator           │
│  (Cloudflare Worker)                │
│                                     │
│  Spawns ephemeral Fly machines      │
│  using registry.fly.io/...:latest   │
└─────────────┬───────────────────────┘
              │
              │ Machines API
              ▼
┌─────────────────────────────────────┐
│  arke-mods-export-worker            │
│  (This repo - Fly.io ephemeral)     │
│                                     │
│  1. Receives task via env vars      │
│  2. Fetches data from Arke API      │
│  3. Builds Pinax JSON export        │
│  4. Uploads to R2                   │
│  5. Callbacks to orchestrator       │
│  6. Auto-destroys                   │
└─────────────────────────────────────┘
```

## Commands

```bash
# Build TypeScript
npm run build

# Run locally (requires .env file)
npm run dev

# Deploy to Fly.io with :latest tag
npm run deploy
```

## Deployment

**IMPORTANT**: Always use `npm run deploy` to deploy. This uses the `--image-label latest` flag which ensures:

1. The image is tagged as `:latest` in the Fly registry
2. The orchestrator (which references `registry.fly.io/arke-mods-export-worker:latest`) automatically uses the newest version
3. No need to update the orchestrator's wrangler.jsonc after each deploy

The smoke check failure during deploy is **expected** - the worker requires environment variables (TASK_ID, PI, etc.) that are only provided when spawned by the orchestrator.

## Environment Variables

When spawned by the orchestrator, these env vars are provided:

| Variable | Description |
|----------|-------------|
| `TASK_ID` | Unique task identifier |
| `PI` | Permanent identifier to export |
| `BATCH_ID` | Batch identifier |
| `EXPORT_OPTIONS` | JSON string of export options |
| `CALLBACK_URL` | URL to POST results to |
| `R2_ACCOUNT_ID` | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |

## Export Options

The `EXPORT_OPTIONS` JSON supports:

- `recursive` (boolean, default: false) - Include child entities
- `maxDepth` (number, default: 10, max: 50) - Maximum recursion depth
- `includeOcr` (boolean, default: true) - Include OCR text from refs
- `maxTextLength` (number, default: 100000) - Max text length before truncation
- `entitySource` ('none' | 'graphdb' | 'cheimarros' | 'both', default: 'graphdb') - Source for linked entities
- `includeComponents` (boolean, default: true) - Include component metadata
- `componentTypes` (array) - Which component types to include

## Related Repositories

- **arke-export-orchestrator**: Cloudflare Worker that spawns and manages export jobs
- **site-explorer/site-frontend**: Frontend with Export button UI
