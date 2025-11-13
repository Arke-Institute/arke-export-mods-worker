/**
 * Recursive MODS exporter - exports entire subtrees as flattened MODS collections
 */

import type { ExportConfig } from './types.js';
import { ModsExporter } from './mods-exporter.js';
import { ArkeApiClient } from './api-client.js';
import { PerformanceMonitor } from './performance.js';
import { ModsCollectionWriter, type EntityNode } from './mods-collection-writer.js';

export interface RecursiveOptions {
  maxDepth: number;              // Maximum recursion depth (default: 5)
  parallelBatchSize: number;     // Entities to process in parallel (default: 10)
  includeParent: boolean;        // Include root entity in output (default: true)
  traversalMode: 'breadth-first' | 'depth-first'; // Default: breadth-first
  onProgress?: ProgressCallback;
}

export interface RecursiveExportResult {
  totalEntities: number;
  successCount: number;
  errorCount: number;
  outputPath: string;
  timings: {
    total: number;
    traversal: number;
    export: number;
    writing: number;
  };
  memory: {
    peakUsage: number;
  };
  errors: Array<{ pi: string; error: string }>;
}

export type ProgressCallback = (progress: {
  current: number;
  total: number; // -1 if unknown
  currentPI: string;
  depth: number;
  phase: 'fetching' | 'exporting' | 'writing';
}) => void;

export const DEFAULT_RECURSIVE_OPTIONS: RecursiveOptions = {
  maxDepth: 5,
  parallelBatchSize: 10,
  includeParent: true,
  traversalMode: 'breadth-first',
};

export class RecursiveModsExporter {
  private writer: ModsCollectionWriter;
  private apiClient: ArkeApiClient;
  private monitor: PerformanceMonitor;

  constructor(private config: ExportConfig) {
    this.writer = new ModsCollectionWriter();
    this.monitor = new PerformanceMonitor();
    this.apiClient = new ArkeApiClient(config, this.monitor);
  }

  /**
   * Export entire subtree as flattened MODS collection
   */
  async exportRecursive(
    rootPI: string,
    outputPath: string,
    options: RecursiveOptions = DEFAULT_RECURSIVE_OPTIONS
  ): Promise<RecursiveExportResult> {
    const startTime = Date.now();
    const errors: Array<{ pi: string; error: string }> = [];

    if (this.config.verbose) {
      console.error(`\n${'='.repeat(60)}`);
      console.error(`RECURSIVE MODS EXPORT: ${rootPI}`);
      console.error(`Max Depth: ${options.maxDepth}, Batch Size: ${options.parallelBatchSize}`);
      console.error('='.repeat(60));
    }

    // Open file stream
    await this.writer.open(outputPath);

    try {
      const { entityCount, successCount } = await this.traverseBFS(
        rootPI,
        options,
        errors
      );

      // Close stream
      await this.writer.close();

      const result: RecursiveExportResult = {
        totalEntities: entityCount,
        successCount,
        errorCount: errors.length,
        outputPath,
        timings: {
          total: Date.now() - startTime,
          traversal: 0,
          export: 0,
          writing: 0,
        },
        memory: {
          peakUsage: process.memoryUsage().heapUsed,
        },
        errors,
      };

      if (this.config.verbose) {
        this.logSummary(result);
      }

      return result;

    } catch (error) {
      await this.writer.close();
      throw error;
    }
  }

  /**
   * Breadth-first traversal with parallel batch processing
   */
  private async traverseBFS(
    rootPI: string,
    options: RecursiveOptions,
    errors: Array<{ pi: string; error: string }>
  ): Promise<{ entityCount: number; successCount: number }> {
    // Queue of nodes to process
    const queue: EntityNode[] = [{
      pi: rootPI,
      depth: 0,
      pathFromRoot: [rootPI],
    }];

    const visited = new Set<string>([rootPI]);
    let entityCount = 0;
    let successCount = 0;

    while (queue.length > 0) {
      // Extract all nodes at current depth
      const currentLevel = this.extractCurrentLevel(queue);

      if (this.config.verbose) {
        const depth = currentLevel[0]?.depth ?? 0;
        console.error(`\n[LEVEL ${depth}] Processing ${currentLevel.length} entities...`);
      }

      // Process level in parallel batches
      for (let i = 0; i < currentLevel.length; i += options.parallelBatchSize) {
        const batch = currentLevel.slice(i, i + options.parallelBatchSize);

        if (this.config.verbose) {
          console.error(`  [BATCH] Processing ${batch.length} entities in parallel...`);
        }

        // Parallel fetch + export + write
        const results = await Promise.allSettled(
          batch.map(node => this.processEntity(node, options))
        );

        // Handle results
        for (let j = 0; j < results.length; j++) {
          const node = batch[j];
          const result = results[j];

          entityCount++;

          if (result.status === 'fulfilled') {
            successCount++;

            if (this.config.verbose) {
              console.error(`    ✓ ${node.pi} (depth ${node.depth})`);
            }

            // Add children to queue (if not at max depth)
            if (node.depth < options.maxDepth && result.value.children) {
              for (const childPI of result.value.children) {
                if (!visited.has(childPI)) {
                  queue.push({
                    pi: childPI,
                    depth: node.depth + 1,
                    parentPI: node.pi,
                    pathFromRoot: [...node.pathFromRoot, childPI],
                  });
                  visited.add(childPI);
                }
              }

              if (this.config.verbose && result.value.children.length > 0) {
                console.error(`      → ${result.value.children.length} children queued`);
              }
            }
          } else {
            const errorMsg = result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);

            errors.push({
              pi: node.pi,
              error: errorMsg,
            });

            if (this.config.verbose) {
              console.error(`    ✗ ${node.pi}: ${errorMsg}`);
            }
          }

          // Progress callback
          if (options.onProgress) {
            options.onProgress({
              current: entityCount,
              total: -1,
              currentPI: node.pi,
              depth: node.depth,
              phase: 'writing',
            });
          }
        }

        this.monitor.sampleMemory();
      }
    }

    return { entityCount, successCount };
  }

  /**
   * Extract all nodes at the same depth from front of queue
   */
  private extractCurrentLevel(queue: EntityNode[]): EntityNode[] {
    if (queue.length === 0) return [];

    const firstDepth = queue[0].depth;
    const currentLevel: EntityNode[] = [];

    while (queue.length > 0 && queue[0].depth === firstDepth) {
      currentLevel.push(queue.shift()!);
    }

    return currentLevel;
  }

  /**
   * Process a single entity: export MODS, write to stream, return children
   */
  private async processEntity(
    node: EntityNode,
    _options: RecursiveOptions
  ): Promise<{ children?: string[] }> {
    // 1. Export single entity (reuse existing exporter)
    // Create new exporter instance with quiet mode for recursive processing
    const quietConfig = { ...this.config, verbose: false };
    const exporter = new ModsExporter(quietConfig);
    const modsXml = await exporter.export(node.pi);

    // 2. Write to stream
    await this.writer.writeMods(modsXml, node);

    // 3. Fetch manifest to get children (for next level)
    const manifest = await this.apiClient.fetchManifest(node.pi);

    return {
      children: manifest.children_pi,
    };
  }

  /**
   * Log summary of recursive export
   */
  private logSummary(result: RecursiveExportResult): void {
    console.error(`\n${'='.repeat(60)}`);
    console.error('RECURSIVE EXPORT SUMMARY');
    console.error('='.repeat(60));
    console.error(`Total Entities:    ${result.totalEntities}`);
    console.error(`Successful:        ${result.successCount}`);
    console.error(`Errors:            ${result.errorCount}`);
    console.error(`Total Time:        ${(result.timings.total / 1000).toFixed(2)}s`);
    console.error(`Peak Memory:       ${this.formatBytes(result.memory.peakUsage)}`);
    console.error(`Output File:       ${result.outputPath}`);

    if (result.errors.length > 0) {
      console.error('\nERRORS:');
      for (const error of result.errors.slice(0, 10)) {
        console.error(`  - ${error.pi}: ${error.error}`);
      }
      if (result.errors.length > 10) {
        console.error(`  ... and ${result.errors.length - 10} more`);
      }
    }

    console.error('='.repeat(60));
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}
