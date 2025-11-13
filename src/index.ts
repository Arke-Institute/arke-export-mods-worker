#!/usr/bin/env node
/**
 * MODS Export Worker - Fly.io Ephemeral Machine
 *
 * Contract:
 * - Receives PI + export options via environment variables
 * - Exports MODS XML to local temp file
 * - Uploads to R2 storage
 * - Sends callback with R2 key
 * - Exits (auto-destroy)
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { ModsExporter } from './core/mods-exporter.js';
import { RecursiveModsExporter } from './core/recursive-exporter.js';
import { uploadToR2 } from './r2-client.js';
import { sendCallback } from './callback.js';
import type { ExportConfig } from './core/types.js';

// ============================================================================
// 1. ENVIRONMENT VALIDATION
// ============================================================================

const TASK_ID = process.env.TASK_ID;
const BATCH_ID = process.env.BATCH_ID || 'default';
const PI = process.env.PI;
const EXPORT_FORMAT = process.env.EXPORT_FORMAT || 'mods';
const EXPORT_OPTIONS_JSON = process.env.EXPORT_OPTIONS || '{}';
const CALLBACK_URL = process.env.CALLBACK_URL;
const MACHINE_ID = process.env.FLY_MACHINE_ID || 'local';

// R2 credentials
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'arke-exports';

// Validate required vars
if (!TASK_ID || !PI || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('[ERROR] Missing required environment variables:');
  console.error(`  TASK_ID: ${!!TASK_ID}`);
  console.error(`  PI: ${!!PI}`);
  console.error(`  R2_ACCOUNT_ID: ${!!R2_ACCOUNT_ID}`);
  console.error(`  R2_ACCESS_KEY_ID: ${!!R2_ACCESS_KEY_ID}`);
  console.error(`  R2_SECRET_ACCESS_KEY: ${!!R2_SECRET_ACCESS_KEY}`);
  process.exit(1);
}

// Parse export options
interface ExportOptions {
  recursive?: boolean;
  maxDepth?: number;
  parallelBatchSize?: number;
  includeOcr?: boolean;
  cheimarrosMode?: 'full' | 'minimal' | 'skip';
  validate?: boolean;
}

let exportOptions: ExportOptions;
try {
  exportOptions = JSON.parse(EXPORT_OPTIONS_JSON);
} catch (error) {
  console.error('[ERROR] Invalid EXPORT_OPTIONS JSON:', EXPORT_OPTIONS_JSON);
  console.error(error);
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`[${MACHINE_ID}] MODS Export Worker Started`);
console.log('='.repeat(60));
console.log(`Task ID:       ${TASK_ID}`);
console.log(`Batch ID:      ${BATCH_ID}`);
console.log(`PI:            ${PI}`);
console.log(`Format:        ${EXPORT_FORMAT}`);
console.log(`Recursive:     ${exportOptions.recursive ?? false}`);
console.log(`Max Depth:     ${exportOptions.maxDepth ?? 5}`);
console.log(`Batch Size:    ${exportOptions.parallelBatchSize ?? 10}`);
console.log(`Include OCR:   ${exportOptions.includeOcr ?? true}`);
console.log(`Cheimarros:    ${exportOptions.cheimarrosMode ?? 'full'}`);
console.log(`Callback URL:  ${CALLBACK_URL || '(none)'}`);
console.log('='.repeat(60));

// ============================================================================
// 2. MAIN PROCESSING FUNCTION
// ============================================================================

async function exportMods(): Promise<void> {
  const startTime = Date.now();
  let tempFilePath: string | null = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Generate temp file path
    // -------------------------------------------------------------------------
    const timestamp = Date.now();
    const filename = exportOptions.recursive ? `${PI}-collection.xml` : `${PI}.xml`;
    tempFilePath = join(tmpdir(), `${TASK_ID}-${timestamp}-${filename}`);

    console.log(`\n[${MACHINE_ID}] Temp file: ${tempFilePath}`);

    // -------------------------------------------------------------------------
    // STEP 2: Build export configuration
    // -------------------------------------------------------------------------
    const config: ExportConfig = {
      apiUrl: 'https://api.arke.institute',
      ipfsGateway: 'https://ipfs.arke.institute',
      cdnUrl: 'https://cdn.arke.institute',
      includeOcr: exportOptions.includeOcr ?? true,
      cheimarrosMode: exportOptions.cheimarrosMode ?? 'full',
      validate: false, // Don't validate in worker (too slow + requires xmllint)
      verbose: true, // Always verbose for logging
    };

    // -------------------------------------------------------------------------
    // STEP 3: Export MODS XML
    // -------------------------------------------------------------------------
    let entityCount = 1;
    let errorCount = 0;
    let incompleteCount = 0;

    if (exportOptions.recursive) {
      console.log(`\n[${MACHINE_ID}] Starting recursive export...`);

      const exporter = new RecursiveModsExporter(config);
      const result = await exporter.exportRecursive(PI!, tempFilePath, {
        maxDepth: exportOptions.maxDepth ?? 5,
        parallelBatchSize: exportOptions.parallelBatchSize ?? 10,
        includeParent: true,
        traversalMode: 'breadth-first',
      });

      entityCount = result.totalEntities;
      errorCount = result.errorCount;
      incompleteCount = result.incompleteCount;

      console.log(
        `\n[${MACHINE_ID}] ✓ Exported ${result.successCount}/${result.totalEntities} entities`
      );

      if (incompleteCount > 0) {
        console.log(
          `[${MACHINE_ID}] ⚠ ${incompleteCount} incomplete records (missing PINAX metadata)`
        );
      }
    } else {
      console.log(`\n[${MACHINE_ID}] Starting single entity export...`);

      const exporter = new ModsExporter(config);
      const xml = await exporter.export(PI!);

      // Write to temp file
      await writeFile(tempFilePath, xml, 'utf-8');

      console.log(`[${MACHINE_ID}] ✓ Exported single entity`);
    }

    // -------------------------------------------------------------------------
    // STEP 4: Get file size
    // -------------------------------------------------------------------------
    const fileStats = statSync(tempFilePath);
    const fileSizeBytes = fileStats.size;

    console.log(`\n[${MACHINE_ID}] File size: ${formatBytes(fileSizeBytes)}`);

    // -------------------------------------------------------------------------
    // STEP 5: Upload to R2
    // -------------------------------------------------------------------------
    console.log(`\n[${MACHINE_ID}] Uploading to R2...`);

    const r2Key = `exports/${TASK_ID}/${filename}`;
    await uploadToR2({
      bucket: R2_BUCKET,
      key: r2Key,
      filePath: tempFilePath,
      accountId: R2_ACCOUNT_ID!,
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    });

    console.log(`[${MACHINE_ID}] ✓ Uploaded to R2: ${r2Key}`);

    // -------------------------------------------------------------------------
    // STEP 6: Send success callback
    // -------------------------------------------------------------------------
    const totalTime = Date.now() - startTime;
    const memoryUsage = process.memoryUsage();
    const peakMemoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

    console.log(`\n[${MACHINE_ID}] Sending success callback...`);

    await sendCallback(CALLBACK_URL, {
      task_id: TASK_ID!,
      batch_id: BATCH_ID,
      status: 'success',
      output_r2_key: r2Key,
      output_file_name: filename,
      output_file_size: fileSizeBytes,
      metrics: {
        total_time_ms: totalTime,
        entities_exported: entityCount,
        entities_failed: errorCount,
        entities_incomplete: incompleteCount,
        peak_memory_mb: peakMemoryMB,
      },
    });

    // -------------------------------------------------------------------------
    // STEP 7: Cleanup and exit
    // -------------------------------------------------------------------------
    console.log(`\n${'='.repeat(60)}`);
    console.log('EXPORT COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total time:    ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Entities:      ${entityCount}`);
    console.log(`Incomplete:    ${incompleteCount}`);
    console.log(`Errors:        ${errorCount}`);
    console.log(`File size:     ${formatBytes(fileSizeBytes)}`);
    console.log(`Peak memory:   ${peakMemoryMB} MB`);
    console.log(`R2 key:        ${r2Key}`);
    console.log('='.repeat(60));

    // Cleanup temp file
    if (tempFilePath) {
      try {
        unlinkSync(tempFilePath);
        console.log(`\n[${MACHINE_ID}] ✓ Cleaned up temp file`);
      } catch (error) {
        console.error(`[${MACHINE_ID}] Warning: Failed to cleanup temp file:`, error);
      }
    }

    console.log(`\n[${MACHINE_ID}] Exiting with success (0)`);
    process.exit(0);
  } catch (error) {
    // -------------------------------------------------------------------------
    // ERROR HANDLING
    // -------------------------------------------------------------------------
    console.error(`\n${'='.repeat(60)}`);
    console.error('EXPORT FAILED');
    console.error('='.repeat(60));
    console.error(`[${MACHINE_ID}] ERROR:`, error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    console.error('='.repeat(60));

    // Send error callback
    console.log(`\n[${MACHINE_ID}] Sending error callback...`);
    await sendCallback(CALLBACK_URL, {
      task_id: TASK_ID!,
      batch_id: BATCH_ID,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });

    // Cleanup temp file
    if (tempFilePath) {
      try {
        unlinkSync(tempFilePath);
        console.log(`[${MACHINE_ID}] ✓ Cleaned up temp file`);
      } catch {}
    }

    console.log(`\n[${MACHINE_ID}] Exiting with failure (1)`);
    process.exit(1);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// ============================================================================
// START PROCESSING IMMEDIATELY
// ============================================================================

exportMods();
