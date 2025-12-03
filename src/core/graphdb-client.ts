/**
 * GraphDB Gateway Client for Pinax export
 *
 * Fetches linked entities and relationships from the GraphDB gateway
 */

import type { LinkedEntity, LinkedRelationship } from './types';

interface GraphDBConfig {
  graphdbUrl: string;
  entityUrlBase: string;
  verbose: boolean;
}

interface PIEntitiesWithRelationshipsResponse {
  entities: Array<{
    canonical_id: string;
    code: string;
    label: string;
    entity_type: string;
    properties?: Record<string, unknown>;
    created_by_pi?: string;
    source_pis?: string[];
    first_seen?: string;
    last_updated?: string;
  }>;
  relationships: Array<{
    subject_id: string;
    predicate: string;
    object_id: string;
    subject_label?: string;
    object_label?: string;
    source_pi: string;
    properties?: Record<string, unknown>;
    created_at?: string;
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
    const url = `${this.config.graphdbUrl}/api/pi/${pi}/entities-with-relationships`;

    if (this.config.verbose) {
      console.error(`[GraphDB] Fetching entities for PI ${pi}`);
    }

    try {
      const response = await fetch(url);

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
        type: e.entity_type,
        url: `${this.config.entityUrlBase}/${e.canonical_id}`,
        properties: e.properties,
        created_by_pi: e.created_by_pi,
        source_pis: e.source_pis,
        first_seen: e.first_seen,
        last_updated: e.last_updated,
      }));

      // Transform relationships to export format
      const relationships: LinkedRelationship[] = data.relationships.map((r) => ({
        subject_id: r.subject_id,
        predicate: r.predicate,
        object_id: r.object_id,
        subject_label: r.subject_label,
        object_label: r.object_label,
        source_pi: r.source_pi,
        properties: r.properties,
        created_at: r.created_at,
      }));

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
}
