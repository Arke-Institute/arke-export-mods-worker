/**
 * Type definitions for Pinax export worker
 */

import { z } from 'zod';

// ============================================================================
// PINAX Metadata Schema
// ============================================================================

export const PinaxMetadataSchema = z.object({
  // Required fields
  id: z.string(),
  title: z.string().min(1),
  type: z.enum([
    'Collection', 'Dataset', 'Event', 'Image', 'InteractiveResource',
    'MovingImage', 'PhysicalObject', 'Service', 'Software', 'Sound',
    'StillImage', 'Text'
  ]),
  creator: z.union([z.string(), z.array(z.string()).min(1)]),
  institution: z.string().min(1),
  created: z.string(),
  access_url: z.string(),

  // Optional fields
  language: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  rights: z.string().optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
});

export type PinaxMetadata = z.infer<typeof PinaxMetadataSchema>;

// ============================================================================
// Arke API Response Types
// ============================================================================

export interface ArkeManifest {
  pi: string;
  ver: number;
  ts: string;
  manifest_cid: string;
  prev_cid?: string;
  components: Record<string, string>;
  children_pi?: string[];
  parent_pi?: string;
  note?: string;
}

export interface ArkeRefJson {
  url: string;
  ipfs_cid: string;
  type: string;
  size: number;
  filename: string;
  ocr?: string;
}

// ============================================================================
// Cheimarros Graph Types
// ============================================================================

export interface CheimarrosEntity {
  type: string;
  label: string;
  properties?: Record<string, string | { type: 'entity_ref'; code: string }>;
  source?: string;
}

export interface CheimarrosRelation {
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface CheimarrosGraph {
  entities: Record<string, CheimarrosEntity>;
  relations?: CheimarrosRelation[];
}

// ============================================================================
// Pinax Export Types
// ============================================================================

export interface PinaxExportOptions {
  recursive?: boolean;
  maxDepth?: number;
  includeOcr?: boolean;
  maxTextLength?: number;
  entitySource?: 'graphdb' | 'cheimarros' | 'both';
  includeComponents?: boolean;
  componentTypes?: ('ref' | 'pinax' | 'description' | 'cheimarros' | 'other')[];
  parallelBatchSize?: number;
}

export const DEFAULT_PINAX_EXPORT_OPTIONS: Required<PinaxExportOptions> = {
  recursive: false,
  maxDepth: 10,
  includeOcr: true,
  maxTextLength: 100000,
  entitySource: 'graphdb',
  includeComponents: true,
  componentTypes: ['ref', 'pinax', 'description', 'cheimarros', 'other'],
  parallelBatchSize: 10,
};

export interface PinaxExport {
  $schema: 'https://arke.institute/schemas/export/v1';
  version: '1.0.0';
  exported_at: string;
  export_options: PinaxExportOptions;
  root: ExportedEntity;
}

export interface ExportedEntity {
  pi: string;
  manifest_cid: string;
  ver: number;
  ts: string;
  parent_pi?: string;
  depth: number;
  pinax: PinaxMetadata | null;
  description: string | null;
  description_truncated?: boolean;
  entities?: LinkedEntity[];
  relationships?: LinkedRelationship[];
  cheimarros?: CheimarrosGraph;
  components?: ExportedComponent[];
  children?: ExportedEntity[];
  children_count?: number;
}

export interface LinkedEntity {
  canonical_id: string;
  code: string;
  label: string;
  type: string;
  url: string;
  properties?: Record<string, unknown>;
  created_by_pi?: string;
  source_pis?: string[];
  first_seen?: string;
  last_updated?: string;
}

export interface LinkedRelationship {
  subject_id: string;
  predicate: string;
  object_id: string;
  subject_label?: string;
  object_label?: string;
  source_pi: string;
  properties?: Record<string, unknown>;
  created_at?: string;
}

export interface ExportedComponent {
  key: string;
  cid: string;
  url: string;
  type: 'ref' | 'pinax' | 'description' | 'cheimarros' | 'other';
  ref?: {
    mime_type: string;
    size: number;
    cdn_url: string;
    ocr_text?: string;
    ocr_truncated?: boolean;
  };
}

// ============================================================================
// Export Configuration
// ============================================================================

export interface PinaxExportConfig {
  arkeApiUrl: string;
  ipfsGateway: string;
  cdnUrl: string;
  graphdbUrl: string;
  entityUrlBase: string;
  verbose: boolean;
}

export const DEFAULT_PINAX_EXPORT_CONFIG: PinaxExportConfig = {
  arkeApiUrl: 'https://api.arke.institute',
  ipfsGateway: 'https://ipfs.arke.institute',
  cdnUrl: 'https://cdn.arke.institute',
  graphdbUrl: 'https://graphdb-gateway.arke.institute',
  entityUrlBase: 'https://www.arke.institute',
  verbose: true,
};

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerformanceMetrics {
  timings: {
    manifestFetch: number;
    componentDownloads: number;
    pinaxParsing: number;
    graphdbFetch: number;
    total: number;
  };
  memory: {
    peakUsage: number;
    heapUsed: number;
  };
  data: {
    totalBytesDownloaded: number;
    componentsProcessed: number;
    ocrTextSize: number;
    finalJsonSize: number;
  };
}

// ============================================================================
// Legacy ExportConfig (for api-client compatibility)
// ============================================================================

export interface ExportConfig {
  apiUrl: string;
  ipfsGateway: string;
  cdnUrl: string;
  includeOcr: boolean;
  cheimarrosMode: 'full' | 'minimal' | 'skip';
  validate: boolean;
  verbose: boolean;
}

export const DEFAULT_CONFIG: ExportConfig = {
  apiUrl: 'https://api.arke.institute',
  ipfsGateway: 'https://ipfs.arke.institute',
  cdnUrl: 'https://cdn.arke.institute',
  includeOcr: true,
  cheimarrosMode: 'full',
  validate: false,
  verbose: true,
};
