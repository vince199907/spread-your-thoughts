import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";
import { fail, ok, type Result } from "./result.js";

export interface TarotCard {
  id: string;
  number: number;
  nameEn: string;
  nameZh: string;
}

interface TarotFile {
  numbering: string;
  note: string;
  cards: TarotCard[];
}

let cached: TarotFile | null = null;

export function loadTarot(): TarotFile {
  if (!cached) cached = JSON.parse(readFileSync(dataPath("tarot-majors.json"), "utf8")) as TarotFile;
  return cached;
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

export function drawTarot(seed: number): Result<Record<string, unknown>> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return fail("INVALID_SEED", "seed 必须是 0 到 4294967295 的整数。抽牌不使用未经记录的随机源。");
  }
  const file = loadTarot();
  const rng = mulberry32(seed);
  const index = Math.floor(rng() * file.cards.length);
  const card = file.cards[index];
  return ok({
    method: "seeded-major-arcana-draw",
    seed,
    generator: "mulberry32",
    numbering: file.numbering,
    card,
    interpretation: null,
    note: "抽牌只返回牌的编号和名称。解释必须另走 advice，并且默认只是符号模板。",
  });
}

export interface TarotDeckCard extends TarotCard {
  arcana: "major" | "minor";
  suit?: string;
  rank?: string;
  symbolicPrompt: string;
}
export type TarotOrientation = "upright" | "reversed";
export interface TarotPlacedCard extends TarotDeckCard {
  position: string;
  orientation: TarotOrientation;
}
interface MinorEntry { id: string; nameEn: string; nameZh: string }
interface MinorFile { suits: MinorEntry[]; ranks: MinorEntry[] }
interface ReflectionFile {
  major: string[];
  suitLens: Record<string, string>;
  rank: Record<string, string>;
}

const DECK_VERSION = "rws-names-v1";
let deckCache: ReadonlyArray<TarotDeckCard> | undefined;
export function loadTarotDeck(): ReadonlyArray<TarotDeckCard> {
  if (!deckCache) {
    const { suits, ranks } = JSON.parse(
      readFileSync(dataPath("tarot-minors.json"), "utf8"),
    ) as MinorFile;
    const reflections = JSON.parse(
      readFileSync(dataPath("tarot-reflection-prompts.json"), "utf8"),
    ) as ReflectionFile;
    const majors = loadTarot().cards.map(card => Object.freeze({
      ...card, arcana: "major" as const, symbolicPrompt: reflections.major[card.number],
    }));
    const minors = suits.flatMap(suit => ranks.map((rank, i) => Object.freeze({
      id: `tarot-${suit.id}-${rank.id}`,
      number: i + 1,
      nameEn: `${rank.nameEn} of ${suit.nameEn}`,
      nameZh: suit.nameZh + rank.nameZh,
      arcana: "minor" as const,
      suit: suit.id,
      rank: rank.id,
      symbolicPrompt: `以${reflections.suitLens[suit.id]}为角度，${reflections.rank[rank.id]}`,
    })));
    deckCache = Object.freeze([...majors, ...minors]);
  }
  return deckCache;
}

const POSITIONS = {
  single: ["眼前值得留意的角度"],
  three: ["眼前处境", "可再看一眼的角度", "可以尝试的小步"],
} as const;
export type TarotSpread = keyof typeof POSITIONS;
export interface TarotReadingOptions {
  spread: TarotSpread;
  seed?: number;
  cards?: Array<{ id: string; orientation?: TarotOrientation }>;
  reversals?: boolean;
}

export function readTarot(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("INVALID_TAROT", "塔罗输入必须是对象。");
  }
  const { spread, seed, cards, reversals = false } = input as TarotReadingOptions;
  if (spread !== "single" && spread !== "three") {
    return fail("INVALID_SPREAD", "牌阵只能是 single 或 three。");
  }
  if (typeof reversals !== "boolean") return fail("INVALID_TAROT", "reversals 必须是布尔值。");
  const positions = POSITIONS[spread];
  const deck = loadTarotDeck();
  const placements: TarotPlacedCard[] = [];
  const initialPool = [...deck];
  if (cards !== undefined) {
    if (seed !== undefined || !Array.isArray(cards) || cards.length !== positions.length) {
      return fail("INVALID_TAROT", "手动输入需匹配牌阵张数，且不同时提供种子。");
    }
    const seen = new Set<string>();
    for (let i = 0; i < cards.length; i += 1) {
      const selected = cards[i];
      if (typeof selected !== "object" || selected === null || Array.isArray(selected)) {
        return fail("INVALID_TAROT", "每张手动牌应为带 id 的对象。");
      }
      const { id, orientation = "upright" } = selected;
      if (typeof id !== "string" || (orientation !== "upright" && orientation !== "reversed")) {
        return fail("INVALID_TAROT", "牌号或正逆位无效。");
      }
      if (orientation === "reversed" && !reversals) {
        return fail("INVALID_TAROT", "本次未启用逆位。");
      }
      const card = deck.find(c => c.id === id);
      if (!card) return fail("UNKNOWN_CARD", "这张牌不在已核 78 牌名册里。");
      if (seen.has(id)) return fail("DUPLICATE_CARD", "同一牌阵不能重复录入同一张牌。");
      seen.add(id);
      placements.push({ ...card, orientation, position: positions[i] });
    }
  } else {
    if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      return fail("INVALID_SEED", "模拟抽牌需要 0 到 4294967295 的记录种子；不得从出生资料生成。");
    }
    const random = mulberry32(seed);
    // Each chosen card is removed. A separate recorded algorithm version preserves replay.
    for (const position of positions) {
      const [card] = initialPool.splice(Math.floor(random() * initialPool.length), 1);
      const orientation = reversals && random() < 0.5 ? "reversed" : "upright";
      placements.push({ ...card, orientation, position });
    }
  }
  const method = cards === undefined ? "simulated" : "manual";
  return ok({
    method,
    spread,
    reversals,
    positions: [...positions],
    cards: placements,
    trace: {
      deckVersion: DECK_VERSION,
      promptVersion: "tarot-reflection-prompts-v1",
      algorithm: method === "simulated" ? "mulberry32-remove-v1" : "manual-order-v1",
      seed: seed ?? null,
      order: placements.map(({ id, orientation }) => ({ id, orientation })),
    },
    note: "牌面和反思提问仅供查阅；提问不是答案，不推断用户的状态，正逆位也不是事实判断。",
  });
}
