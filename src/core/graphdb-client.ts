/**
 * GraphDB Gateway Client for Pinax export
 *
 * Fetches linked entities and relationships from the GraphDB gateway
 */

import type { LinkedEntity, LinkedRelationship } from './types';
import { processBatch } from './batch-utils.js';

interface GraphDBConfig {
  graphdbUrl: string;
  entityUrlBase: string;
  verbose: boolean;
}

interface EntityRelationship {
  direction: 'outgoing' | 'incoming';
  predicate: string;
  target_id: string;
  target_code: string;
  target_label: string;
  target_type: string;
  properties?: Record<string, unknown>;
  source_pi: string;
  created_at?: string;
}

interface PIEntitiesWithRelationshipsResponse {
  pi: string;
  entities: Array<{
    canonical_id: string;
    code: string;
    label: string;
    type: string;
    properties?: Record<string, unknown>;
    created_by_pi?: string;
    source_pis?: string[];
    first_seen?: string;
    last_updated?: string;
    relationships?: EntityRelationship[];
  }>;
}

export class GraphDBClient {
  private config: GraphDBConfig;

  constructor(config: Partial<GraphDBConfig> = {}) {
    this.config = {
      graphdbUrl: config.graphdbUrl ?? 'https://graphdb-gateway.arke.institute',
      entityUrlBase: config.entityUrlBase ?? 'https://www.arke.institute',
      verbose: config.verbose ?? true,
    };
  }

  /**
   * Get all entities and relationships linked to a PI
   */
  async getEntitiesForPI(pi: string): Promise<{
    entities: LinkedEntity[];
    relationships: LinkedRelationship[];
  }> {
    const url = `${this.config.graphdbUrl}/pi/entities-with-relationships`;

    if (this.config.verbose) {
      console.error(`[GraphDB] Fetching entities for PI ${pi}`);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pi }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          if (this.config.verbose) {
            console.error(`[GraphDB] No entities found for PI ${pi}`);
          }
          return { entities: [], relationships: [] };
        }
        throw new Error(`GraphDB request failed: ${response.status}`);
      }

      const data = (await response.json()) as PIEntitiesWithRelationshipsResponse;

      // Transform entities to export format
      const entities: LinkedEntity[] = data.entities.map((e) => ({
        canonical_id: e.canonical_id,
        code: e.code,
        label: e.label,
        type: e.type,
        url: `${this.config.entityUrlBase}/${e.canonical_id}`,
        properties: e.properties,
        created_by_pi: e.created_by_pi,
        source_pis: e.source_pis,
        first_seen: e.first_seen,
        last_updated: e.last_updated,
      }));

      // Extract relationships from entities (they're nested in the response)
      const relationships: LinkedRelationship[] = [];
      for (const entity of data.entities) {
        if (entity.relationships) {
          for (const rel of entity.relationships) {
            // Only include relationships where this PI is the source
            if (rel.source_pi === pi) {
              relationships.push({
                subject_id: entity.canonical_id,
                predicate: rel.predicate,
                object_id: rel.target_id,
                subject_label: entity.label,
                object_label: rel.target_label,
                source_pi: rel.source_pi,
                properties: rel.properties,
                created_at: rel.created_at,
              });
            }
          }
        }
      }

      if (this.config.verbose) {
        console.error(
          `[GraphDB] Found ${entities.length} entities and ${relationships.length} relationships for PI ${pi}`
        );
      }

      return { entities, relationships };
    } catch (error) {
      if (this.config.verbose) {
        console.error(`[GraphDB] Error fetching entities for PI ${pi}:`, error);
      }
      return { entities: [], relationships: [] };
    }
  }

  /**
   * Get entities for multiple PIs in parallel batches
   *
   * @param pis - Array of PI identifiers
   * @param batchSize - Maximum concurrent requests (default: 20)
   * @returns Map of PI to entities/relationships data
   */
  async getEntitiesForPIs(
    pis: string[],
    batchSize: number = 20
  ): Promise<Map<string, { entities: LinkedEntity[]; relationships: LinkedRelationship[] }>> {
    if (pis.length === 0) {
      return new Map();
    }

    if (this.config.verbose) {
      console.error(`[GraphDB] Batch fetching entities for ${pis.length} PIs (batch size: ${batchSize})`);
    }

    const results = await processBatch(pis, batchSize, async (pi) => {
      const data = await this.getEntitiesForPI(pi);
      return { pi, data };
    });

    const resultMap = new Map<string, { entities: LinkedEntity[]; relationships: LinkedRelationship[] }>();
    for (const { pi, data } of results) {
      resultMap.set(pi, data);
    }

    return resultMap;
  }
}
