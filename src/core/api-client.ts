/**
 * Arke API client for fetching manifests and IPFS content
 */

import type { ArkeManifest, ArkeRefJson, PinaxMetadata, CheimarrosGraph, ExportConfig } from './types.js';
import type { PerformanceMonitor } from './performance.js';

export class ArkeApiClient {
  constructor(
    private config: ExportConfig,
    private monitor: PerformanceMonitor
  ) {}

  /**
   * Fetch entity manifest by PI
   */
  async fetchManifest(pi: string): Promise<ArkeManifest> {
    this.monitor.startTimer('manifestFetch');

    try {
      const url = `${this.config.apiUrl}/entities/${pi}`;
      if (this.config.verbose) {
        console.error(`[API] Fetching manifest: ${url}`);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
      }

      const manifest = await response.json() as ArkeManifest;
      const duration = this.monitor.stopTimer('manifestFetch');
      this.monitor.recordTiming('manifestFetch', duration);

      if (this.config.verbose) {
        console.error(`[API] ✓ Manifest fetched (${duration}ms): ver ${manifest.ver}, ${Object.keys(manifest.components).length} components`);
      }

      return manifest;
    } catch (error) {
      this.monitor.stopTimer('manifestFetch');
      throw error;
    }
  }

  /**
   * Download content from IPFS by CID
   */
  async fetchIpfsContent(cid: string): Promise<string> {
    const url = `${this.config.ipfsGateway}/ipfs/${cid}`;

    if (this.config.verbose) {
      console.error(`[IPFS] Fetching: ${cid}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch IPFS content ${cid}: ${response.status}`);
    }

    const content = await response.text();
    const bytes = new TextEncoder().encode(content).length;
    this.monitor.addDataMetric('totalBytesDownloaded', bytes);

    return content;
  }

  /**
   * Download and parse JSON from IPFS
   */
  async fetchIpfsJson<T = unknown>(cid: string): Promise<T> {
    const content = await this.fetchIpfsContent(cid);
    return JSON.parse(content) as T;
  }

  /**
   * Fetch PINAX metadata from components
   */
  async fetchPinax(manifest: ArkeManifest): Promise<PinaxMetadata | null> {
    const pinaxCid = manifest.components['pinax.json'];
    if (!pinaxCid) {
      if (this.config.verbose) {
        console.error('[PINAX] No pinax.json component found');
      }
      return null;
    }

    try {
      const pinax = await this.fetchIpfsJson<PinaxMetadata>(pinaxCid);
      if (this.config.verbose) {
        console.error(`[PINAX] ✓ Loaded: "${pinax.title}"`);
      }
      return pinax;
    } catch (error) {
      if (this.config.verbose) {
        console.error(`[PINAX] ✗ Failed to parse pinax.json: ${error}`);
      }
      return null;
    }
  }

  /**
   * Fetch description.md from components
   */
  async fetchDescription(manifest: ArkeManifest): Promise<string | null> {
    const descCid = manifest.components['description.md'];
    if (!descCid) {
      if (this.config.verbose) {
        console.error('[DESC] No description.md component found');
      }
      return null;
    }

    try {
      const content = await this.fetchIpfsContent(descCid);
      if (this.config.verbose) {
        console.error(`[DESC] ✓ Loaded (${content.length} chars)`);
      }
      return content;
    } catch (error) {
      if (this.config.verbose) {
        console.error(`[DESC] ✗ Failed to fetch description.md: ${error}`);
      }
      return null;
    }
  }

  /**
   * Fetch cheimarros.json graph from components
   */
  async fetchCheimarros(manifest: ArkeManifest): Promise<CheimarrosGraph | null> {
    const cheirCid = manifest.components['cheimarros.json'];
    if (!cheirCid) {
      if (this.config.verbose) {
        console.error('[CHEIR] No cheimarros.json component found');
      }
      return null;
    }

    try {
      const graph = await this.fetchIpfsJson<CheimarrosGraph>(cheirCid);
      const entityCount = Object.keys(graph.entities).length;
      if (this.config.verbose) {
        console.error(`[CHEIR] ✓ Loaded graph with ${entityCount} entities`);
      }
      return graph;
    } catch (error) {
      if (this.config.verbose) {
        console.error(`[CHEIR] ✗ Failed to parse cheimarros.json: ${error}`);
      }
      return null;
    }
  }

  /**
   * Fetch all .ref.json files from components
   */
  async fetchRefJsonFiles(manifest: ArkeManifest): Promise<Map<string, ArkeRefJson>> {
    const refFiles = new Map<string, ArkeRefJson>();
    const refKeys = Object.keys(manifest.components).filter(key => key.endsWith('.ref.json'));

    if (refKeys.length === 0) {
      if (this.config.verbose) {
        console.error('[REF] No .ref.json files found');
      }
      return refFiles;
    }

    if (this.config.verbose) {
      console.error(`[REF] Found ${refKeys.length} .ref.json files`);
    }

    for (const key of refKeys) {
      const cid = manifest.components[key];
      try {
        const refJson = await this.fetchIpfsJson<ArkeRefJson>(cid);
        refFiles.set(key, refJson);

        if (refJson.ocr && this.config.includeOcr) {
          this.monitor.addDataMetric('ocrTextSize', refJson.ocr.length);
        }

        if (this.config.verbose) {
          console.error(`[REF] ✓ ${key}: ${refJson.type}, ${formatBytes(refJson.size)}`);
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(`[REF] ✗ Failed to fetch ${key}: ${error}`);
        }
      }
    }

    return refFiles;
  }

  /**
   * Get API URL for /cat/{cid} endpoint
   */
  getCatUrl(cid: string): string {
    return `${this.config.apiUrl}/cat/${cid}`;
  }

  /**
   * Get IPFS gateway URL for a CID
   */
  getIpfsUrl(cid: string): string {
    return `${this.config.ipfsGateway}/ipfs/${cid}`;
  }

  /**
   * Get CDN URL for an asset
   */
  getCdnUrl(assetId: string): string {
    return `${this.config.cdnUrl}/asset/${assetId}`;
  }

  /**
   * Get Arke web URL for a PI
   */
  getArkeUrl(pi: string): string {
    return `https://arke.institute/${pi}`;
  }
}

/**
 * Format bytes helper
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
