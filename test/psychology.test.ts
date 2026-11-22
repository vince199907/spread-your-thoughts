import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repoRoot } from "../src/paths.js";
import { listOptionalPrompts, summarizePsychology } from "../src/psychology.js";

function must<T>(result: { ok: true; result: T } | { ok: false; error: { code: string } }): T {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.result;
}

test("empty evidence leaves every dimension unknown and scores nothing", () => {
  const result = must(summarizePsychology({ synthetic: true, evidence: [] }));
  const questionnaire = result.questionnaire as { answeredCount: number; responses: null; scored: boolean; administered: boolean };
  assert.equal(questionnaire.answeredCount, 0);
  assert.equal(questionnaire.responses, null);
  assert.equal(questionnaire.scored, false);
  assert.equal(questionnaire.administered, false);
  for (const name of ["extraversion", "agreeableness", "conscientiousness", "neuroticism", "intellect"]) {
    const dimension = (result.dimensions as Record<string, { stable: string; longTerm: string; cues: unknown[] }>)[name];
    assert.equal(dimension.stable, "unknown");
    assert.equal(dimension.longTerm, "unknown");
    assert.deepEqual(dimension.cues, []);
  }
  assert.equal(result.emotionalStabilityScore, null);
  assert.equal(result.accuracyProbability, null);
  assert.equal(result.broadOpenness, "not-measured");
  assert.equal((result.mbti as { value: null }).value, null);
});

test("one or two behavior cues do not complete the 20 items", () => {
  const raw = JSON.parse(readFileSync(`${repoRoot()}/examples/psychology-two-behaviors.json`, "utf8"));
  const result = must(summarizePsychology(raw));
  const questionnaire = result.questionnaire as { answeredCount: number; itemCountInBank: number; answeredItemIds: string[] };
  assert.equal(questionnaire.itemCountInBank, 20);
  assert.equal(questionnaire.answeredCount, 0);
  assert.deepEqual(questionnaire.answeredItemIds, []);
  const dimensions = result.dimensions as Record<string, { stable: string; exploratoryLabel: string | null }>;
  assert.equal(dimensions.extraversion.exploratoryLabel, "long-term-low");
  assert.equal(dimensions.intellect.exploratoryLabel, "long-term-high");
  assert.equal(dimensions.agreeableness.stable, "unknown");
  assert.equal(dimensions.conscientiousness.stable, "unknown");
  assert.equal(dimensions.neuroticism.stable, "unknown");
  const englishItem = must(summarizePsychology({
    evidence: [{
      quoteId: "s1",
      quote: "Am the life of the party.",
      dimension: "extraversion",
      pole: "high",
      timeScope: "long-term",
    }],
  }));
  assert.equal((englishItem.questionnaire as { answeredCount: number }).answeredCount, 0);
});

test("raw negation, acute state, contradiction, and unmatched sentences stay narrow", () => {
  const negated = must(summarizePsychology({ utterances: [{ id: "u1", text: "我并不喜欢聚会" }] }));
  const extra = (negated.dimensions as { extraversion: { unclear: string; longTerm: string; cues: { pole: string }[] } }).extraversion;
  assert.equal(extra.unclear, "low");
  assert.equal(extra.longTerm, "unknown");
  assert.equal(extra.cues[0].pole, "low");

  const complex = must(summarizePsychology({ utterances: [{ id: "u1", text: "我不是不喜欢聚会" }] }));
  assert.deepEqual((complex.dimensions as { extraversion: { cues: unknown[] } }).extraversion.cues, []);
  assert.equal((complex.ignored as { reason: string }[])[0].reason, "complex-negation");

  const acute = must(summarizePsychology(JSON.parse(readFileSync(`${repoRoot()}/examples/psychology-raw-acute.json`, "utf8"))));
  const neuroticism = (acute.dimensions as { neuroticism: { stable: string; acute: string; longTerm: string; emotionalStabilityScore: null } }).neuroticism;
  assert.equal(neuroticism.acute, "high");
  assert.equal(neuroticism.longTerm, "unknown");
  assert.equal(neuroticism.stable, "unknown");
  assert.equal(neuroticism.emotionalStabilityScore, null);

  const mixed = must(summarizePsychology(JSON.parse(readFileSync(`${repoRoot()}/examples/psychology-raw-contradiction.json`, "utf8"))));
  const both = (mixed.dimensions as { extraversion: { longTerm: string; stable: string; cues: { quoteId: string; counterexample: boolean }[] } }).extraversion;
  assert.equal(both.longTerm, "contradictory");
  assert.equal(both.stable, "contradictory");
  assert.deepEqual(both.cues.map((cue) => cue.quoteId).sort(), ["u1-1", "u1-2"]);
  assert.equal(both.cues.some((cue) => cue.counterexample), true);

  const unmatched = must(summarizePsychology({ utterances: [{ id: "u1", text: "今天天气不错" }] }));
  assert.equal((unmatched.dimensions as { extraversion: { stable: string } }).extraversion.stable, "unknown");
  assert.equal((unmatched.unmatched as { text: string }[])[0].text, "今天天气不错");

  const novelty = must(summarizePsychology({ utterances: [{ id: "u1", text: "我想先试试没见过的做法" }] }));
  assert.equal((novelty.dimensions as { intellect: { stable: string } }).intellect.stable, "unknown");
  assert.equal(((novelty.themes as { novelty: { cues: unknown[]; scoredAsBigFive: boolean } }).novelty.cues).length, 1);
  assert.equal((novelty.themes as { novelty: { scoredAsBigFive: boolean } }).novelty.scoredAsBigFive, false);
});

test("the same chat with different birth data yields the same profile", () => {
  const a = JSON.parse(readFileSync(`${repoRoot()}/examples/psychology-birth-a.json`, "utf8"));
  const b = JSON.parse(readFileSync(`${repoRoot()}/examples/psychology-birth-b.json`, "utf8"));
  const left = must(summarizePsychology(a));
  const right = must(summarizePsychology(b));
  assert.deepEqual(left, right);
  const text = JSON.stringify(left);
  assert.equal(text.includes("1990"), false);
  assert.equal(text.includes("2001"), false);
  assert.equal(text.includes("乙酉"), false);
  assert.equal(text.includes("日主"), false);
});

test("structured poles are not rewritten, and birth fields are not features", () => {
  const result = must(summarizePsychology({
    evidence: [{
      quoteId: "s1",
      quote: "我喜欢聚会",
      dimension: "extraversion",
      pole: "low",
      timeScope: "long-term",
    }],
    birth: { year: 2005, month: 12, day: 23, hour: 8, gender: "female" },
  }));
  assert.equal((result.dimensions as { extraversion: { cues: { pole: string }[] } }).extraversion.cues[0].pole, "low");
  const source = readFileSync(`${repoRoot()}/src/psychology.ts`, "utf8")
    + readFileSync(`${repoRoot()}/src/psychology-match.ts`, "utf8");
  assert.equal(source.includes("lunar-javascript"), false);
  assert.equal(source.includes("computeBazi"), false);
});

test("questionnaire answers and derived MBTI are refused", () => {
  const refused = summarizePsychology({ answers: [1, 2, 3], evidence: [] });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, "QUESTIONNAIRE_SCORE_REFUSED");
  const bad = summarizePsychology({ selfReportedMbti: "ABCD", evidence: [] });
  assert.equal(bad.ok, false);
  const reported = must(summarizePsychology({ selfReportedMbti: "infp", evidence: [] }));
  assert.deepEqual(reported.mbti, {
    value: "INFP",
    source: "self-report",
    notAssessed: true,
    derivedFromIpip: false,
    derivedFromBirth: false,
  });
  const openness = summarizePsychology({
    evidence: [{ quoteId: "s1", quote: "我喜欢新东西", dimension: "openness", pole: "high", timeScope: "long-term" }],
  });
  assert.equal(openness.ok, false);
  if (openness.ok) return;
  assert.equal(openness.error.code, "BROAD_OPENNESS_NOT_MEASURED");
});

test("ipip bank has the official 20 items and two optional prompts", () => {
  const items = JSON.parse(readFileSync(`${repoRoot()}/data/ipip-items.json`, "utf8")) as {
    itemCount: number;
    items: { text: string; dimension: string; key: string }[];
    signNotes: { neuroticism: string; intellect: string };
  };
  assert.equal(items.itemCount, 20);
  assert.equal(items.items.length, 20);
  assert.equal(items.items[0].text, "Am the life of the party.");
  assert.equal(items.items[3].key, "+");
  assert.equal(items.items[3].dimension, "neuroticism");
  assert.equal(items.items[8].key, "-");
  assert.equal(items.items[4].dimension, "intellect");
  assert.equal(items.items.filter((item) => item.dimension === "intellect" && item.key === "+").length, 1);
  assert.match(items.signNotes.neuroticism, /Neuroticism/);
  assert.match(items.signNotes.intellect, /not broad Openness/);
  const prompts = must(listOptionalPrompts());
  assert.equal(prompts.compulsory, false);
  assert.equal(prompts.maxOptionalPrompts, 2);
  assert.equal((prompts.prompts as unknown[]).length, 2);
});
