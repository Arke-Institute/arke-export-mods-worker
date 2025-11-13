/**
 * MODS Exporter - Main orchestrator
 * Coordinates fetching, processing, and XML generation
 */

import type { ExportConfig } from './types.js';
import { PerformanceMonitor } from './performance.js';
import { ArkeApiClient } from './api-client.js';
import { PinaxModsCrosswalk } from './crosswalk.js';
import { CheimarrosProcessor } from './cheimarros-processor.js';
import { ComponentLinker } from './component-linker.js';
import { ModsXmlGenerator } from './mods-generator.js';

export class ModsExporter {
  private monitor: PerformanceMonitor;
  private apiClient: ArkeApiClient;
  private crosswalk: PinaxModsCrosswalk;
  private cheimarrosProcessor: CheimarrosProcessor;
  private componentLinker: ComponentLinker;
  private xmlGenerator: ModsXmlGenerator;

  constructor(private config: ExportConfig) {
    this.monitor = new PerformanceMonitor();
    this.apiClient = new ArkeApiClient(config, this.monitor);
    this.crosswalk = new PinaxModsCrosswalk(config);
    this.cheimarrosProcessor = new CheimarrosProcessor(config);
    this.componentLinker = new ComponentLinker(config, this.apiClient);
    this.xmlGenerator = new ModsXmlGenerator();
  }

  /**
   * Export a PI to MODS XML
   */
  async export(pi: string): Promise<string> {
    if (this.config.verbose) {
      console.error(`\n${'='.repeat(60)}`);
      console.error(`MODS EXPORT: ${pi}`);
      console.error('='.repeat(60));
    }

    try {
      // Step 1: Fetch manifest
      if (this.config.verbose) {
        console.error('\n[STEP 1] Fetching manifest...');
      }
      const manifest = await this.apiClient.fetchManifest(pi);
      this.monitor.sampleMemory();

      // Step 2: Download components
      if (this.config.verbose) {
        console.error('\n[STEP 2] Downloading components...');
      }
      this.monitor.startTimer('componentDownloads');

      const [pinax, description, cheimarros, refJsonFiles] = await Promise.all([
        this.apiClient.fetchPinax(manifest),
        this.apiClient.fetchDescription(manifest),
        this.apiClient.fetchCheimarros(manifest),
        this.apiClient.fetchRefJsonFiles(manifest),
      ]);

      const componentDownloadTime = this.monitor.stopTimer('componentDownloads');
      this.monitor.recordTiming('componentDownloads', componentDownloadTime);
      this.monitor.addDataMetric('componentsProcessed', refJsonFiles.size + 3); // +3 for pinax, description, cheimarros
      this.monitor.sampleMemory();

      // Step 3: Parse PINAX and create base MODS structure
      if (this.config.verbose) {
        console.error('\n[STEP 3] Processing PINAX metadata...');
      }
      this.monitor.startTimer('pinaxParsing');

      if (!pinax) {
        throw new Error('No pinax.json found - cannot generate MODS without PINAX metadata');
      }

      const mods = this.crosswalk.crosswalk(pinax, manifest, description);

      const pinaxParsingTime = this.monitor.stopTimer('pinaxParsing');
      this.monitor.recordTiming('pinaxParsing', pinaxParsingTime);
      this.monitor.sampleMemory();

      // Step 4: Process cheimarros graph
      if (cheimarros && this.config.cheimarrosMode !== 'skip') {
        if (this.config.verbose) {
          console.error('\n[STEP 4] Processing cheimarros graph...');
        }
        this.monitor.startTimer('cheimarrosProcessing');

        const cheirResult = this.cheimarrosProcessor.process(cheimarros);

        // Merge cheimarros subjects with existing subjects
        mods.subjects.push(...cheirResult.subjects);

        // Add cheimarros names as subject names
        for (const name of cheirResult.names) {
          // Check if it's a subject name (not a creator)
          if (name.isSubject) {
            mods.subjects.push({ names: [name] });
          }
        }

        // Add cheimarros notes
        mods.notes.push(...cheirResult.notes);

        const cheimarrosProcessingTime = this.monitor.stopTimer('cheimarrosProcessing');
        this.monitor.recordTiming('cheimarrosProcessing', cheimarrosProcessingTime);

        if (this.config.verbose) {
          console.error(`[CHEIR] ✓ Added ${cheirResult.subjects.length} subjects, ${cheirResult.names.length} names, ${cheirResult.notes.length} notes`);
        }
      } else {
        this.monitor.recordTiming('cheimarrosProcessing', 0);
      }

      this.monitor.sampleMemory();

      // Step 5: Link components as relatedItems
      if (this.config.verbose) {
        console.error('\n[STEP 5] Linking components...');
      }

      // Link .ref.json files (images, PDFs, etc.)
      const refJsonItems = this.componentLinker.linkRefJsonComponents(refJsonFiles);
      mods.relatedItems.push(...refJsonItems);

      if (this.config.verbose && refJsonItems.length > 0) {
        console.error(`[LINK] ✓ Linked ${refJsonItems.length} .ref.json files`);
      }

      // Link parent
      const parentItem = this.componentLinker.linkParent(manifest);
      if (parentItem) {
        mods.relatedItems.push(parentItem);
        if (this.config.verbose) {
          console.error(`[LINK] ✓ Linked parent: ${manifest.parent_pi}`);
        }
      }

      // Link children
      const childItems = this.componentLinker.linkChildren(manifest);
      mods.relatedItems.push(...childItems);

      if (this.config.verbose && childItems.length > 0) {
        console.error(`[LINK] ✓ Linked ${childItems.length} children`);
      }

      // Add child inventory note
      const childNote = this.componentLinker.createChildInventoryNote(manifest);
      if (childNote) {
        mods.notes.push(childNote);
      }

      // Link other components (HTML, TXT, etc.)
      const refJsonKeys = new Set(refJsonFiles.keys());
      const otherItems = this.componentLinker.linkOtherComponents(manifest, refJsonKeys);
      mods.relatedItems.push(...otherItems);

      if (this.config.verbose && otherItems.length > 0) {
        console.error(`[LINK] ✓ Linked ${otherItems.length} other components`);
      }

      // Add component inventory note
      const componentNote = this.componentLinker.createComponentInventoryNote(manifest);
      mods.notes.push(componentNote);

      this.monitor.sampleMemory();

      // Step 6: Generate MODS XML
      if (this.config.verbose) {
        console.error('\n[STEP 6] Generating MODS XML...');
      }
      this.monitor.startTimer('modsGeneration');

      const xml = this.xmlGenerator.generate(mods);

      const modsGenerationTime = this.monitor.stopTimer('modsGeneration');
      this.monitor.recordTiming('modsGeneration', modsGenerationTime);
      this.monitor.addDataMetric('finalXmlSize', xml.length);
      this.monitor.sampleMemory();

      if (this.config.verbose) {
        console.error(`[XML] ✓ Generated ${formatBytes(xml.length)} of MODS XML`);
      }

      // Step 7: Log performance metrics
      if (this.config.verbose) {
        console.error('');
        this.monitor.logReport();
      }

      return xml;

    } catch (error) {
      if (this.config.verbose) {
        console.error(`\n[ERROR] Export failed: ${error}`);
        this.monitor.logReport();
      }
      throw error;
    }
  }

  /**
   * Get performance metrics from last export
   */
  getMetrics() {
    return this.monitor.getMetrics();
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
