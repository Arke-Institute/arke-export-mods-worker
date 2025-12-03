/**
 * Performance monitoring utilities
 */

import type { PerformanceMetrics } from './types.js';

export class PerformanceMonitor {
  private startTime: number;
  private timings: Map<string, number> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private metrics: PerformanceMetrics;

  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      timings: {
        manifestFetch: 0,
        componentDownloads: 0,
        pinaxParsing: 0,
        graphdbFetch: 0,
        total: 0,
      },
      memory: {
        peakUsage: 0,
        heapUsed: 0,
      },
      data: {
        totalBytesDownloaded: 0,
        componentsProcessed: 0,
        ocrTextSize: 0,
        finalJsonSize: 0,
      },
    };
  }

  /**
   * Start timing a specific operation
   */
  startTimer(label: string): void {
    this.activeTimers.set(label, Date.now());
  }

  /**
   * Stop timing an operation and record the duration
   */
  stopTimer(label: string): number {
    const start = this.activeTimers.get(label);
    if (!start) {
      // Silent fail for recursive scenarios where monitors might be shared
      return 0;
    }
    const duration = Date.now() - start;
    this.timings.set(label, duration);
    this.activeTimers.delete(label);
    return duration;
  }

  /**
   * Record a custom timing
   */
  recordTiming(label: keyof PerformanceMetrics['timings'], duration: number): void {
    this.metrics.timings[label] = duration;
  }

  /**
   * Add to cumulative data metrics
   */
  addDataMetric(metric: keyof PerformanceMetrics['data'], value: number): void {
    this.metrics.data[metric] += value;
  }

  /**
   * Sample current memory usage
   */
  sampleMemory(): void {
    const usage = process.memoryUsage();
    this.metrics.memory.heapUsed = usage.heapUsed;
    if (usage.heapUsed > this.metrics.memory.peakUsage) {
      this.metrics.memory.peakUsage = usage.heapUsed;
    }
  }

  /**
   * Get final metrics report
   */
  getMetrics(): PerformanceMetrics {
    this.metrics.timings.total = Date.now() - this.startTime;
    this.sampleMemory();
    return this.metrics;
  }

  /**
   * Format metrics as human-readable text
   */
  formatReport(): string {
    const m = this.getMetrics();
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('PERFORMANCE METRICS');
    lines.push('='.repeat(60));
    lines.push('');

    lines.push('TIMINGS:');
    lines.push(`  Manifest Fetch:        ${m.timings.manifestFetch.toFixed(0)}ms`);
    lines.push(`  Component Downloads:   ${m.timings.componentDownloads.toFixed(0)}ms`);
    lines.push(`  PINAX Parsing:         ${m.timings.pinaxParsing.toFixed(0)}ms`);
    lines.push(`  GraphDB Fetch:         ${m.timings.graphdbFetch.toFixed(0)}ms`);
    lines.push(`  TOTAL:                 ${m.timings.total.toFixed(0)}ms`);
    lines.push('');

    lines.push('MEMORY:');
    lines.push(`  Peak Usage:            ${formatBytes(m.memory.peakUsage)}`);
    lines.push(`  Heap Used:             ${formatBytes(m.memory.heapUsed)}`);
    lines.push('');

    lines.push('DATA:');
    lines.push(`  Bytes Downloaded:      ${formatBytes(m.data.totalBytesDownloaded)}`);
    lines.push(`  Components Processed:  ${m.data.componentsProcessed}`);
    lines.push(`  OCR Text Size:         ${formatBytes(m.data.ocrTextSize)}`);
    lines.push(`  Final JSON Size:       ${formatBytes(m.data.finalJsonSize)}`);
    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  /**
   * Log metrics to console
   */
  logReport(): void {
    console.error(this.formatReport());
  }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Create a scoped timer that auto-stops when disposed
 */
export function createTimer(monitor: PerformanceMonitor, label: string): () => number {
  monitor.startTimer(label);
  return () => monitor.stopTimer(label);
}
