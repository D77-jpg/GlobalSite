import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentJson } from "../src/services/agent-json.service";
test("agent JSON data tolerates fenced/prose envelopes without changing fields", () => {
  const expected = { proposal: { text: 'literal } and "quote"' } };
  assert.deepEqual(
    parseAgentJson("Here is the draft: " + JSON.stringify(expected) + " End."),
    expected,
  );
  assert.deepEqual(
    parseAgentJson(
      '<think>private reasoning {"draft":false}</think>\n{"draft":true}',
    ),
    { draft: true },
  );
  assert.deepEqual(
    parseAgentJson('\x60\x60\x60json\n{"draft":true}\n\x60\x60\x60'),
    { draft: true },
  );
});
test("malformed, partial and ambiguous model objects remain rejected", () => {
  for (const s of [
    "no JSON",
    '{"draft":true',
    '{"draft":true} {"draft":false}',
    '{"body":eval("bad")}',
  ])
    assert.throws(() => parseAgentJson(s));
});

test("bounded syntax repair preserves literal values and rejects executable expressions", () => {
  assert.deepEqual(parseAgentJson('{"name":"Artwork" "count":7,}'), {
    name: "Artwork",
    count: 7,
  });
  assert.deepEqual(parseAgentJson('{"body":"Line\nnext"}'), {
    body: "Line\nnext",
  });
  assert.throws(() => parseAgentJson('{"body":eval("bad")}'));
  assert.throws(() => parseAgentJson('{"name":"unfinished'));
  assert.throws(() => parseAgentJson('{"body":"unfinished}'));
  assert.throws(() => parseAgentJson('{"a":{"n":7}'));
});
