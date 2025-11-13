/**
 * PINAX → MODS crosswalk engine
 * Maps PINAX metadata fields to MODS elements
 */

import type {
  PinaxMetadata,
  ArkeManifest,
  ModsDocument,
  ModsTitleInfo,
  ModsName,
  ModsOriginInfo,
  ModsLanguage,
  ModsSubject,
  ModsIdentifier,
  ModsLocation,
  ModsAccessCondition,
  ModsRecordInfo,
  ModsNote,
  ExportConfig,
} from './types.js';

export class PinaxModsCrosswalk {
  constructor(private config: ExportConfig) {}

  /**
   * Convert PINAX metadata to MODS document structure
   */
  crosswalk(
    pinax: PinaxMetadata,
    manifest: ArkeManifest,
    description?: string | null
  ): ModsDocument {
    const mods: ModsDocument = {
      titleInfo: this.mapTitle(pinax),
      names: this.mapCreators(pinax),
      typeOfResource: this.mapResourceType(pinax.type),
      genre: [],
      originInfo: this.mapOriginInfo(pinax),
      language: this.mapLanguage(pinax),
      abstract: description || pinax.description,
      notes: this.mapNotes(pinax, manifest, description),
      subjects: this.mapSubjects(pinax),
      identifiers: this.mapIdentifiers(pinax, manifest),
      location: this.mapLocation(pinax, manifest),
      accessConditions: this.mapAccessConditions(pinax),
      relatedItems: [],
      recordInfo: this.mapRecordInfo(manifest),
    };

    return mods;
  }

  /**
   * Map PINAX title to MODS <titleInfo>
   */
  private mapTitle(pinax: PinaxMetadata): ModsTitleInfo[] {
    return [{
      title: pinax.title,
    }];
  }

  /**
   * Map PINAX creator(s) to MODS <name> with role
   */
  private mapCreators(pinax: PinaxMetadata): ModsName[] {
    const creators = Array.isArray(pinax.creator) ? pinax.creator : [pinax.creator];

    const names: ModsName[] = creators.map(creator => ({
      type: 'personal', // Could be refined with NER/heuristics
      nameParts: [creator],
      roles: [{
        roleTerm: 'creator',
        type: 'text',
      }],
    }));

    // Add institution as corporate name
    names.push({
      type: 'corporate',
      nameParts: [pinax.institution],
      roles: [{
        roleTerm: 'repository',
        type: 'text',
      }],
    });

    return names;
  }

  /**
   * Map DCMI Type to MODS typeOfResource
   */
  private mapResourceType(dcmiType: string): string {
    const typeMap: Record<string, string> = {
      'Text': 'text',
      'Image': 'still image',
      'StillImage': 'still image',
      'MovingImage': 'moving image',
      'Sound': 'sound recording',
      'Dataset': 'software, multimedia',
      'InteractiveResource': 'software, multimedia',
      'Software': 'software, multimedia',
      'Collection': 'mixed material',
      'PhysicalObject': 'three dimensional object',
      'Event': 'text', // No direct mapping
      'Service': 'text', // No direct mapping
    };

    return typeMap[dcmiType] || 'text';
  }

  /**
   * Map PINAX created date to MODS <originInfo>
   */
  private mapOriginInfo(pinax: PinaxMetadata): ModsOriginInfo {
    return {
      dateCreated: pinax.created,
      encoding: 'w3cdtf',
      keyDate: true,
    };
  }

  /**
   * Map PINAX language (BCP-47) to MODS language (ISO 639-2b)
   */
  private mapLanguage(pinax: PinaxMetadata): ModsLanguage[] | undefined {
    if (!pinax.language) return undefined;

    // Simple BCP-47 → ISO 639-2b mapping (common cases)
    const langMap: Record<string, string> = {
      'en': 'eng',
      'en-US': 'eng',
      'en-GB': 'eng',
      'es': 'spa',
      'es-MX': 'spa',
      'fr': 'fre',
      'de': 'ger',
      'it': 'ita',
      'pt': 'por',
      'zh': 'chi',
      'ja': 'jpn',
      'ar': 'ara',
      'ru': 'rus',
    };

    const iso6392b = langMap[pinax.language] || pinax.language.substring(0, 3);

    return [{
      languageTerm: iso6392b,
      type: 'code',
      authority: 'iso639-2b',
    }];
  }

  /**
   * Map PINAX subjects and places to MODS <subject>
   */
  private mapSubjects(pinax: PinaxMetadata): ModsSubject[] {
    const subjects: ModsSubject[] = [];

    // Topical subjects
    if (pinax.subjects && pinax.subjects.length > 0) {
      for (const topic of pinax.subjects) {
        subjects.push({
          topics: [topic],
        });
      }
    }

    // Geographic subjects
    if (pinax.place) {
      const places = Array.isArray(pinax.place) ? pinax.place : [pinax.place];
      for (const place of places) {
        subjects.push({
          geographic: [place],
        });
      }
    }

    return subjects;
  }

  /**
   * Map identifiers (PINAX id, PI, access_url)
   */
  private mapIdentifiers(pinax: PinaxMetadata, manifest: ArkeManifest): ModsIdentifier[] {
    return [
      {
        value: pinax.id,
        type: 'local',
        displayLabel: 'PINAX ID',
      },
      {
        value: manifest.pi,
        type: 'arke-pi',
        displayLabel: 'Arke Persistent Identifier',
      },
      {
        value: pinax.access_url === 'PLACEHOLDER'
          ? `https://arke.institute/${manifest.pi}`
          : pinax.access_url,
        type: 'uri',
        displayLabel: 'Arke URI',
      },
    ];
  }

  /**
   * Map location with Arke and IPFS URLs
   */
  private mapLocation(pinax: PinaxMetadata, manifest: ArkeManifest): ModsLocation {
    const arkeUrl = pinax.access_url === 'PLACEHOLDER'
      ? `https://arke.institute/${manifest.pi}`
      : pinax.access_url;

    return {
      physicalLocation: pinax.institution,
      urls: [
        {
          url: arkeUrl,
          usage: 'primary display',
          access: 'object in context',
          displayLabel: 'View in Arke',
        },
        {
          url: this.config.ipfsGateway + '/ipfs/' + manifest.manifest_cid,
          displayLabel: 'IPFS Manifest',
        },
      ],
    };
  }

  /**
   * Map access conditions (rights)
   */
  private mapAccessConditions(pinax: PinaxMetadata): ModsAccessCondition[] {
    if (!pinax.rights) return [];

    return [{
      text: pinax.rights,
      type: 'use and reproduction',
    }];
  }

  /**
   * Map notes (version, PINAX description if separate from abstract, etc.)
   */
  private mapNotes(
    pinax: PinaxMetadata,
    manifest: ArkeManifest,
    description?: string | null
  ): ModsNote[] {
    const notes: ModsNote[] = [];

    // Version note
    notes.push({
      text: `Version ${manifest.ver} • Manifest CID: ${manifest.manifest_cid}`,
      type: 'version',
      displayLabel: 'Arke Version',
    });

    // If description.md exists and is used as abstract, put pinax.description in a note
    if (description && pinax.description && description !== pinax.description) {
      notes.push({
        text: pinax.description,
        type: 'summary',
        displayLabel: 'PINAX Description',
      });
    }

    // Source system note
    if (pinax.source) {
      notes.push({
        text: pinax.source,
        type: 'source',
        displayLabel: 'Source System',
      });
    }

    return notes;
  }

  /**
   * Map record info (administrative metadata about MODS record)
   */
  private mapRecordInfo(manifest: ArkeManifest): ModsRecordInfo {
    return {
      recordContentSource: 'Arke Institute',
      recordIdentifier: manifest.pi,
      recordIdentifierSource: 'arke-pi',
      recordCreationDate: manifest.ts,
      descriptionStandard: 'pinax',
    };
  }
}
