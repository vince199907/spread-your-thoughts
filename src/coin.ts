import { fail, ok, type Result } from "./result.js";
import { findHexagramByLines, type Hexagram } from "./hexagrams.js";

const LINE_NAMES = ["初爻", "二爻", "三爻", "四爻", "五爻", "上爻"] as const;

export interface CoinLine {
  position: number;
  name: (typeof LINE_NAMES)[number];
  value: 6 | 7 | 8 | 9;
  yinYang: "yin" | "yang";
  changing: boolean;
  coins: number[] | null;
}

function lineFromValue(value: number, position: number, coins: number[] | null): CoinLine | null {
  if (value !== 6 && value !== 7 && value !== 8 && value !== 9) return null;
  const changing = value === 6 || value === 9;
  const yinYang = value === 7 || value === 9 ? "yang" : "yin";
  return {
    position,
    name: LINE_NAMES[position - 1],
    value,
    yinYang,
    changing,
    coins,
  };
}

export function sumCoins(coins: number[]): 6 | 7 | 8 | 9 | null {
  if (coins.length !== 3 || coins.some((coin) => coin !== 2 && coin !== 3)) return null;
  const sum = coins[0] + coins[1] + coins[2];
  if (sum === 6 || sum === 7 || sum === 8 || sum === 9) return sum;
  return null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function primaryBit(line: CoinLine): number {
  return line.yinYang === "yang" ? 1 : 0;
}

function changedBit(line: CoinLine): number {
  if (!line.changing) return primaryBit(line);
  return line.yinYang === "yang" ? 0 : 1;
}

function pack(lines: CoinLine[], seed: number | null): Result<Record<string, unknown>> {
  const primaryLines = lines.map(primaryBit);
  const primary = findHexagramByLines(primaryLines);
  if (!primary) return fail("HEXAGRAM_NOT_FOUND", "爻象没有对应卦。不编造卦名。");
  const changing = lines.filter((line) => line.changing);
  let changed: Hexagram | null = null;
  if (changing.length > 0) {
    changed = findHexagramByLines(lines.map(changedBit));
    if (!changed) return fail("HEXAGRAM_NOT_FOUND", "变卦爻象没有对应卦。不编造卦名。");
  }
  return ok({
    method: "three-coin",
    notIchingshifa: true,
    notYarrow: true,
    distribution: "coin",
    probabilityNote:
      "公平三钱：6 与 9 各 1/8，7 与 8 各 3/8。这不是大衍蓍草的概率，也不是 ichingshifa。",
    coinFaceValues: { yin: 2, yang: 3 },
    lineValueMeaning: {
      6: "老阴，变",
      7: "少阳，不变",
      8: "少阴，不变",
      9: "老阳，变",
    },
    lineOrder: "bottom-up",
    seed,
    lines,
    primary: summarize(primary),
    changed: changed ? summarize(changed) : null,
    changingPositions: changing.map((line) => line.position),
  });
}

function summarize(hex: Hexagram) {
  return {
    id: hex.id,
    kingWen: hex.kingWen,
    name: hex.name,
    linesBottomUp: hex.linesBottomUp,
  };
}

export function castFromLines(values: number[]): Result<Record<string, unknown>> {
  if (values.length !== 6) return fail("INVALID_LINES", "需要恰好 6 个爻值，由下而上。");
  const lines: CoinLine[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const line = lineFromValue(values[i], i + 1, null);
    if (!line) return fail("INVALID_LINES", "爻值只能是 6、7、8 或 9。");
    lines.push(line);
  }
  return pack(lines, null);
}

export function castFromCoins(coins: number[]): Result<Record<string, unknown>> {
  if (coins.length !== 18) return fail("INVALID_COINS", "需要 18 个钱面：六爻由下而上，每爻三枚。");
  const lines: CoinLine[] = [];
  for (let i = 0; i < 6; i += 1) {
    const group = coins.slice(i * 3, i * 3 + 3);
    const sum = sumCoins(group);
    if (sum === null) return fail("INVALID_COINS", "钱面只能是 2（阴）或 3（阳）。");
    const line = lineFromValue(sum, i + 1, group);
    if (!line) return fail("INVALID_COINS", "钱面合计没有落在 6–9。");
    lines.push(line);
  }
  return pack(lines, null);
}

export function castFromSeed(seed: number): Result<Record<string, unknown>> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return fail("INVALID_SEED", "seed 必须是 0 到 4294967295 的整数。没有种子就不会自行随机。");
  }
  const rng = mulberry32(seed);
  const coins: number[] = [];
  for (let i = 0; i < 18; i += 1) coins.push(rng() < 0.5 ? 2 : 3);
  const cast = castFromCoins(coins);
  if (!cast.ok) return cast;
  return ok({ ...cast.result, seed, generator: "mulberry32" });
}
