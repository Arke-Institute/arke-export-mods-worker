/**
 * Cheimarros graph processor
 * Extracts subjects, names, places, and relations from cheimarros.json
 */

import type {
  CheimarrosGraph,
  CheimarrosEntity,
  ModsSubject,
  ModsName,
  ModsNote,
  ExportConfig,
} from './types.js';

export class CheimarrosProcessor {
  constructor(private config: ExportConfig) {}

  /**
   * Process cheimarros graph and extract MODS elements
   */
  process(graph: CheimarrosGraph): CheimarrosProcessingResult {
    const result: CheimarrosProcessingResult = {
      subjects: [],
      names: [],
      notes: [],
    };

    if (this.config.cheimarrosMode === 'skip') {
      return result;
    }

    // Resolve entity references first (for properties like creator: {type: 'entity_ref', code: 'adam_tooze'})
    const resolvedEntities = this.resolveEntityReferences(graph);

    // Extract entities by type
    for (const [code, entity] of Object.entries(resolvedEntities)) {
      switch (entity.type) {
        case 'person':
          result.names.push(this.mapPersonToSubjectName(entity));
          break;

        case 'place':
          result.subjects.push(this.mapPlaceToSubject(entity));
          break;

        case 'concept':
          result.subjects.push(this.mapConceptToSubject(entity));
          break;

        case 'date':
          result.subjects.push(this.mapDateToSubject(entity));
          break;

        case 'organization':
          result.names.push(this.mapOrganizationToSubjectName(entity));
          break;

        case 'document':
          // Skip documents - they'll be handled by relatedItem logic
          break;

        default:
          // Unknown type - add as generic topic if minimal mode
          if (this.config.cheimarrosMode === 'full' && entity.label) {
            result.subjects.push({
              topics: [entity.label],
            });
          }
      }

      // Add property notes if in full mode
      if (this.config.cheimarrosMode === 'full' && entity.properties) {
        const propertyNotes = this.extractPropertyNotes(code, entity);
        result.notes.push(...propertyNotes);
      }
    }

    // Extract relations if present
    if (graph.relations && this.config.cheimarrosMode === 'full') {
      const relationNotes = this.extractRelationNotes(graph, resolvedEntities);
      result.notes.push(...relationNotes);
    }

    return result;
  }

  /**
   * Resolve entity references in properties
   * Example: {type: 'entity_ref', code: 'adam_tooze'} → look up 'adam_tooze' entity
   */
  private resolveEntityReferences(graph: CheimarrosGraph): Record<string, CheimarrosEntity> {
    const resolved: Record<string, CheimarrosEntity> = {};

    for (const [code, entity] of Object.entries(graph.entities)) {
      const resolvedEntity = { ...entity };

      if (entity.properties) {
        const resolvedProps: Record<string, string> = {};

        for (const [key, value] of Object.entries(entity.properties)) {
          if (typeof value === 'object' && value.type === 'entity_ref') {
            // Resolve reference
            const refEntity = graph.entities[value.code];
            if (refEntity) {
              resolvedProps[key] = refEntity.label || value.code;
            } else {
              resolvedProps[key] = value.code;
            }
          } else if (typeof value === 'string') {
            resolvedProps[key] = value;
          }
        }

        resolvedEntity.properties = resolvedProps;
      }

      resolved[code] = resolvedEntity;
    }

    return resolved;
  }

  /**
   * Map person entity to MODS subject name
   */
  private mapPersonToSubjectName(entity: CheimarrosEntity): ModsName {
    return {
      type: 'personal',
      nameParts: [entity.label],
      isSubject: true, // Mark as subject, not creator
    };
  }

  /**
   * Map place entity to MODS geographic subject
   */
  private mapPlaceToSubject(entity: CheimarrosEntity): ModsSubject {
    const subject: ModsSubject = {
      geographic: [entity.label],
    };

    // If place has description property, add it as a note in the subject
    if (entity.properties?.description) {
      // For now, just use the label - could enhance with authority links later
    }

    return subject;
  }

  /**
   * Map concept entity to MODS topical subject
   */
  private mapConceptToSubject(entity: CheimarrosEntity): ModsSubject {
    return {
      topics: [entity.label],
    };
  }

  /**
   * Map date entity to MODS temporal subject
   */
  private mapDateToSubject(entity: CheimarrosEntity): ModsSubject {
    return {
      temporal: [entity.label],
    };
  }

  /**
   * Map organization entity to MODS subject name
   */
  private mapOrganizationToSubjectName(entity: CheimarrosEntity): ModsName {
    return {
      type: 'corporate',
      nameParts: [entity.label],
      isSubject: true,
    };
  }

  /**
   * Extract property notes from entity
   */
  private extractPropertyNotes(_code: string, entity: CheimarrosEntity): ModsNote[] {
    const notes: ModsNote[] = [];

    if (!entity.properties) return notes;

    for (const [key, value] of Object.entries(entity.properties)) {
      if (typeof value === 'string' && key !== 'description') {
        notes.push({
          text: `${entity.label} • ${key}: ${value}`,
          type: 'cheimarros-property',
          displayLabel: 'Graph Property',
        });
      }
    }

    return notes;
  }

  /**
   * Extract relation notes from graph
   */
  private extractRelationNotes(
    graph: CheimarrosGraph,
    resolvedEntities: Record<string, CheimarrosEntity>
  ): ModsNote[] {
    const notes: ModsNote[] = [];

    if (!graph.relations) return notes;

    for (const relation of graph.relations) {
      const source = resolvedEntities[relation.source];
      const target = resolvedEntities[relation.target];

      if (source && target) {
        notes.push({
          text: `${source.label} → ${relation.type} → ${target.label}`,
          type: 'cheimarros-relation',
          displayLabel: 'Graph Relation',
        });
      }
    }

    return notes;
  }
}

export interface CheimarrosProcessingResult {
  subjects: ModsSubject[];
  names: ModsName[];
  notes: ModsNote[];
}
