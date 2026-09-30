/** Helpers shared by the CamCard scripts. */

export { isJapanese } from '../../shared/src/dedupe.ts';

/**
 * Runs `worker(item, index)` over `items`, `concurrency` at a time.
 *
 * Walks an index rather than shifting items off a queue, so a falsy item cannot end a worker's
 * loop early.
 */
export async function eachLimited(items, worker, concurrency) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}
