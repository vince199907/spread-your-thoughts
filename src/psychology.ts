import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";
import { fail, ok, type Result } from "./result.js";
import {
  DIMENSIONS,
  type Cue,
  type Dimension,
  type Pole,
  type TimeScope,
  type ThemeCue,
  loadPatterns,
  matchUtterances,
  parseRawUtterances,
} from "./psychology-match.js";

const DISCARD_KEYS = [
  "birth",
  "bazi",
  "dayMaster",
  "elements",
  "tenGods",
  "gender",
  "pillars",
  "fiveElements",
  "calendar",
  "hour",
];

const SCOPES: TimeScope[] = ["long-term", "recent", "unclear", "acute"];

interface ItemFile {
  instrument: string;
  itemCount: number;
  items: { id: string }[];
  signNotes: Record<string, string>;
}

interface PoolFile {
  compulsory: boolean;
  maxOptionalPrompts: number;
  optionalConversationStarters: { id: string; text: string }[];
}

function loadItems(): ItemFile {
  return JSON.parse(readFileSync(dataPath("ipip-items.json"), "utf8")) as ItemFile;
}

function loadPool(): PoolFile {
  return JSON.parse(readFileSync(dataPath("question-pool.json"), "utf8")) as PoolFile;
}

function bucket(cues: Cue[], dimension: Dimension, scope: TimeScope): "unknown" | Pole | "contradictory" {
  const poles = new Set(
    cues.filter((cue) => cue.dimension === dimension && cue.timeScope === scope).map((cue) => cue.pole),
  );
  if (poles.size === 0) return "unknown";
  if (poles.size > 1) return "contradictory";
  return [...poles][0];
}

function dimensionReport(cues: Cue[], dimension: Dimension) {
  const own = cues
    .filter((cue) => cue.dimension === dimension)
    .map((cue) => ({
      quoteId: cue.quoteId,
      quote: cue.quote,
      pole: cue.pole,
      timeScope: cue.timeScope,
      timeScopeConflict: cue.timeScopeConflict,
      counterexample: cue.counterexample,
      patternId: cue.patternId,
      source: cue.source,
    }))
    .sort((a, b) => a.quoteId.localeCompare(b.quoteId));
  const longTerm = bucket(cues, dimension, "long-term");
  const recent = bucket(cues, dimension, "recent");
  const unclear = bucket(cues, dimension, "unclear");
  const acute = bucket(cues, dimension, "acute");
  const stable =
    longTerm === "high" || longTerm === "low"
      ? "exploratory-long-term"
      : longTerm === "contradictory"
        ? "contradictory"
        : "unknown";
  return {
    stable,
    exploratoryLabel: longTerm === "high" || longTerm === "low" ? `long-term-${longTerm}` : null,
    longTerm,
    recent,
    unclear,
    acute,
    cues: own,
    validatedMeasurement: false,
  };
}

function parseStructuredCues(evidence: unknown): Result<Cue[]> {
  if (!Array.isArray(evidence)) return fail("INVALID_EVIDENCE", "evidence 必须是数组。");
  const cues: Cue[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return fail("INVALID_EVIDENCE", "evidence 的每一项必须是对象。");
    }
    const row = item as Record<string, unknown>;
    if ("score" in row || "ipipItem" in row) {
      return fail("SCORE_FIELD_REFUSED", "证据条目不能带分数或题目作答。");
    }
    if (typeof row.quoteId !== "string" || row.quoteId.trim() === "") {
      return fail("INVALID_EVIDENCE", "每条证据需要非空 quoteId。");
    }
    if (seen.has(row.quoteId)) return fail("INVALID_EVIDENCE", `quoteId 重复：${row.quoteId}`);
    seen.add(row.quoteId);
    if (typeof row.quote !== "string" || row.quote.trim() === "") {
      return fail("INVALID_EVIDENCE", "quote 必须是非空原文。");
    }
    if (row.dimension === "openness" || row.dimension === "emotional-stability") {
      return fail(
        "BROAD_OPENNESS_NOT_MEASURED",
        "不接受 openness 或 emotional-stability 作为维度。Mini-IPIP 这里对应的是 intellect 与 neuroticism，而且本模块不计分。",
      );
    }
    if (!DIMENSIONS.includes(row.dimension as Dimension)) {
      return fail("INVALID_EVIDENCE", "dimension 只能是五个 Mini-IPIP 因子名：extraversion、agreeableness、conscientiousness、neuroticism、intellect。");
    }
    if (row.pole !== "high" && row.pole !== "low") {
      return fail("INVALID_EVIDENCE", "结构化证据的 pole 必须是调用者已经判定的 high 或 low，程序不会再从句子里改写它。");
    }
    if (!SCOPES.includes(row.timeScope as TimeScope)) {
      return fail("INVALID_EVIDENCE", "timeScope 只能是 long-term、recent、unclear 或 acute。");
    }
    cues.push({
      quoteId: row.quoteId,
      sourceUtteranceId: row.quoteId,
      quote: row.quote,
      dimension: row.dimension as Dimension,
      pole: row.pole,
      timeScope: row.timeScope as TimeScope,
      timeScopeConflict: false,
      counterexample: row.counterexample === true,
      patternId: null,
      source: "structured",
    });
  }
  return ok(cues);
}

function mbtiOf(raw: unknown): Result<{ value: string | null; source: string; notAssessed: boolean; derivedFromIpip: false; derivedFromBirth: false }> {
  if (raw === undefined || raw === null || raw === "") {
    return ok({ value: null, source: "none", notAssessed: true, derivedFromIpip: false, derivedFromBirth: false });
  }
  if (typeof raw !== "string" || !/^[IE][NS][TF][JP]$/i.test(raw)) {
    return fail("INVALID_MBTI", "MBTI 只接受用户自己写下的四字母。不合法就不替换，也不从别的资料推测。");
  }
  return ok({
    value: raw.toUpperCase(),
    source: "self-report",
    notAssessed: true,
    derivedFromIpip: false,
    derivedFromBirth: false,
  });
}

function discardedNames(raw: Record<string, unknown>): string[] {
  return DISCARD_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(raw, key)).sort();
}

function profileFrom(cues: Cue[], themes: ThemeCue[], unmatched: { quoteId: string; text: string }[], ignored: { quoteId: string; text: string; reason: string }[], mbti: { value: string | null; source: string; notAssessed: boolean; derivedFromIpip: false; derivedFromBirth: false }, discarded: string[], inputMode: "structured" | "lexicon") {
  const items = loadItems();
  const pool = loadPool();
  const patterns = loadPatterns();
  const dimensions = {
    extraversion: dimensionReport(cues, "extraversion"),
    agreeableness: dimensionReport(cues, "agreeableness"),
    conscientiousness: dimensionReport(cues, "conscientiousness"),
    neuroticism: {
      ...dimensionReport(cues, "neuroticism"),
      factorName: "Neuroticism",
      emotionalStability: "opposite-pole-not-scored",
      emotionalStabilityScore: null,
    },
    intellect: {
      ...dimensionReport(cues, "intellect"),
      factorName: "Intellect/Imagination",
      broadOpenness: "not-this-factor",
    },
  };
  return {
    method: "rule-based-exploratory-summary",
    ruleVersion: patterns.ruleVersion,
    notValidatedMeasurement: true,
    notGeneralLanguageIntelligence: true,
    noAccuracyProbability: true,
    accuracyProbability: null,
    inputMode,
    questionnaire: {
      instrument: items.instrument,
      itemCountInBank: items.itemCount,
      administered: false,
      answeredCount: 0,
      answeredItemIds: [] as string[],
      responses: null,
      scored: false,
      reason: "不施测 Mini-IPIP，不补造 20 题答案，也不把陈述换算成量表分。",
    },
    sign: items.signNotes,
    dimensions,
    broadOpenness: "not-measured",
    emotionalStabilityScore: null,
    themes: {
      novelty: {
        scoredAsBigFive: false,
        cues: themes,
        note: "新鲜事物只作为谈话里出现过的行为例子，不计入 Intellect，也不当作开放性分数。",
      },
    },
    unmatched,
    ignored,
    mbti,
    discardedFieldNames: discarded,
    conversationStarterPolicy: {
      compulsoryQuestionnaire: pool.compulsory,
      maxOptionalPrompts: pool.maxOptionalPrompts,
      promptIds: pool.optionalConversationStarters.map((item) => item.id),
      promptsAsked: [] as string[],
    },
  };
}

export function summarizePsychology(raw: unknown): Result<Record<string, unknown>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("INVALID_INPUT", "心理输入必须是 JSON 对象。");
  }
  const obj = raw as Record<string, unknown>;
  if ("ipipResponses" in obj || "answers" in obj || "questionnaire" in obj) {
    return fail("QUESTIONNAIRE_SCORE_REFUSED", "不接受 Mini-IPIP 作答，也不把作答换算成总分或 MBTI。");
  }
  const mbti = mbtiOf(obj.selfReportedMbti);
  if (!mbti.ok) return mbti;
  const discarded = discardedNames(obj);
  const hasEvidence = "evidence" in obj;
  const hasRaw = "utterances" in obj || "rawText" in obj;
  if (hasEvidence && hasRaw) {
    return fail("AMBIGUOUS_INPUT", "同一次输入不要同时给 evidence 和原始语句。");
  }
  if (!hasEvidence && !hasRaw) {
    const empty = profileFrom([], [], [], [], mbti.result, discarded, "structured");
    return ok(empty);
  }
  if (hasEvidence) {
    const cues = parseStructuredCues(obj.evidence);
    if (!cues.ok) return cues;
    return ok(profileFrom(cues.result, [], [], [], mbti.result, discarded, "structured"));
  }
  const utterances = parseRawUtterances(obj);
  if (!utterances.ok) return utterances;
  const matched = matchUtterances(utterances.result);
  if (!matched.ok) return matched;
  return ok(
    profileFrom(
      matched.result.cues,
      matched.result.themes,
      matched.result.unmatched,
      matched.result.ignored,
      mbti.result,
      discarded,
      "lexicon",
    ),
  );
}

export function listOptionalPrompts(): Result<Record<string, unknown>> {
  const pool = loadPool();
  return ok({
    compulsory: pool.compulsory,
    maxOptionalPrompts: pool.maxOptionalPrompts,
    prompts: pool.optionalConversationStarters,
    note: "这两句只是可选的谈话起头，不是人格测评，也不对应 20 道 Mini-IPIP。",
  });
}
