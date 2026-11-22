import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";
import { fail, ok, type Result } from "./result.js";
import { DIMENSIONS, type Dimension } from "./psychology-match.js";

export const MINI_IPIP_SCALE = "mini-ipip-en-1-5-v1";

type Answer = 1 | 2 | 3 | 4 | 5;
interface Item {
  id: string;
  administrationIndex: number;
  text: string;
  dimension: Dimension;
  key: "+" | "-";
}
interface ItemFile {
  instrument: "Mini-IPIP";
  source: { itemWordingAndKey: string };
  directions: { text: string; responseAnchors: { value: Answer; label: string }[] };
  items: Item[];
}

export function miniIPIPQuestionnaire() {
  const data = JSON.parse(readFileSync(dataPath("ipip-items.json"), "utf8")) as ItemFile;
  return {
    instrument: data.instrument,
    scaleVersion: MINI_IPIP_SCALE,
    source: data.source.itemWordingAndKey,
    directions: data.directions.text,
    anchors: data.directions.responseAnchors,
    items: data.items.map(({ id, administrationIndex, text }) => ({ id, administrationIndex, text })),
  };
}

interface ScoredItem {
  id: string;
  status: "unknown" | "user_confirmed";
  userResponse: Answer | null;
  keyedValue: Answer | null;
}
interface ConfirmedScoring {
  method: "explicit-scale-selection";
  scaleVersion: typeof MINI_IPIP_SCALE;
  answered: number;
  total: 20;
  dimensionRawSums: Record<Dimension, number | null>;
  items: ScoredItem[];
  note: string;
}

export function scoreConfirmedItems(raw: unknown): Result<ConfirmedScoring> {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return fail("INVALID_SCALE_INPUT", "请提供明确作答的题目编号与量尺档位。");
  }
  const input = (raw as Record<string, unknown>).responses ?? [];
  if (!Array.isArray(input) || input.length > 20) {
    return fail("INVALID_SCALE_INPUT", "responses 必须是至多 20 项的数组。");
  }
  const data = JSON.parse(readFileSync(dataPath("ipip-items.json"), "utf8")) as ItemFile;
  const catalog = new Map(data.items.map((x) => [x.id, x]));
  const selections = new Map<string, Answer>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail("INVALID_SCALE_RESPONSE", "量尺答案需要结构化输入。");
    const r = entry as Record<string, unknown>;
    if (
      typeof r.itemId !== "string" || !catalog.has(r.itemId) ||
      r.source !== "user-scale-selection" || r.scaleVersion !== MINI_IPIP_SCALE ||
      typeof r.value !== "number" || !Number.isInteger(r.value) || r.value < 1 || r.value > 5
    ) return fail("INVALID_SCALE_RESPONSE", "只接受用户看过原题和完整选项后亲自选择的 1–5 档；确认画像不等于作答。");
    if (selections.has(r.itemId)) return fail("DUPLICATE_SCALE_RESPONSE", "同一题不得同时有两个答案。");
    selections.set(r.itemId, r.value as Answer);
  }
  const items = data.items.map(({ id, key }): ScoredItem => {
    const value = selections.get(id) ?? null;
    return { id, status: value === null ? "unknown" : "user_confirmed", userResponse: value,
      keyedValue: value === null ? null : key === "+" ? value : (6 - value) as Answer };
  });
  const dimensionRawSums = Object.fromEntries(DIMENSIONS.map((d) => [d, null])) as Record<Dimension, number | null>;
  if (items.length === 20 && selections.size === 20) {
    for (const d of DIMENSIONS) dimensionRawSums[d] = 0;
    data.items.forEach((item, i) => { dimensionRawSums[item.dimension]! += items[i]!.keyedValue!; });
  }
  return ok({ method: "explicit-scale-selection", scaleVersion: MINI_IPIP_SCALE, answered: selections.size,
    total: 20, dimensionRawSums, items,
    note: "仅记录原始量尺档位；全答后才展示原始维度和。不是常模、诊断、人格概率或 MBTI。N 为情绪波动维度，I 为智性／想象，不是广义开放性。" });
}
