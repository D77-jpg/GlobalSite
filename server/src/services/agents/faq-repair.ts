// S35: deterministic FAQ repair for generated drafts. It never adds wording or
// facts: it only (1) rebalances existing sentences between answer and detail
// to meet the 30–80 word direct-answer lead (S36; was 40–60), (2) cites
// citable facts whose value the FAQ text already quotes (shared S36 rule in
// ref-completion.ts), and (3) drops unsupported FAQ items when the page
// composition allows it. Duplicate answers remain visible to the retry gate.
import type { PageInput } from "../../validators/sites.validator";
import {
  FAQ_MAX_WORDS,
  FAQ_MIN_WORDS,
  validatePage,
} from "../page-validation.service";
import { compositionIssues } from "../site-composition.service";
import { citeQuotedFacts, type ProductName } from "./ref-completion";

type Context = Parameters<typeof validatePage>[2];
type Fact = Parameters<typeof validatePage>[1][number];

const MIN = FAQ_MIN_WORDS,
  MAX = FAQ_MAX_WORDS,
  ANSWER_MAX = 1800,
  DETAIL_MAX = 2500;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) =>
  s
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

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
  products: ReadonlyArray<ProductName>,
) {
  citeQuotedFacts(block.refs, text, facts, context, block.key, products);
}

export function repairFaq(
  input: PageInput,
  facts: Fact[],
  context: Context,
  products: ReadonlyArray<ProductName> = [],
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
        products,
      );
  }
  const failing = new Set(
    validatePage(page, facts, context)
      .filter((issue) => issue.code !== "FAQ_DUPLICATE_ANSWER")
      .map((i) => /^blocks\.([^.]+)\.faq\.(\d+)$/.exec(i.field))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => m[1] + "#" + m[2]),
  );
  const required = new Set(context.requiredProductSections ?? []);
  const shouldDropEmptyFaq = (b: PageInput["blocks"][number]) =>
    b.type === "faq" &&
    !b.faq.length &&
    !(context.type === "product" && required.has(b.key));
  const hasEmptyFaq = page.blocks.some(shouldDropEmptyFaq);
  if (!failing.size && !hasEmptyFaq) return page;
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
        products,
      );
  }
  // S37 §1.3: drop any non-required FAQ block whose items are all empty/pruned
  // (section() does not render block.body for faq blocks, so 0 items = empty).
  pruned.blocks = pruned.blocks.filter((b) => !shouldDropEmptyFaq(b));
  // Removing unsupported claims is always allowed; breaking page depth is not.
  return compositionIssues(pruned, context.type).length >
    compositionIssues(page, context.type).length
    ? page
    : pruned;
}
