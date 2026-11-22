import { fail, ok, type Result } from "./result.js";

const PERIODS = ["recent", "long_term", "unclear"] as const;
type Period = typeof PERIODS[number];
export interface Observation {
  id: string;
  quote: string;
  period: Period;
  behaviorExample?: string;
  counterEvidence?: string[];
}
export interface GroundedAdvice {
  mode: "grounded" | "insufficient-evidence" | "safety-support";
  three_sentences: { state: string; risk: string; action: string };
  evidence_ids: string[];
}

const commandLike = /(?:忽略|无视|覆盖|绕过|不遵守).{0,12}(?:指令|规则|提示词)|(?:系统提示词|system prompt)|(?:ignore|override|disregard).{0,40}(?:instruction|prompt|rules)|(?:<\/?(?:system|assistant|developer)>)/iu;
const imminent = /不想活(?:了|下去)?|活不下去|(?:我|想|要|准备|打算|计划|正在|已经).{0,10}(?:自杀|自残|自伤|结束(?:我|自己)?(?:的)?生命|伤害自己|割腕|跳楼|吞药)|(?:想|要|准备|计划).{0,5}(?:杀人|杀了他|杀了她)|(?:想死(?!你|了?这道)|去死|生无可恋)(?![机的])|suicid(?:e|al)|(?:kill|harm|hurt)\s+(?:myself|yourself)|end\s+my\s+life|want\s+to\s+die/iu;
export function hasCrisisSignal(text: string): boolean {
  return imminent.test(text.normalize("NFKC"));
}

export function parseObservations(input: unknown): Result<Observation[]> {
  if (input === undefined || input === null) return ok([]);
  if (!Array.isArray(input) || input.length > 32) return fail("INVALID_OBSERVATIONS", "observations 需要是至多 32 条用户原话。");
  const all: Observation[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("INVALID_OBSERVATION", "每条观察须包含原话、编号和时间范围。");
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[\p{L}\p{N}_:.\-]{1,64}$/u.test(r.id) || seen.has(r.id)
      || typeof r.quote !== "string" || !r.quote.trim() || [...r.quote].length > 1200
      || !PERIODS.includes(r.period as Period)) return fail("INVALID_OBSERVATION", "请提供不重复的原话编号、非空现有原话和有效时间范围。");
    if (r.behaviorExample !== undefined && (typeof r.behaviorExample !== "string" || !r.behaviorExample.trim() || !r.quote.includes(r.behaviorExample))) {
      return fail("UNSUPPORTED_BEHAVIOR", "行为片段须来自同一条原话，不另补事实。");
    }
    if (r.counterEvidence !== undefined && (!Array.isArray(r.counterEvidence) || r.counterEvidence.some((x) => typeof x !== "string"))) {
      return fail("INVALID_COUNTER_EVIDENCE", "反例请使用已有的原话编号。");
    }
    seen.add(r.id);
    all.push({ id: r.id, quote: r.quote.trim(), period: r.period as Period,
      ...(typeof r.behaviorExample === "string" ? { behaviorExample: r.behaviorExample.trim() } : {}),
      ...(Array.isArray(r.counterEvidence) ? { counterEvidence: [...new Set(r.counterEvidence as string[])] } : {}) });
  }
  if (all.some((r) => r.counterEvidence?.some((id) => id === r.id || !seen.has(id)))) {
    return fail("UNSUPPORTED_COUNTER_EVIDENCE", "反例编号必须指向另一条已有原话。");
  }
  return ok(all);
}

function quoteFragment(raw: string): string {
  const visible = raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[。！？!?；;]+\s*$/u, "").replace(/[。！？!?；;]/gu, "，").trim();
  const chars = [...visible];
  return chars.length > 56 ? chars.slice(0, 55).join("") + "…" : visible;
}

export function composeGroundedAdvice(raw: unknown): Result<GroundedAdvice> {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) return fail("INVALID_ADVICE_INPUT", "请提供用户的实际处境。");
  const input = raw as Record<string, unknown>;
  const parsed = parseObservations(input.observations);
  if (!parsed.ok) return parsed;
  if (input.goal !== undefined && (typeof input.goal !== "string" || [...input.goal].length > 500)) {
    return fail("INVALID_GOAL", "目标可留空，或提供用户实际说过的一句话。");
  }
  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  const danger = parsed.result.filter((r) => hasCrisisSignal(r.quote));
  if (danger.length > 0 || hasCrisisSignal(goal)) {
    return ok({ mode: "safety-support", evidence_ids: danger.map((x) => x.id), three_sentences: {
      state: "你提到可能伤害自己或他人，现在先暂停象征解读。",
      risk: "如果你已经受伤、服药，或觉得自己很可能马上行动，不要等这次聊天结束。",
      action: "若有紧迫危险，请立即联系当地急救或报警；否则现在就联系一个可信、能陪你的人，并明确说出你需要的帮助。",
    } });
  }
  const observations = parsed.result.filter((r) => !commandLike.test(r.quote) && quoteFragment(r.quote)).sort((a, b) => Number(b.period === "recent") - Number(a.period === "recent"));
  if (!observations.length) return ok({ mode: "insufficient-evidence", evidence_ids: [], three_sentences: {
    state: "我还不了解你眼前的具体处境。",
    risk: "信息还不够，暂不能判断哪种做法会带来什么代价。",
    action: "愿意的话，说一件最近让你犹豫的小事；不想聊也可以只看象征阅读。",
  }});
  const first = observations.find((r) => r.behaviorExample && r.period === "recent") ?? observations[0]!;
  const counter = observations.find((r) => first.counterEvidence?.includes(r.id));
  const fragment = quoteFragment(first.behaviorExample ?? first.quote);
  const state = (first.period === "recent" ? "你说最近「" : first.period === "long_term" ? "你描述自己平时「" : "你提到「")
    + fragment + (counter ? "」，也说过「" + quoteFragment(counter.quote) + "」，两种情况都先留着。" : "」。");
  const checking = !counter && first.period === "recent"
    && /(?:反复|不停|一直|[两二三四五六七八九十2-9]次).{0,10}(?:查|确认|看消息|刷消息)|(?:查|确认|看消息|刷消息).{0,14}[两二三四五六七八九十2-9]次/u.test(first.quote)
    && !/(?:没|没有|不|取消|停止).{0,9}(?:反复|确认|查|看消息|刷消息)/u.test(first.quote);
  const scheduleCost = checking && /晚上|昨晚|半夜|凌晨|睡|休息/u.test(first.quote);
  const timeTracking = checking
    ? (scheduleCost ? "如果这样的查看继续占用晚上的时间，可能挤掉休息。" : "如果类似的查看反复打断手头的事，可能增加重新集中注意力的时间。")
    : counter ? "两种经历不一样，暂不能用其中一次判断相同的代价会再出现。" : "仅凭这段描述，还不能确定它有没有带来可观察的代价。";
  const unsafeGoal = /(?:停|换|加|减|自行吃|自行服用).{0,4}(?:药|治疗)|(?:全仓|梭哈|借贷炒股)|(?:联系|找上门).{0,8}(?:报复|威胁)|(?:stop|skip|double)\s+(?:my\s+)?(?:medication|dose)|all[ -]in/i.test(goal);
  const action = unsafeGoal
    ? "先把你想调整的事和顾虑写下来，向了解具体情况的专业人士核对可选做法。"
    : checking
    ? "下一次想再确认时，先记下触发它的事，到你自己选的时间再看一次。"
    : goal && !commandLike.test(goal) && quoteFragment(goal)
      ? "围绕「" + quoteFragment(goal) + "」，先写出一个今天能试、明天能撤回的小动作。"
      : "下次遇到类似的情况时，先记下当时发生的事，再记自己实际做了什么。";
  return ok({ mode: "grounded", evidence_ids: [first.id, ...(counter ? [counter.id] : [])], three_sentences: { state, risk: timeTracking, action } });
}
