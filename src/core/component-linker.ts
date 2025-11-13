/**
 * Component linker - generates MODS <relatedItem> for components
 * Handles .ref.json files, parent/child relationships, and other components
 */

import type {
  ArkeManifest,
  ArkeRefJson,
  ModsRelatedItem,
  ModsIdentifier,
  ModsPhysicalDescription,
  ModsNote,
  ExportConfig,
} from './types.js';
import { ArkeApiClient } from './api-client.js';

export class ComponentLinker {
  constructor(
    private config: ExportConfig,
    private apiClient: ArkeApiClient
  ) {}

  /**
   * Generate relatedItem entries for all .ref.json components
   */
  linkRefJsonComponents(refJsonFiles: Map<string, ArkeRefJson>): ModsRelatedItem[] {
    const items: ModsRelatedItem[] = [];

    for (const [key, refJson] of refJsonFiles.entries()) {
      items.push(this.createRefJsonRelatedItem(key, refJson));
    }

    return items;
  }

  /**
   * Create a relatedItem for a single .ref.json file
   */
  private createRefJsonRelatedItem(_key: string, refJson: ArkeRefJson): ModsRelatedItem {
    const identifiers: ModsIdentifier[] = [
      {
        value: refJson.url,
        type: 'uri',
        displayLabel: 'CDN URL',
      },
      {
        value: refJson.ipfs_cid,
        type: 'ipfs-cid',
        displayLabel: 'IPFS CID (reference only - content stored on CDN)',
      },
    ];

    const physicalDescription: ModsPhysicalDescription = {
      internetMediaType: refJson.type,
      extent: `${refJson.size} bytes`,
    };

    const notes: ModsNote[] = [];

    // Add OCR text as note if available and enabled
    if (refJson.ocr && this.config.includeOcr) {
      notes.push({
        text: refJson.ocr,
        type: 'ocr',
        displayLabel: 'OCR Text',
      });
    }

    return {
      type: 'constituent',
      displayLabel: refJson.filename,
      identifiers,
      physicalDescription,
      notes: notes.length > 0 ? notes : undefined,
    };
  }

  /**
   * Generate relatedItem for parent entity
   */
  linkParent(manifest: ArkeManifest): ModsRelatedItem | null {
    if (!manifest.parent_pi) return null;

    return {
      type: 'host',
      displayLabel: 'Parent Entity',
      identifiers: [
        {
          value: manifest.parent_pi,
          type: 'arke-pi',
          displayLabel: 'Parent PI',
        },
      ],
      location: {
        urls: [{
          url: this.apiClient.getArkeUrl(manifest.parent_pi),
          displayLabel: 'View Parent in Arke',
        }],
      },
    };
  }

  /**
   * Generate relatedItem entries for child entities
   */
  linkChildren(manifest: ArkeManifest): ModsRelatedItem[] {
    if (!manifest.children_pi || manifest.children_pi.length === 0) {
      return [];
    }

    return manifest.children_pi.map((childPi, index) => ({
      type: 'constituent',
      displayLabel: `Child Entity ${index + 1}`,
      identifiers: [
        {
          value: childPi,
          type: 'arke-pi',
          displayLabel: 'Child PI',
        },
      ],
      location: {
        urls: [{
          url: this.apiClient.getArkeUrl(childPi),
          displayLabel: 'View Child in Arke',
        }],
      },
    }));
  }

  /**
   * Generate inventory note listing all component keys
   */
  createComponentInventoryNote(manifest: ArkeManifest): ModsNote {
    const componentKeys = Object.keys(manifest.components).sort();
    const text = `Component inventory (${componentKeys.length} files):\n${componentKeys.join('\n')}`;

    return {
      text,
      type: 'component-inventory',
      displayLabel: 'Component Files',
    };
  }

  /**
   * Generate child inventory note
   */
  createChildInventoryNote(manifest: ArkeManifest): ModsNote | null {
    if (!manifest.children_pi || manifest.children_pi.length === 0) {
      return null;
    }

    return {
      text: `${manifest.children_pi.length} child entities`,
      type: 'children-inventory',
      displayLabel: 'Child Entities',
    };
  }

  /**
   * Link other component types (HTML, TXT, JSON, etc.)
   * These are listed as constituent items with IPFS links
   */
  linkOtherComponents(manifest: ArkeManifest, refJsonKeys: Set<string>): ModsRelatedItem[] {
    const items: ModsRelatedItem[] = [];

    // Known metadata files to skip (already processed elsewhere)
    const skipKeys = new Set([
      'pinax.json',
      'description.md',
      'cheimarros.json',
      'cheimarros-raw.txt',
      'reorganization-description.txt', // Internal metadata
    ]);

    for (const [key, cid] of Object.entries(manifest.components)) {
      // Skip .ref.json files (handled separately) and known metadata files
      if (refJsonKeys.has(key) || skipKeys.has(key)) {
        continue;
      }

      items.push({
        type: 'constituent',
        displayLabel: key,
        identifiers: [
          {
            value: cid,
            type: 'ipfs-cid',
            displayLabel: 'IPFS CID',
          },
          {
            value: this.apiClient.getIpfsUrl(cid),
            type: 'uri',
            displayLabel: 'IPFS Gateway URL',
          },
          {
            value: this.apiClient.getCatUrl(cid),
            type: 'uri',
            displayLabel: 'API URL',
          },
        ],
      });
    }

    return items;
  }
}
