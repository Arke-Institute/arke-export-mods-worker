/**
 * Text utility functions for Pinax export
 */

/**
 * Result of text truncation
 */
export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/**
 * Truncate text to a maximum length, breaking at word boundaries
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length in characters
 * @returns Object with truncated text and whether truncation occurred
 */
export function truncateText(text: string, maxLength: number): TruncateResult {
  if (!text || text.length <= maxLength) {
    return { text: text || '', truncated: false };
  }

  // Find a good break point (word boundary) before maxLength
  let breakPoint = maxLength;

  // Look back up to 100 characters for a word boundary
  const lookBackLimit = Math.max(0, maxLength - 100);
  for (let i = maxLength; i > lookBackLimit; i--) {
    const char = text[i];
    if (char === ' ' || char === '\n' || char === '\t') {
      breakPoint = i;
      break;
    }
  }

  const truncated = text.slice(0, breakPoint).trim();

  return {
    text: truncated + '\n\n[... truncated ...]',
    truncated: true,
  };
}

/**
 * Estimate the byte size of a string (UTF-8)
 */
export function estimateByteSize(text: string): number {
  if (!text) return 0;
  // Rough estimate: ASCII chars = 1 byte, others = 2-4 bytes
  // Using TextEncoder would be more accurate but this is faster
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) size += 1;
    else if (code < 0x800) size += 2;
    else if (code < 0xd800 || code >= 0xe000) size += 3;
    else size += 4; // Surrogate pair
  }
  return size;
}

/**
 * Check if text exceeds a size threshold
 */
export function exceedsMaxLength(text: string | null | undefined, maxLength: number): boolean {
  if (!text) return false;
  return text.length > maxLength;
}

/**
 * Clean and normalize text (remove excessive whitespace, etc.)
 */
export function normalizeText(text: string): string {
  if (!text) return '';

  return text
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive blank lines (more than 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}
