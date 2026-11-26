// S37 §4.6-1 & §4.7-2: bounded concurrency runner and layered page outline
// helpers (outline -> parallel block generation -> deterministic assembly).
// Preserves the existing PageInput contract so downstream repairGeneratedPage,
// validatePage and approval/publish gates run identically on assembled drafts.
import { z } from "zod";
import * as v from "../../validators/sites.validator";

/**
 * Runs an async worker over `items` with at most `concurrency` in-flight calls,
 * preserving input order in the returned array. Supports early stop via `shouldStop`.
 */
export async function runBounded<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<Array<R | undefined>> {
  const limit = Math.max(1, Math.min(8, Math.floor(concurrency) || 1));
  const results: Array<R | undefined> = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      if (shouldStop?.()) return;
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => next(),
  );
  await Promise.all(workers);
  return results;
}

export const blockOutline = z
  .object({
    key: v.block.shape.key,
    type: v.block.shape.type,
    heading: z.string().max(160),
    purpose: z.string().max(240),
    design: v.sectionDesign.optional(),
    factIds: z.array(z.string().max(40)).max(20).optional(),
  })
  .strict();

export const pageOutlineSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    metaDescription: z.string().trim().max(200),
    presentation: v.presentation,
    refs: z.array(v.factRef).max(50),
    blocks: z.array(blockOutline).min(1).max(12),
  })
  .strict();

export type PageOutline = z.infer<typeof pageOutlineSchema>;
export type BlockOutline = z.infer<typeof blockOutline>;

/**
 * Assembles independently generated blocks back into a single PageInput in the
 * outline's declared order, enforcing unique block keys and preserving the
 * outline's SEO metadata and presentation.
 */
export function mergeGeneratedBlocks(
  outline: PageOutline,
  generated: ReadonlyArray<v.PageInput["blocks"][number] | null | undefined>,
): v.PageInput {
  const seen = new Set<string>();
  const blocks: v.PageInput["blocks"] = [];
  for (let i = 0; i < outline.blocks.length; i++) {
    const plan = outline.blocks[i];
    const b = generated[i];
    if (!b || seen.has(b.key)) continue;
    seen.add(b.key);
    blocks.push({
      ...b,
      key: plan.key,
      type: plan.type,
      ...(b.design ? {} : plan.design ? { design: plan.design } : {}),
    });
  }
  return v.pageInput.parse({
    title: outline.title,
    metaDescription: outline.metaDescription,
    presentation: outline.presentation,
    refs: outline.refs,
    blocks,
  });
}
