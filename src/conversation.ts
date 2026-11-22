import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";
import { fail, ok, type Result } from "./result.js";
import { hasCrisisSignal, parseObservations } from "./grounded-advice.js";

export interface ConversationQuestion {
  id: string;
  order: string;
  availability: string;
  text: string;
  usage: string;
}
export function listConversationQuestions(): readonly ConversationQuestion[] {
  return JSON.parse(readFileSync(dataPath("conversation-questions.json"), "utf8")) as ConversationQuestion[];
}

type QuestionReason =
  | "stopped" | "crisis" | "no-psychology" | "enough-evidence" | "needs-permission"
  | "budget" | "no-new-question" | "selected";
export interface QuestionStep {
  question: ConversationQuestion | null;
  reason: QuestionReason;
}

const TOPICS: Readonly<Record<string, string>> = {
  recovery: "P01", change: "P02", decision: "P03", conflict: "P04",
  commitment: "P05", order: "P06", worry: "P07", emotionRecovery: "P08",
  novelty: "P09", abstraction: "P10", example: "P11", timeframe: "P12",
  counterexample: "P13", selfReportedMbti: "P14",
};

export function nextConversationQuestion(raw: unknown): Result<QuestionStep> {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) return fail("INVALID_CONVERSATION", "需要本轮会话记录。");
  const input = raw as Record<string, unknown>;
  const stop = (reason: QuestionReason) => ok<QuestionStep>({ question: null, reason });
  const catalog = listConversationQuestions();
  const byId = new Map(catalog.map((q) => [q.id, q]));
  if (input.intent !== undefined && !["chat", "symbolic-only", "calculation-only", "stop", "skip"].includes(input.intent as string)) return fail("INVALID_CONVERSATION", "会话意图不受支持。");
  for (const flag of ["wantsFollowUp", "wantsContinue", "goalClear", "enoughEvidence"]) {
    if (input[flag] !== undefined && typeof input[flag] !== "boolean") return fail("INVALID_CONVERSATION", "会话开关必须是明确的是或否。");
  }
  if (input.intent === "stop" || input.intent === "skip") return stop("stopped");
  if (input.intent === "symbolic-only" || input.intent === "calculation-only") return stop("no-psychology");
  const parsed = parseObservations(input.observations);
  if (!parsed.ok) return parsed;
  if (parsed.result.some((r) => hasCrisisSignal(r.quote))) return stop("crisis");
  if (input.goalClear === true && input.enoughEvidence === true) return stop("enough-evidence");
  if (input.wantsFollowUp !== true) return stop("needs-permission");

  const submitted = input.askedIds ?? [];
  if (!Array.isArray(submitted) || submitted.length > 34 || submitted.some((id) => typeof id !== "string" || !byId.has(id))) {
    return fail("INVALID_CONVERSATION", "askedIds 只能记录题库中实际问过的编号。");
  }
  const ledger = new Set(submitted as string[]);
  const softCount = [...ledger].filter((id) => id.startsWith("P")).length;
  if (softCount >= (input.wantsContinue === true ? 4 : 2)) return stop("budget");
  const target = typeof input.topic === "string" && Object.hasOwn(TOPICS, input.topic) ? TOPICS[input.topic] : undefined;
  const candidates = !parsed.result.length ? ["Q01", "Q02"] : input.goalClear !== true ? ["Q02", ...(target ? [target] : [])] : target ? [target] : [];
  const chosen = candidates.find((id) => !ledger.has(id));
  if (!chosen) return stop("no-new-question");
  return ok({ question: byId.get(chosen)!, reason: "selected" });
}
