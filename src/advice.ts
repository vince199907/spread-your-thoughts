import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";
import { fail, ok, type Result } from "./result.js";

export interface AdvicePhrase {
  id: string;
  entryId: string;
  type: "hexagram" | "tarot";
  name: string;
  group: string;
  role: "state" | "risk" | "action";
  text: string;
  label: "editorial-suggestion";
  kingWen?: number;
  tarotNumber?: number;
}

interface AdviceFile {
  meta: Record<string, unknown>;
  phrases: AdvicePhrase[];
}

let cached: AdviceFile | null = null;

export function loadAdvicePhrases(): AdviceFile {
  if (!cached) cached = JSON.parse(readFileSync(dataPath("advice-phrases.json"), "utf8")) as AdviceFile;
  return cached;
}

export function codePointLength(text: string): number {
  return [...text].length;
}

export function advise(id: string, evidenceQuoteIds?: string[]): Result<Record<string, unknown>> {
  const file = loadAdvicePhrases();
  const phrases = file.phrases.filter((phrase) => phrase.entryId === id);
  if (phrases.length === 0) {
    return fail("UNKNOWN_ID", `没有编号为 ${id} 的卦或牌。不生成替代句子。`);
  }
  const byRole = Object.fromEntries(phrases.map((phrase) => [phrase.role, phrase]));
  for (const role of ["state", "risk", "action"] as const) {
    if (!byRole[role]) return fail("INCOMPLETE_MAPPING", `${id} 缺少 ${role} 句。不补写。`);
  }
  const grounded = evidenceQuoteIds !== undefined;
  if (grounded && evidenceQuoteIds.length === 0) {
    return fail("EVIDENCE_REQUIRED", "指定了证据模式，但没有任何引用编号。不把模板说成有证据。");
  }
  return ok({
    id,
    type: phrases[0].type,
    name: phrases[0].name,
    mode: grounded ? "evidence-grounded" : "symbolic-template",
    sentencesAreObservedUserState: false,
    observedUserState: null,
    label: "editorial-suggestion",
    linkedQuoteIds: grounded ? [...evidenceQuoteIds] : [],
    note: grounded
      ? "这三句仍是 data/advice-phrases.json 里的编辑模板，只是附上了引用编号。模板不是对用户现状的观察结论。"
      : "没有来访者当下陈述。这三句是符号模板和编辑建议，不是对该用户现状、风险或行动的事实判断。",
    sentences: {
      state: byRole.state.text,
      risk: byRole.risk.text,
      action: byRole.action.text,
    },
    phraseIds: {
      state: byRole.state.id,
      risk: byRole.risk.id,
      action: byRole.action.id,
    },
    source: "data/advice-phrases.json",
  });
}
