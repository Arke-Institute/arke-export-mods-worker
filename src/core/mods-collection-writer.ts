/**
 * Streaming XML writer for MODS collections
 * Writes incrementally to avoid memory blowup
 */

import { createWriteStream, type WriteStream } from 'fs';

export interface EntityNode {
  pi: string;
  depth: number;
  parentPI?: string;
  pathFromRoot: string[];
}

export class ModsCollectionWriter {
  private stream?: WriteStream;
  private isOpen: boolean = false;

  /**
   * Open file stream and write collection header
   */
  async open(outputPath: string): Promise<void> {
    this.stream = createWriteStream(outputPath, { encoding: 'utf-8' });

    await this.write('<?xml version="1.0" encoding="UTF-8"?>\n');
    await this.write('<modsCollection xmlns="http://www.loc.gov/mods/v3" ');
    await this.write('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ');
    await this.write('xsi:schemaLocation="http://www.loc.gov/mods/v3 https://www.loc.gov/standards/mods/mods-3-8.xsd">\n');

    this.isOpen = true;
  }

  /**
   * Write a single MODS record to collection
   */
  async writeMods(modsXml: string, metadata: EntityNode): Promise<void> {
    if (!this.isOpen || !this.stream) {
      throw new Error('Writer not open - call open() first');
    }

    // Extract <mods>...</mods> content from full XML document
    const modsElement = this.extractModsElement(modsXml);

    // Add hierarchy metadata
    const enrichedMods = this.addHierarchyMetadata(modsElement, metadata);

    await this.write(enrichedMods + '\n');
  }

  /**
   * Close stream and write collection footer
   */
  async close(): Promise<void> {
    if (!this.stream) return;

    await this.write('</modsCollection>\n');

    return new Promise((resolve, reject) => {
      this.stream!.end((err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Write data to stream with backpressure handling
   */
  private write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) {
        reject(new Error('Stream not initialized'));
        return;
      }

      const canContinue = this.stream.write(data);
      if (canContinue) {
        process.nextTick(resolve);
      } else {
        this.stream.once('drain', resolve);
      }
    });
  }

  /**
   * Extract just the <mods>...</mods> element from full XML document
   */
  private extractModsElement(xml: string): string {
    // Remove XML declaration
    let content = xml.replace(/<\?xml[^>]*\?>\s*/, '');

    // Find opening <mods> tag
    const modsStart = content.indexOf('<mods');
    if (modsStart === -1) {
      throw new Error('No <mods> element found in XML');
    }

    content = content.substring(modsStart);

    // Already has proper format, just return with indentation
    return '  ' + content.split('\n').join('\n  ').trimEnd();
  }

  /**
   * Add hierarchy metadata to MODS element
   */
  private addHierarchyMetadata(modsXml: string, node: EntityNode): string {
    // Add ID attribute to opening <mods> tag
    const withId = modsXml.replace(
      /^(\s*<mods[^>]*)(>)/,
      `$1 ID="entity-${node.pi}"$2`
    );

    // Create hierarchy note
    const hierarchyNote = [
      '    <note type="hierarchy" displayLabel="Tree Position">',
      `      depth: ${node.depth}`,
      node.parentPI ? `, parent: ${node.parentPI}` : '',
      `, path: /${node.pathFromRoot.join('/')}`,
      '    </note>',
    ].join('');

    // Insert before closing </mods>
    const withNote = withId.replace(
      /(\s*)<\/mods>\s*$/,
      `\n${hierarchyNote}\n$1</mods>`
    );

    return withNote;
  }
}
