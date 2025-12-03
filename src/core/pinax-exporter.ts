/**
 * Pinax JSON Exporter
 *
 * Exports Arke entities to a standard JSON format with:
 * - Nested tree structure (not flattened)
 * - GraphDB linked entities (with cheimarros fallback)
 * - All PINAX metadata preserved
 * - Configurable depth limits and text truncation
 */

import type {
  ArkeManifest,
  CheimarrosGraph,
  PinaxExport,
  PinaxExportOptions,
  PinaxExportConfig,
  ExportedEntity,
  ExportedComponent,
  LinkedEntity,
  LinkedRelationship,
  ExportConfig,
} from './types.js';
import { ArkeApiClient } from './api-client.js';
import { GraphDBClient } from './graphdb-client.js';
import { PerformanceMonitor } from './performance.js';
import { truncateText, exceedsMaxLength, normalizeText } from './text-utils.js';

/**
 * Main Pinax exporter class
 */
export class PinaxExporter {
  private arkeClient: ArkeApiClient;
  private graphdbClient: GraphDBClient;
  private config: PinaxExportConfig;
  private options: Required<PinaxExportOptions>;
  private monitor: PerformanceMonitor;

  constructor(
    config: Partial<PinaxExportConfig> = {},
    options: PinaxExportOptions = {}
  ) {
    // Merge with defaults
    this.config = {
      arkeApiUrl: config.arkeApiUrl ?? 'https://api.arke.institute',
      ipfsGateway: config.ipfsGateway ?? 'https://ipfs.arke.institute',
      cdnUrl: config.cdnUrl ?? 'https://cdn.arke.institute',
      graphdbUrl: config.graphdbUrl ?? 'https://graphdb-gateway.arke.institute',
      entityUrlBase: config.entityUrlBase ?? 'https://www.arke.institute',
      verbose: config.verbose ?? true,
    };

    this.options = {
      recursive: options.recursive ?? false,
      maxDepth: Math.min(options.maxDepth ?? 10, 50), // Cap at 50
      includeOcr: options.includeOcr ?? true,
      maxTextLength: options.maxTextLength ?? 100000,
      entitySource: options.entitySource ?? 'graphdb',
      includeComponents: options.includeComponents ?? true,
      componentTypes: options.componentTypes ?? ['ref', 'pinax', 'description', 'cheimarros', 'other'],
      parallelBatchSize: options.parallelBatchSize ?? 10,
    };

    // Initialize clients
    this.monitor = new PerformanceMonitor();

    // Create a legacy config for ArkeApiClient
    const legacyConfig: ExportConfig = {
      apiUrl: this.config.arkeApiUrl,
      ipfsGateway: this.config.ipfsGateway,
      cdnUrl: this.config.cdnUrl,
      includeOcr: this.options.includeOcr,
      cheimarrosMode: 'full',
      validate: false,
      verbose: this.config.verbose,
    };

    this.arkeClient = new ArkeApiClient(legacyConfig, this.monitor);
    this.graphdbClient = new GraphDBClient({
      graphdbUrl: this.config.graphdbUrl,
      entityUrlBase: this.config.entityUrlBase,
      verbose: this.config.verbose,
    });
  }

  /**
   * Export a single entity (and optionally its children)
   */
  async export(pi: string): Promise<PinaxExport> {

    if (this.config.verbose) {
      console.error(`[Export] Starting export for PI ${pi}`);
      console.error(`[Export] Options: recursive=${this.options.recursive}, maxDepth=${this.options.maxDepth}, entitySource=${this.options.entitySource}`);
    }

    const root = await this.exportEntity(pi, 0);

    const result: PinaxExport = {
      $schema: 'https://export.arke.institute/schemas/export/v1',
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      export_options: this.options,
      root,
    };

    if (this.config.verbose) {
      const metrics = this.monitor.getMetrics();
      console.error(`[Export] Complete in ${metrics.timings.total}ms`);
    }

    return result;
  }

  /**
   * Export a single entity at a given depth
   */
  private async exportEntity(pi: string, depth: number): Promise<ExportedEntity> {
    if (this.config.verbose) {
      console.error(`[Export] Processing PI ${pi} at depth ${depth}`);
    }

    // Fetch manifest
    const manifest = await this.arkeClient.fetchManifest(pi);

    // Fetch PINAX metadata and fix access_url
    let pinax = await this.arkeClient.fetchPinax(manifest);
    if (pinax) {
      // Override placeholder access_url with actual arke.institute URL
      pinax = {
        ...pinax,
        access_url: `https://arke.institute/${pi}`,
      };
    }

    // Fetch description
    let description: string | null = await this.arkeClient.fetchDescription(manifest);
    let descriptionTruncated = false;

    if (description && exceedsMaxLength(description, this.options.maxTextLength)) {
      const result = truncateText(description, this.options.maxTextLength);
      description = result.text;
      descriptionTruncated = result.truncated;
    } else if (description) {
      description = normalizeText(description);
    }

    // Fetch entities and relationships
    let entities: LinkedEntity[] | undefined;
    let relationships: LinkedRelationship[] | undefined;
    let cheimarros: CheimarrosGraph | undefined;

    if (this.options.entitySource === 'graphdb' || this.options.entitySource === 'both') {
      const graphdbData = await this.graphdbClient.getEntitiesForPI(pi);
      if (graphdbData.entities.length > 0) {
        entities = graphdbData.entities;
        relationships = graphdbData.relationships;
      }
    }

    // Fetch cheimarros if needed (either as primary or fallback)
    if (
      this.options.entitySource === 'cheimarros' ||
      this.options.entitySource === 'both' ||
      (this.options.entitySource === 'graphdb' && !entities?.length)
    ) {
      cheimarros = await this.arkeClient.fetchCheimarros(manifest) ?? undefined;
    }

    // Build components list
    let components: ExportedComponent[] | undefined;
    if (this.options.includeComponents) {
      components = await this.buildComponents(manifest);
    }

    // Build the entity object
    const entity: ExportedEntity = {
      pi: manifest.pi,
      manifest_cid: manifest.manifest_cid,
      ver: manifest.ver,
      ts: manifest.ts,
      depth,
      pinax,
      description,
    };

    // Add optional fields
    if (manifest.parent_pi) {
      entity.parent_pi = manifest.parent_pi;
    }

    if (descriptionTruncated) {
      entity.description_truncated = true;
    }

    if (entities && entities.length > 0) {
      entity.entities = entities;
    }

    if (relationships && relationships.length > 0) {
      entity.relationships = relationships;
    }

    if (cheimarros && (this.options.entitySource === 'cheimarros' || this.options.entitySource === 'both')) {
      entity.cheimarros = cheimarros;
    }

    if (components && components.length > 0) {
      entity.components = components;
    }

    // Handle children
    const childrenPis = manifest.children_pi || [];
    entity.children_count = childrenPis.length;

    if (this.options.recursive && childrenPis.length > 0 && depth < this.options.maxDepth) {
      entity.children = await this.exportChildren(childrenPis, depth + 1);
    }

    return entity;
  }

  /**
   * Export children entities in batches
   */
  private async exportChildren(childrenPis: string[], depth: number): Promise<ExportedEntity[]> {
    const children: ExportedEntity[] = [];
    const batchSize = this.options.parallelBatchSize;

    for (let i = 0; i < childrenPis.length; i += batchSize) {
      const batch = childrenPis.slice(i, i + batchSize);

      if (this.config.verbose) {
        console.error(`[Export] Processing children batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(childrenPis.length / batchSize)} (${batch.length} items)`);
      }

      const batchResults = await Promise.all(
        batch.map(pi => this.exportEntity(pi, depth))
      );

      children.push(...batchResults);
    }

    return children;
  }

  /**
   * Build components list from manifest
   */
  private async buildComponents(manifest: ArkeManifest): Promise<ExportedComponent[]> {
    const components: ExportedComponent[] = [];
    const refFiles = await this.arkeClient.fetchRefJsonFiles(manifest);

    for (const [key, cid] of Object.entries(manifest.components)) {
      const componentType = this.getComponentType(key);

      // Skip if not in allowed types
      if (!this.options.componentTypes.includes(componentType)) {
        continue;
      }

      const component: ExportedComponent = {
        key,
        cid,
        url: `${this.config.ipfsGateway}/ipfs/${cid}`,
        type: componentType,
      };

      // Add ref data for .ref.json files
      if (componentType === 'ref') {
        const refData = refFiles.get(key);
        if (refData) {
          let ocrText = this.options.includeOcr ? refData.ocr : undefined;
          let ocrTruncated = false;

          if (ocrText && exceedsMaxLength(ocrText, this.options.maxTextLength)) {
            const result = truncateText(ocrText, this.options.maxTextLength);
            ocrText = result.text;
            ocrTruncated = result.truncated;
          }

          component.ref = {
            mime_type: refData.type,
            size: refData.size,
            cdn_url: refData.url,
          };

          if (ocrText) {
            component.ref.ocr_text = ocrText;
            if (ocrTruncated) {
              component.ref.ocr_truncated = true;
            }
          }
        }
      }

      components.push(component);
    }

    return components;
  }

  /**
   * Determine component type from key
   */
  private getComponentType(key: string): 'ref' | 'pinax' | 'description' | 'cheimarros' | 'other' {
    if (key.endsWith('.ref.json')) return 'ref';
    if (key === 'pinax.json') return 'pinax';
    if (key === 'description.md') return 'description';
    if (key === 'cheimarros.json') return 'cheimarros';
    return 'other';
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return this.monitor.getMetrics();
  }
}

/**
 * Convenience function for one-off exports
 */
export async function exportPinax(
  pi: string,
  options: PinaxExportOptions = {},
  config: Partial<PinaxExportConfig> = {}
): Promise<PinaxExport> {
  const exporter = new PinaxExporter(config, options);
  return exporter.export(pi);
}
