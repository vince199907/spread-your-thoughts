import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";
import { fail, ok, type Result } from "./result.js";

export const DIMENSIONS = [
  "extraversion",
  "agreeableness",
  "conscientiousness",
  "neuroticism",
  "intellect",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];
export type Pole = "high" | "low";
export type TimeScope = "long-term" | "recent" | "unclear" | "acute";

export interface Cue {
  quoteId: string;
  sourceUtteranceId: string;
  quote: string;
  dimension: Dimension;
  pole: Pole;
  timeScope: TimeScope;
  timeScopeConflict: boolean;
  counterexample: boolean;
  patternId: string | null;
  source: "structured" | "lexicon";
}

export interface ThemeCue {
  quoteId: string;
  sourceUtteranceId: string;
  quote: string;
  theme: "novelty";
  timeScope: TimeScope;
  patternId: string;
  scoredAsBigFive: false;
}

interface Pattern {
  id: string;
  dimension: Dimension | null;
  theme: "novelty" | null;
  pole: Pole | null;
  phrase: string;
}

interface PatternFile {
  ruleVersion: string;
  matching: string;
  negationWindow: number;
  negationMarkers: string[];
  complexNegations: string[];
  contrastMarkers: string[];
  timeScopeMarkers: { acute: string[]; recent: string[]; longTerm: string[] };
  patterns: Pattern[];
}

let cached: PatternFile | null = null;

export function loadPatterns(): PatternFile {
  if (!cached) {
    cached = JSON.parse(readFileSync(dataPath("psychology-patterns.json"), "utf8")) as PatternFile;
  }
  return cached;
}

export interface RawMatch {
  cues: Cue[];
  themes: ThemeCue[];
  unmatched: { quoteId: string; text: string }[];
  ignored: { quoteId: string; text: string; reason: string }[];
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitClauses(text: string, markers: string[]): { text: string; counterexample: boolean }[] {
  const re = new RegExp(markers.map(escapeReg).join("|"), "g");
  const parts: { text: string; counterexample: boolean }[] = [];
  let last = 0;
  let counter = false;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    const chunk = text.slice(last, idx).trim();
    if (chunk) parts.push({ text: chunk, counterexample: counter });
    counter = true;
    last = idx + match[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) parts.push({ text: tail, counterexample: counter });
  if (parts.length === 0 && text.trim()) parts.push({ text: text.trim(), counterexample: false });
  return parts;
}

function scopeOf(text: string, markers: PatternFile["timeScopeMarkers"]): { scope: TimeScope; conflict: boolean } {
  const acute = markers.acute.some((item) => text.includes(item));
  const recent = markers.recent.some((item) => text.includes(item));
  const longTerm = markers.longTerm.some((item) => text.includes(item));
  const hits = [acute, recent, longTerm].filter(Boolean).length;
  if (acute) return { scope: "acute", conflict: hits > 1 };
  if (recent) return { scope: "recent", conflict: hits > 1 };
  if (longTerm) return { scope: "long-term", conflict: hits > 1 };
  return { scope: "unclear", conflict: false };
}

function prefixNegation(
  prefix: string,
  markers: string[],
  complex: string[],
): "flip" | "none" | "complex" {
  if (complex.some((item) => prefix.includes(item))) return "complex";
  let rest = prefix.replace(/^[我你他她它咱们大家其实也]+/u, "");
  if (complex.some((item) => rest.includes(item))) return "complex";
  const ordered = [...markers].sort((a, b) => b.length - a.length);
  for (const marker of ordered) {
    if (rest.endsWith(marker)) return "flip";
  }
  return "none";
}

function phraseHasNegation(phrase: string): boolean {
  return phrase.includes("不") || phrase.includes("没");
}

export function matchUtterances(
  utterances: { id: string; text: string }[],
): Result<RawMatch> {
  const file = loadPatterns();
  const patterns = [...file.patterns].sort((a, b) => b.phrase.length - a.phrase.length);
  const cues: Cue[] = [];
  const themes: ThemeCue[] = [];
  const unmatched: { quoteId: string; text: string }[] = [];
  const ignored: { quoteId: string; text: string; reason: string }[] = [];

  for (const utterance of utterances) {
    const text = utterance.text.normalize("NFKC").trim();
    if (!text) continue;
    const clauses = splitClauses(text, file.contrastMarkers);
    let produced = false;
    clauses.forEach((clause, clauseIndex) => {
      const quoteId = clauses.length === 1 ? utterance.id : `${utterance.id}-${clauseIndex + 1}`;
      if (file.complexNegations.some((item) => clause.text.includes(item))) {
        ignored.push({ quoteId, text: clause.text, reason: "complex-negation" });
        produced = true;
        return;
      }
      const spans: { start: number; end: number; pattern: Pattern }[] = [];
      for (const pattern of patterns) {
        let from = 0;
        while (from < clause.text.length) {
          const at = clause.text.indexOf(pattern.phrase, from);
          if (at < 0) break;
          const end = at + pattern.phrase.length;
          const overlaps = spans.some((span) => at < span.end && end > span.start);
          if (!overlaps) spans.push({ start: at, end, pattern });
          from = at + pattern.phrase.length;
        }
      }
      if (spans.length === 0) return;
      produced = true;
      const { scope, conflict } = scopeOf(clause.text, file.timeScopeMarkers);
      for (const span of spans) {
        const prefix = clause.text.slice(Math.max(0, span.start - file.negationWindow), span.start);
        const negation = prefixNegation(prefix, file.negationMarkers, file.complexNegations);
        if (negation === "complex" || (negation === "flip" && phraseHasNegation(span.pattern.phrase))) {
          ignored.push({ quoteId, text: clause.text, reason: "complex-negation" });
          continue;
        }
        if (span.pattern.theme === "novelty" || span.pattern.dimension === null) {
          themes.push({
            quoteId,
            sourceUtteranceId: utterance.id,
            quote: clause.text,
            theme: "novelty",
            timeScope: scope,
            patternId: span.pattern.id,
            scoredAsBigFive: false,
          });
          continue;
        }
        const pole =
          negation === "flip"
            ? span.pattern.pole === "high"
              ? "low"
              : "high"
            : span.pattern.pole;
        if (!pole) {
          ignored.push({ quoteId, text: clause.text, reason: "pattern-without-pole" });
          continue;
        }
        cues.push({
          quoteId,
          sourceUtteranceId: utterance.id,
          quote: clause.text,
          dimension: span.pattern.dimension,
          pole,
          timeScope: scope,
          timeScopeConflict: conflict,
          counterexample: clause.counterexample,
          patternId: span.pattern.id,
          source: "lexicon",
        });
      }
    });
    if (!produced) unmatched.push({ quoteId: utterance.id, text });
  }
  return ok({ cues, themes, unmatched, ignored });
}

export function parseRawUtterances(raw: unknown): Result<{ id: string; text: string }[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("INVALID_INPUT", "原始对话必须是 JSON 对象。");
  }
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.utterances)) {
    const utterances: { id: string; text: string }[] = [];
    for (let i = 0; i < obj.utterances.length; i += 1) {
      const item = obj.utterances[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return fail("INVALID_UTTERANCE", "utterances 的每一项必须是对象。");
      }
      const row = item as Record<string, unknown>;
      if (typeof row.text !== "string" || row.text.trim() === "") {
        return fail("INVALID_UTTERANCE", "utterance.text 必须是非空字符串。");
      }
      if ("pole" in row || "dimension" in row) {
        return fail(
          "RAW_DOES_NOT_ACCEPT_POLE",
          "原始语句模式不接受调用者写入的 dimension 或 pole。词表没有覆盖的句子保持未匹配。",
        );
      }
      const id = typeof row.id === "string" && row.id.trim() ? row.id : `u${i + 1}`;
      utterances.push({ id, text: row.text });
    }
    return ok(utterances);
  }
  if (typeof obj.rawText === "string") {
    const lines = obj.rawText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return ok(lines.map((text, index) => ({ id: `u${index + 1}`, text })));
  }
  return fail("INVALID_INPUT", "原始对话需要 utterances 或 rawText。没有匹配到词表的句子不会被解释。");
}
