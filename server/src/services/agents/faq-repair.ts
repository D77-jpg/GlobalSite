// S35: deterministic FAQ repair for generated drafts. It never adds wording or
// facts: it only (1) rebalances existing sentences between answer and detail
// to meet the 40–60 word direct-answer lead, (2) cites confirmed facts whose
// literal value already appears in the FAQ text, and (3) drops FAQ items that
// still fail the fact gate, unless dropping would break the page composition.
import type { PageInput } from "../../validators/sites.validator";
import { isDemoFact, validatePage } from "../page-validation.service";
import { compositionIssues } from "../site-composition.service";

type Context = Parameters<typeof validatePage>[2];
type Fact = Parameters<typeof validatePage>[1][number];
type FactLike = {
  _id?: unknown;
  id?: unknown;
  status?: string;
  value?: unknown;
  revision?: number;
  subjectType?: string;
  subjectId?: unknown;
  source?: { kind?: string } | null;
};

const MIN = 40,
  MAX = 60,
  ANSWER_MAX = 1800,
  DETAIL_MAX = 2500,
  REFS_MAX = 50;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) =>
  s
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");

export function rebalanceFaqAnswer(answer: string, detail: string) {
  const a = sentences(answer),
    d = sentences(detail);
  if (words(answer) > MAX && a.length > 1) {
    const lead: string[] = [];
    while (a.length && words([...lead, a[0]].join(" ")) <= MAX)
      lead.push(a.shift()!);
    if (lead.length && words(lead.join(" ")) >= MIN) {
      const rest = [...a, ...d].join(" ");
      if (rest.length <= DETAIL_MAX)
        return { answer: lead.join(" "), detail: rest };
    }
  } else if (words(answer) < MIN && d.length) {
    const lead = [...a];
    while (d.length && words([...lead, d[0]].join(" ")) <= MAX)
      lead.push(d.shift()!);
    const expanded = lead.join(" ");
    if (words(expanded) >= MIN && expanded.length <= ANSWER_MAX)
      return { answer: expanded, detail: d.join(" ") };
  }
  return { answer, detail };
}

function citeLiteralFacts(
  block: PageInput["blocks"][number],
  text: string,
  facts: Fact[],
  context: Context,
) {
  const t = norm(text);
  for (const f of facts as FactLike[]) {
    if (block.refs.length >= REFS_MAX) return;
    const id = String(f._id ?? f.id ?? "");
    const value = String(f.value ?? "");
    if (
      !id ||
      !(
        f.status === "confirmed" ||
        (!!context.allowDemoFacts && isDemoFact(f))
      ) ||
      typeof f.revision !== "number" ||
      !/\d/.test(value)
    )
      continue;
    if (
      f.subjectType === "product" &&
      (!context.productIds.includes(String(f.subjectId)) ||
        (context.productId && String(f.subjectId) !== context.productId))
    )
      continue;
    const literal = norm(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exact = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?<!\\d[.,])${literal}(?![\\p{L}\\p{N}_]|[.,]\\d)`,
      "u",
    );
    if (!exact.test(t)) continue;
    if (block.refs.some((r) => r.factId === id)) continue;
    block.refs.push({ factId: id, revision: f.revision });
  }
}

export function repairFaq(
  input: PageInput,
  facts: Fact[],
  context: Context,
): PageInput {
  if ((context.language ?? "en") !== "en") return input;
  const page = structuredClone(input);
  for (const b of page.blocks) {
    b.faq = b.faq.map((f) => ({
      ...f,
      ...rebalanceFaqAnswer(f.answer, f.detail),
    }));
    for (const f of b.faq)
      citeLiteralFacts(
        b,
        f.question + " " + f.answer + " " + f.detail,
        facts,
        context,
      );
  }
  const failing = new Set(
    validatePage(page, facts, context)
      .map((i) => /^blocks\.([^.]+)\.faq\.(\d+)$/.exec(i.field))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => m[1] + "#" + m[2]),
  );
  if (!failing.size) return page;
  const pruned = structuredClone(page);
  for (const [index, b] of pruned.blocks.entries()) {
    b.faq = b.faq.filter((_, i) => !failing.has(b.key + "#" + i));
    b.refs = [...input.blocks[index].refs];
    for (const f of b.faq)
      citeLiteralFacts(
        b,
        f.question + " " + f.answer + " " + f.detail,
        facts,
        context,
      );
  }
  pruned.blocks = pruned.blocks.filter(
    (b) => !(b.type === "faq" && !b.faq.length && !b.body.trim()),
  );
  // Removing unsupported claims is always allowed; breaking page depth is not.
  return compositionIssues(pruned, context.type).length >
    compositionIssues(page, context.type).length
    ? page
    : pruned;
}
