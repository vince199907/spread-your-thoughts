import assert from "node:assert/strict";
import test from "node:test";
import { drawTarot, loadTarotDeck, readTarot } from "../src/tarot.js";
import { runIchingshifa } from "../src/ichingshifa.js";

test("complete RWS names and legacy major IDs stay distinct", () => {
  const deck = loadTarotDeck();
  assert.equal(deck.length, 78);
  assert.equal(new Set(deck.map(c => c.id)).size, 78);
  assert.equal(deck.filter(c => c.arcana === "major").length, 22);
  assert.equal(deck.find(c => c.id === "tarot-08")?.nameEn, "Strength");
  assert.equal(deck.find(c => c.id === "tarot-11")?.nameEn, "Justice");
  assert.equal(deck.find(c => c.id === "tarot-pentacles-knight")?.nameZh, "星币骑士");
  assert.equal(drawTarot(5).ok, true);
});

test("78-card seed is replayable, without replacement and orientations are opt-in", () => {
  const input = { spread: "three", seed: 5, reversals: true };
  const run = readTarot(input);
  assert.deepEqual(run, readTarot(input));
  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.equal(new Set(run.result.cards.map(c => c.id)).size, 3);
  assert.equal(run.result.trace.algorithm, "mulberry32-remove-v1");
  assert.equal(run.result.trace.seed, 5);
  const noReverse = readTarot({ spread: "three", seed: 9 });
  if (!noReverse.ok) assert.fail(noReverse.error.message);
  assert.ok(noReverse.result.cards.every(c => c.orientation === "upright"));
});

test("manual spread retains order and refuses repeats, unknown cards and unapproved reverse", () => {
  const input = {
    spread: "three", reversals: true,
    cards: [{ id: "tarot-00" }, { id: "tarot-cups-queen", orientation: "reversed" }, { id: "tarot-11" }],
  };
  const run = readTarot(input);
  if (!run.ok) assert.fail(run.error.message);
  assert.equal(run.result.method, "manual");
  assert.equal(run.result.trace.seed, null);
  assert.deepEqual(run.result.cards.map(c => c.id), input.cards.map(c => c.id));
  assert.equal(run.result.cards[1].orientation, "reversed");
  for (const invalid of [
    { ...input, reversals: false },
    { ...input, seed: 11 },
    { ...input, cards: [input.cards[0], input.cards[1], input.cards[0]] },
    { ...input, cards: [null, null, null] },
    { spread: "single", cards: [{ id: "oops" }] },
  ]) assert.equal(readTarot(invalid).ok, false);
});

test("actual optional ichingshifa validates names, order and replay or reports unavailable", () => {
  const manual = runIchingshifa("789789");
  const seeded = runIchingshifa({ seed: 42 });
  if (process.env.THOUGHTS_REQUIRE_ICHINGSHIFA !== "1" && !manual.ok) {
    assert.equal(manual.error.code, "ICHINGSHIFA_UNAVAILABLE");
    assert.notEqual(seeded.ok, true);
    return;
  }
  if (!manual.ok) assert.fail(manual.error.message);
  if (!seeded.ok) assert.fail(seeded.error.message);
  assert.equal(manual.result.packageVersion, "3.1.9");
  assert.equal(manual.result.primaryName, "離");
  assert.equal(manual.result.changedName, "震");
  assert.deepEqual(manual.result.changingPositions, [3, 6]);
  assert.deepEqual(seeded, runIchingshifa({ seed: 42 }));
  assert.equal(seeded.result.method, "upstream-yarrow-simulation");
  const replay = runIchingshifa(String(seeded.result.inputBottomUp));
  if (!replay.ok) assert.fail(replay.error.message);
  assert.equal(replay.result.primaryName, seeded.result.primaryName);
  assert.equal(replay.result.changedName, seeded.result.changedName);
});

test("all 78 cards have separate observation prompts rather than user assertions", () => {
  const deck = loadTarotDeck();
  assert.ok(deck.every(c => typeof c.symbolicPrompt === "string" && c.symbolicPrompt.endsWith("？")));
  assert.ok(deck.find(c => c.id === "tarot-cups-queen")?.symbolicPrompt.includes("感受与关系"));
  assert.equal(new Set(deck.map(c => c.symbolicPrompt)).size, 78);
});
