/**
 * Batch processing utilities for parallel fetching
 */

/**
 * Process items in parallel batches
 *
 * @param items - Array of items to process
 * @param batchSize - Maximum concurrent operations per batch
 * @param processor - Async function to process each item
 * @returns Array of results in same order as inputs
 */
export async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Process items in parallel batches, collecting successful results and errors separately
 *
 * @param items - Array of items to process
 * @param batchSize - Maximum concurrent operations per batch
 * @param processor - Async function to process each item, should return { key, value } or throw
 * @returns Object with successful results map and array of errors
 */
export async function processBatchWithErrors<T, K, V>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<{ key: K; value: V }>
): Promise<{ results: Map<K, V>; errors: Array<{ item: T; error: Error }> }> {
  const results = new Map<K, V>();
  const errors: Array<{ item: T; error: Error }> = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(batch.map(processor));

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.set(result.value.key, result.value.value);
      } else {
        errors.push({ item: batch[j], error: result.reason });
      }
    }
  }

  return { results, errors };
}
