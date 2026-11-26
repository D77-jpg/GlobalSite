export interface PageDiffItem {
  kind: "meta" | "presentation" | "block-added" | "block-removed" | "block-moved" | "block-edited";
  target: string;
  detail?: string;
}

type DraftShape = {
  title?: string;
  metaDescription?: string;
  presentation?: Record<string, unknown>;
  refs?: unknown[];
  blocks?: Array<Record<string, any>>;
};

export function diffPageDraft(
  original: DraftShape,
  draft: DraftShape,
): PageDiffItem[] {
  const changes: PageDiffItem[] = [];
  if ((original.title ?? "") !== (draft.title ?? "")) {
    changes.push({ kind: "meta", target: "title" });
  }
  if ((original.metaDescription ?? "") !== (draft.metaDescription ?? "")) {
    changes.push({ kind: "meta", target: "metaDescription" });
  }
  if (JSON.stringify(original.refs ?? []) !== JSON.stringify(draft.refs ?? [])) {
    changes.push({ kind: "meta", target: "refs" });
  }
  if (
    JSON.stringify(original.presentation ?? null) !==
    JSON.stringify(draft.presentation ?? null)
  ) {
    changes.push({ kind: "presentation", target: "presentation" });
  }

  const origBlocks = original.blocks ?? [];
  const nextBlocks = draft.blocks ?? [];
  const origMap = new Map(origBlocks.map((b, idx) => [String(b.key), { b, idx }]));
  const nextMap = new Map(nextBlocks.map((b, idx) => [String(b.key), { b, idx }]));

  for (const [key, { b }] of origMap) {
    if (!nextMap.has(key)) {
      changes.push({
        kind: "block-removed",
        target: key,
        detail: String(b.heading || key),
      });
    }
  }
  for (const [key, { b, idx }] of nextMap) {
    const prev = origMap.get(key);
    if (!prev) {
      changes.push({
        kind: "block-added",
        target: key,
        detail: String(b.heading || key),
      });
      continue;
    }
    if (prev.idx !== idx) {
      changes.push({
        kind: "block-moved",
        target: key,
        detail: `${prev.idx + 1} → ${idx + 1}`,
      });
    }
    if (JSON.stringify(prev.b) !== JSON.stringify(b)) {
      changes.push({
        kind: "block-edited",
        target: key,
        detail: String(b.heading || key),
      });
    }
  }
  return changes;
}
