/**
 * MODS XML generator
 * Converts ModsDocument structure to MODS 3.8 XML using xml-js
 */

import { js2xml, type ElementCompact } from 'xml-js';
import type { ModsDocument, ModsName, ModsSubject, ModsRelatedItem } from './types.js';

export class ModsXmlGenerator {
  /**
   * Generate MODS 3.8 XML from ModsDocument structure
   */
  generate(mods: ModsDocument): string {
    const modsElement: ElementCompact = {
      _declaration: {
        _attributes: {
          version: '1.0',
          encoding: 'UTF-8',
        },
      },
      mods: {
        _attributes: {
          'xmlns': 'http://www.loc.gov/mods/v3',
          'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          'xsi:schemaLocation': 'http://www.loc.gov/mods/v3 https://www.loc.gov/standards/mods/mods-3-8.xsd',
        },
        ...this.buildModsElements(mods),
      },
    };

    return js2xml(modsElement, {
      compact: true,
      spaces: 2,
      fullTagEmptyElement: true,
    });
  }

  /**
   * Build MODS child elements
   */
  private buildModsElements(mods: ModsDocument): ElementCompact {
    const elements: ElementCompact = {};

    // <titleInfo>
    if (mods.titleInfo.length > 0) {
      elements.titleInfo = mods.titleInfo.map(ti => this.buildTitleInfo(ti));
    }

    // <name> (creators and subject names)
    if (mods.names.length > 0) {
      elements.name = mods.names.map(name => this.buildName(name));
    }

    // <typeOfResource>
    if (mods.typeOfResource) {
      elements.typeOfResource = {
        _text: mods.typeOfResource,
      };
    }

    // <genre>
    if (mods.genre && mods.genre.length > 0) {
      elements.genre = mods.genre.map(g => ({ _text: g }));
    }

    // <originInfo>
    if (mods.originInfo) {
      elements.originInfo = this.buildOriginInfo(mods.originInfo);
    }

    // <language>
    if (mods.language && mods.language.length > 0) {
      elements.language = mods.language.map(lang => ({
        languageTerm: {
          _attributes: {
            type: lang.type,
            authority: lang.authority,
          },
          _text: lang.languageTerm,
        },
      }));
    }

    // <physicalDescription>
    if (mods.physicalDescription) {
      elements.physicalDescription = this.buildPhysicalDescription(mods.physicalDescription);
    }

    // <abstract>
    if (mods.abstract) {
      elements.abstract = {
        _text: mods.abstract,
      };
    }

    // <tableOfContents>
    if (mods.tableOfContents) {
      elements.tableOfContents = {
        _text: mods.tableOfContents,
      };
    }

    // <targetAudience>
    if (mods.targetAudience) {
      elements.targetAudience = {
        _text: mods.targetAudience,
      };
    }

    // <note>
    if (mods.notes.length > 0) {
      elements.note = mods.notes.map(note => ({
        _attributes: {
          type: note.type,
          displayLabel: note.displayLabel,
        },
        _text: note.text,
      }));
    }

    // <subject>
    if (mods.subjects.length > 0) {
      elements.subject = mods.subjects.map(subj => this.buildSubject(subj));
    }

    // <classification>
    if (mods.classification && mods.classification.length > 0) {
      elements.classification = mods.classification.map(cls => ({
        _attributes: {
          authority: cls.authority,
        },
        _text: cls.value,
      }));
    }

    // <relatedItem>
    if (mods.relatedItems.length > 0) {
      elements.relatedItem = mods.relatedItems.map(item => this.buildRelatedItem(item));
    }

    // <identifier>
    if (mods.identifiers.length > 0) {
      elements.identifier = mods.identifiers.map(id => ({
        _attributes: {
          type: id.type,
          displayLabel: id.displayLabel,
        },
        _text: id.value,
      }));
    }

    // <location>
    if (mods.location) {
      elements.location = this.buildLocation(mods.location);
    }

    // <accessCondition>
    if (mods.accessConditions.length > 0) {
      elements.accessCondition = mods.accessConditions.map(ac => ({
        _attributes: {
          type: ac.type,
        },
        _text: ac.text,
      }));
    }

    // <recordInfo>
    elements.recordInfo = this.buildRecordInfo(mods.recordInfo);

    return elements;
  }

  private buildTitleInfo(ti: any): ElementCompact {
    const elem: ElementCompact = {};

    if (ti.type || ti.displayLabel) {
      elem._attributes = {};
      if (ti.type) elem._attributes.type = ti.type;
      if (ti.displayLabel) elem._attributes.displayLabel = ti.displayLabel;
    }

    if (ti.title) {
      elem.title = { _text: ti.title };
    }

    if (ti.subTitle) {
      elem.subTitle = { _text: ti.subTitle };
    }

    return elem;
  }

  private buildName(name: ModsName): ElementCompact {
    const elem: ElementCompact = {
      _attributes: {
        type: name.type,
      },
    };

    // <namePart>
    if (name.nameParts.length > 0) {
      elem.namePart = name.nameParts.map(part => ({ _text: part }));
    }

    // <displayForm>
    if (name.displayForm) {
      elem.displayForm = { _text: name.displayForm };
    }

    // <role>
    if (name.roles && name.roles.length > 0) {
      elem.role = name.roles.map(role => ({
        roleTerm: {
          _attributes: {
            type: role.type,
            authority: role.authority,
          },
          _text: role.roleTerm,
        },
      }));
    }

    return elem;
  }

  private buildOriginInfo(oi: any): ElementCompact {
    const elem: ElementCompact = {};

    if (oi.places && oi.places.length > 0) {
      elem.place = oi.places.map((p: string) => ({
        placeTerm: {
          _attributes: { type: 'text' },
          _text: p,
        },
      }));
    }

    if (oi.publisher) {
      elem.publisher = { _text: oi.publisher };
    }

    if (oi.dateCreated) {
      const attrs: any = {};
      if (oi.encoding) attrs.encoding = oi.encoding;
      if (oi.keyDate) attrs.keyDate = 'yes';

      elem.dateCreated = {
        _attributes: attrs,
        _text: oi.dateCreated,
      };
    }

    if (oi.dateIssued) {
      elem.dateIssued = { _text: oi.dateIssued };
    }

    return elem;
  }

  private buildPhysicalDescription(pd: any): ElementCompact {
    const elem: ElementCompact = {};

    if (pd.form) {
      elem.form = { _text: pd.form };
    }

    if (pd.extent) {
      elem.extent = { _text: pd.extent };
    }

    if (pd.internetMediaType) {
      elem.internetMediaType = { _text: pd.internetMediaType };
    }

    if (pd.digitalOrigin) {
      elem.digitalOrigin = { _text: pd.digitalOrigin };
    }

    if (pd.note) {
      elem.note = { _text: pd.note };
    }

    return elem;
  }

  private buildSubject(subj: ModsSubject): ElementCompact {
    const elem: ElementCompact = {};

    if (subj.authority) {
      elem._attributes = { authority: subj.authority };
    }

    if (subj.topics && subj.topics.length > 0) {
      elem.topic = subj.topics.map(t => ({ _text: t }));
    }

    if (subj.geographic && subj.geographic.length > 0) {
      elem.geographic = subj.geographic.map(g => ({ _text: g }));
    }

    if (subj.temporal && subj.temporal.length > 0) {
      elem.temporal = subj.temporal.map(t => ({ _text: t }));
    }

    if (subj.names && subj.names.length > 0) {
      elem.name = subj.names.map(name => this.buildName(name));
    }

    if (subj.titleInfo) {
      elem.titleInfo = this.buildTitleInfo(subj.titleInfo);
    }

    if (subj.occupation) {
      elem.occupation = { _text: subj.occupation };
    }

    if (subj.genre) {
      elem.genre = { _text: subj.genre };
    }

    return elem;
  }

  private buildRelatedItem(item: ModsRelatedItem): ElementCompact {
    const elem: ElementCompact = {
      _attributes: {
        type: item.type,
      },
    };

    if (item.displayLabel && elem._attributes) {
      elem._attributes.displayLabel = item.displayLabel;
    }

    if (item.titleInfo) {
      elem.titleInfo = this.buildTitleInfo(item.titleInfo);
    }

    if (item.identifiers && item.identifiers.length > 0) {
      elem.identifier = item.identifiers.map(id => ({
        _attributes: {
          type: id.type,
          displayLabel: id.displayLabel,
        },
        _text: id.value,
      }));
    }

    if (item.location) {
      elem.location = this.buildLocation(item.location);
    }

    if (item.physicalDescription) {
      elem.physicalDescription = this.buildPhysicalDescription(item.physicalDescription);
    }

    if (item.notes && item.notes.length > 0) {
      elem.note = item.notes.map(note => ({
        _attributes: {
          type: note.type,
          displayLabel: note.displayLabel,
        },
        _text: note.text,
      }));
    }

    return elem;
  }

  private buildLocation(loc: any): ElementCompact {
    const elem: ElementCompact = {};

    if (loc.physicalLocation) {
      elem.physicalLocation = { _text: loc.physicalLocation };
    }

    if (loc.urls && loc.urls.length > 0) {
      elem.url = loc.urls.map((u: any) => ({
        _attributes: {
          usage: u.usage,
          access: u.access,
          displayLabel: u.displayLabel,
        },
        _text: u.url,
      }));
    }

    return elem;
  }

  private buildRecordInfo(ri: any): ElementCompact {
    const elem: ElementCompact = {};

    if (ri.recordContentSource) {
      elem.recordContentSource = { _text: ri.recordContentSource };
    }

    if (ri.recordIdentifier) {
      const attrs: any = {};
      if (ri.recordIdentifierSource) {
        attrs.source = ri.recordIdentifierSource;
      }
      elem.recordIdentifier = {
        _attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
        _text: ri.recordIdentifier,
      };
    }

    if (ri.recordCreationDate) {
      elem.recordCreationDate = {
        _attributes: { encoding: 'w3cdtf' },
        _text: ri.recordCreationDate,
      };
    }

    if (ri.recordChangeDate) {
      elem.recordChangeDate = {
        _attributes: { encoding: 'w3cdtf' },
        _text: ri.recordChangeDate,
      };
    }

    if (ri.recordOrigin) {
      elem.recordOrigin = { _text: ri.recordOrigin };
    }

    if (ri.languageOfCataloging) {
      elem.languageOfCataloging = {
        languageTerm: {
          _attributes: {
            type: ri.languageOfCataloging.type,
            authority: ri.languageOfCataloging.authority,
          },
          _text: ri.languageOfCataloging.languageTerm,
        },
      };
    }

    if (ri.descriptionStandard) {
      elem.descriptionStandard = { _text: ri.descriptionStandard };
    }

    return elem;
  }
}
