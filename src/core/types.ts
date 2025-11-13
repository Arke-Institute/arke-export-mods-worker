/**
 * Type definitions for Arke export utility
 */

import { z } from 'zod';

// ============================================================================
// PINAX Metadata Schema (from pinax-schema.md)
// ============================================================================

export const PinaxMetadataSchema = z.object({
  // Required fields
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid ULID or UUID'),
  title: z.string().min(1),
  type: z.enum([
    'Collection', 'Dataset', 'Event', 'Image', 'InteractiveResource',
    'MovingImage', 'PhysicalObject', 'Service', 'Software', 'Sound',
    'StillImage', 'Text'
  ]),
  creator: z.union([z.string(), z.array(z.string()).min(1)]),
  institution: z.string().min(1),
  created: z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/, 'Invalid date format (must be YYYY or YYYY-MM-DD)'),
  access_url: z.string().url(),

  // Optional fields
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Invalid BCP-47 language code').optional(),
  subjects: z.array(z.string()).optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  rights: z.string().optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
});

export type PinaxMetadata = z.infer<typeof PinaxMetadataSchema>;

// ============================================================================
// Arke API Response Types (from WRAPPER_API_SPEC.md)
// ============================================================================

export interface ArkeManifest {
  pi: string;
  ver: number;
  ts: string; // ISO 8601 timestamp
  manifest_cid: string;
  prev_cid?: string;
  components: Record<string, string>; // component_key -> CID
  children_pi?: string[];
  parent_pi?: string;
  note?: string;
}

export interface ArkeRefJson {
  url: string; // CDN URL
  ipfs_cid: string;
  type: string; // MIME type
  size: number;
  filename: string;
  ocr?: string;
}

// ============================================================================
// Cheimarros Graph Types
// ============================================================================

export interface CheimarrosEntity {
  type: 'person' | 'place' | 'concept' | 'document' | 'organization' | 'date' | string;
  label: string;
  properties?: Record<string, string | { type: 'entity_ref'; code: string }>;
  source?: string;
}

export interface CheimarrosRelation {
  source: string; // entity code
  target: string; // entity code
  type: string; // relation type
  properties?: Record<string, unknown>;
}

export interface CheimarrosGraph {
  entities: Record<string, CheimarrosEntity>; // entity_code -> entity
  relations?: CheimarrosRelation[];
}

// ============================================================================
// MODS Internal Representation (before XML generation)
// ============================================================================

export interface ModsDocument {
  titleInfo: ModsTitleInfo[];
  names: ModsName[];
  typeOfResource?: string;
  genre?: string[];
  originInfo?: ModsOriginInfo;
  language?: ModsLanguage[];
  physicalDescription?: ModsPhysicalDescription;
  abstract?: string;
  tableOfContents?: string;
  targetAudience?: string;
  notes: ModsNote[];
  subjects: ModsSubject[];
  classification?: ModsClassification[];
  relatedItems: ModsRelatedItem[];
  identifiers: ModsIdentifier[];
  location?: ModsLocation;
  accessConditions: ModsAccessCondition[];
  recordInfo: ModsRecordInfo;
}

export interface ModsTitleInfo {
  title: string;
  subTitle?: string;
  type?: 'abbreviated' | 'translated' | 'alternative' | 'uniform';
  displayLabel?: string;
}

export interface ModsName {
  type: 'personal' | 'corporate' | 'conference' | 'family';
  nameParts: string[];
  displayForm?: string;
  roles?: ModsRole[];
  // For subject names
  isSubject?: boolean;
}

export interface ModsRole {
  roleTerm: string;
  type?: 'text' | 'code';
  authority?: string;
}

export interface ModsOriginInfo {
  places?: string[];
  publisher?: string;
  dateCreated?: string;
  dateIssued?: string;
  encoding?: 'w3cdtf' | 'iso8601' | 'marc' | 'edtf';
  keyDate?: boolean;
}

export interface ModsLanguage {
  languageTerm: string;
  type: 'code' | 'text';
  authority?: string;
}

export interface ModsPhysicalDescription {
  form?: string;
  extent?: string;
  internetMediaType?: string;
  digitalOrigin?: string;
  note?: string;
}

export interface ModsNote {
  text: string;
  type?: string;
  displayLabel?: string;
}

export interface ModsSubject {
  topics?: string[];
  geographic?: string[];
  temporal?: string[];
  names?: ModsName[];
  titleInfo?: ModsTitleInfo;
  occupation?: string;
  genre?: string;
  authority?: string;
}

export interface ModsClassification {
  value: string;
  authority?: string;
}

export interface ModsRelatedItem {
  type: 'host' | 'constituent' | 'series' | 'otherVersion' | 'otherFormat' | 'isReferencedBy' | 'original' | 'references';
  displayLabel?: string;
  titleInfo?: ModsTitleInfo;
  identifiers?: ModsIdentifier[];
  location?: ModsLocation;
  physicalDescription?: ModsPhysicalDescription;
  notes?: ModsNote[];
}

export interface ModsIdentifier {
  value: string;
  type?: string;
  displayLabel?: string;
}

export interface ModsLocation {
  physicalLocation?: string;
  urls?: ModsUrl[];
  holdingSimple?: unknown;
}

export interface ModsUrl {
  url: string;
  usage?: 'primary display' | 'primary';
  access?: 'object in context' | 'preview' | 'raw object';
  displayLabel?: string;
}

export interface ModsAccessCondition {
  text: string;
  type?: string;
}

export interface ModsRecordInfo {
  recordContentSource?: string;
  recordIdentifier?: string;
  recordIdentifierSource?: string;
  recordCreationDate?: string;
  recordChangeDate?: string;
  recordOrigin?: string;
  languageOfCataloging?: ModsLanguage;
  descriptionStandard?: string;
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerformanceMetrics {
  timings: {
    manifestFetch: number; // ms
    componentDownloads: number; // ms
    pinaxParsing: number; // ms
    cheimarrosProcessing: number; // ms
    modsGeneration: number; // ms
    xmlValidation: number; // ms
    total: number; // ms
  };
  memory: {
    peakUsage: number; // bytes
    heapUsed: number; // bytes
  };
  data: {
    totalBytesDownloaded: number;
    componentsProcessed: number;
    ocrTextSize: number;
    finalXmlSize: number;
  };
}

// ============================================================================
// Export Configuration
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
