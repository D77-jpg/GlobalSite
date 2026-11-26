import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rebalanceFaqAnswer,
  repairFaq,
} from "../src/services/agents/faq-repair";

const w = (n: number, word = "espresso") => Array(n).fill(word).join(" ");
const ctx = { type: "faq", productIds: [], language: "en" };
const block = (
  faq: { question: string; answer: string; detail: string }[],
) => ({
  key: "faq",
  type: "faq" as const,
  heading: "Buying questions",
  body: "",
  table: null,
  faq,
  assetId: null,
  alt: "",
  refs: [] as { factId: string; revision: number }[],
});
const page = (b: ReturnType<typeof block>[]) => ({
  title: "FAQ",
  metaDescription: "",
  refs: [],
  blocks: b,
});

// S36: the direct-answer window is 30–80 English words (was 40–60).
test("long FAQ answers move whole sentences into detail", () => {
  const answer = w(50) + ". " + w(20) + ". " + w(25) + ".";
  const r = rebalanceFaqAnswer(answer, "Existing detail.");
  assert.equal(r.answer, w(50) + ". " + w(20) + ".");
  assert.equal(r.detail, w(25) + ". Existing detail.");
});

test("short FAQ answers borrow sentences from detail; others stay unchanged", () => {
  const r = rebalanceFaqAnswer(w(20) + ".", w(20) + ". " + w(50) + ".");
  assert.equal(r.answer, w(20) + ". " + w(20) + ".");
  assert.equal(r.detail, w(50) + ".");
  // 30–80 words is already a valid lead; a single long sentence stays as-is.
  assert.deepEqual(rebalanceFaqAnswer(w(70), ""), {
    answer: w(70),
    detail: "",
  });
  assert.deepEqual(rebalanceFaqAnswer(w(90), ""), {
    answer: w(90),
    detail: "",
  });
});

test("FAQ items with unsourced numbers are dropped, valid ones kept", () => {
  const good = {
    question: "Can the panels carry our brand?",
    answer: w(45) + ".",
    detail: "",
  };
  const bad = {
    question: "How fast is delivery?",
    answer: w(40) + " in 18 days.",
    detail: "",
  };
  const out = repairFaq(page([block([good, bad])]) as any, [], ctx as any);
  assert.deepEqual(out.blocks[0].faq, [good]);
});

test("confirmed facts already quoted in an FAQ are cited, never invented", () => {
  const fact = {
    _id: "a".repeat(24),
    status: "confirmed",
    revision: 2,
    subjectType: "organization",
    type: "product.leadTime",
    value: "18 days",
  };
  const item = {
    question: "What is the lead time?",
    answer: w(40) + " lead time is 18 days.",
    detail: "",
  };
  const out = repairFaq(page([block([item])]) as any, [fact], ctx as any);
  assert.deepEqual(out.blocks[0].refs, [{ factId: fact._id, revision: 2 }]);
  assert.equal(out.blocks[0].faq.length, 1);
});

test("automatic citations require a full value in a retained FAQ item", () => {
  const fact = {
    _id: "a".repeat(24),
    status: "confirmed",
    revision: 2,
    subjectType: "organization",
    type: "product.leadTime",
    value: "8 days",
  };
  const details = {
    question: "What is the lead time?",
    answer: w(45) + ".",
    detail: "",
  };
  const partial = { ...details, answer: w(42) + " in 18 days." };
  const deleted = { ...details, answer: "Lead time is 8 days." };
  const out = repairFaq(
    page([block([details, partial, deleted])]) as any,
    [fact],
    ctx as any,
  );
  assert.deepEqual(out.blocks[0].faq, [details]);
  assert.deepEqual(out.blocks[0].refs, []);
});
