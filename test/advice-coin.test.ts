import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { advise, codePointLength, loadAdvicePhrases } from "../src/advice.js";
import { castFromCoins, castFromLines, castFromSeed, sumCoins } from "../src/coin.js";
import { loadHexagrams } from "../src/hexagrams.js";
import { repoRoot } from "../src/paths.js";
import { drawTarot } from "../src/tarot.js";

const AUTHORITATIVE = [
  ["易经乾", "hex-qian", "你正攒劲向前跑", "一直冲会跑空力气", "先给今天划条终点"],
  ["易经坤", "hex-kun", "你正接住很多事情", "手接太满会拿不稳", "先放下一件小事"],
  ["易经屯", "hex-zhun", "新路刚露出一点头", "急着跑会绊住脚", "先踩稳眼前一步"],
  ["易经谦", "hex-15", "你把声音放得很轻", "藏太深会没人听见", "把一个需要说出来"],
  ["易经既济", "hex-63", "事情暂时落了地", "松手太快会漏细节", "留十分钟收个尾"],
  ["塔罗愚人", "tarot-00", "你想推开一扇新门", "只看远方会漏台阶", "先试一个小版本"],
  ["塔罗隐士", "tarot-09", "你想安静理一理", "关门太久会绕圈", "找个信任的人聊聊"],
  ["塔罗战车", "tarot-07", "你正拉着目标往前", "两头用力会扯住你", "今天只选一个方向"],
  ["塔罗节制", "tarot-14", "你在找舒服的节奏", "一味迁就会挤掉自己", "给自己留一格空白"],
  ["塔罗星星", "tarot-17", "你开始看见一点光", "只等好转会错过今天", "做件能落地的小事"],
] as const;

test("advice phrases are the 30 authoritative sentences", () => {
  const file = loadAdvicePhrases();
  assert.equal(file.phrases.length, 30);
  const entries = new Set(file.phrases.map((phrase) => phrase.entryId));
  assert.equal(entries.size, 10);
  const hex = file.phrases.filter((phrase) => phrase.type === "hexagram");
  const tarot = file.phrases.filter((phrase) => phrase.type === "tarot");
  assert.equal(new Set(hex.map((phrase) => phrase.entryId)).size, 5);
  assert.equal(new Set(tarot.map((phrase) => phrase.entryId)).size, 5);
  for (const phrase of file.phrases) {
    assert.ok(codePointLength(phrase.text) < 15, phrase.text);
    assert.equal(phrase.label, "editorial-suggestion");
    assert.equal(["state", "risk", "action"].includes(phrase.role), true);
  }
  const actual = AUTHORITATIVE.map(([group, entryId, state, risk, action]) => {
    const rows = file.phrases.filter((phrase) => phrase.entryId === entryId);
    assert.equal(rows.length, 3, entryId);
    assert.equal(new Set(rows.map((phrase) => phrase.group)).size, 1);
    assert.equal(rows[0].group, group);
    const byRole = Object.fromEntries(rows.map((phrase) => [phrase.role, phrase.text]));
    return [group, entryId, byRole.state, byRole.risk, byRole.action];
  });
  assert.deepEqual(actual, AUTHORITATIVE);
  const phraseFiles = readdirSync(`${repoRoot()}/data`).filter((name) => name.includes("phrase"));
  assert.deepEqual(phraseFiles, ["advice-phrases.json"]);
});

test("advice returns the mapped sentences and rejects unknown ids", () => {
  const card = advise("tarot-00");
  const hex = advise("hex-qian");
  assert.equal(card.ok && hex.ok, true);
  if (!card.ok || !hex.ok) return;
  assert.equal((card.result.sentences as { state: string }).state, "你想推开一扇新门");
  assert.equal(card.result.mode, "symbolic-template");
  assert.equal(card.result.sentencesAreObservedUserState, false);
  assert.equal(card.result.observedUserState, null);
  assert.equal((hex.result.sentences as { action: string }).action, "先给今天划条终点");
  const linked = advise("hex-15", ["s1"]);
  assert.equal(linked.ok, true);
  if (!linked.ok) return;
  assert.equal(linked.result.mode, "evidence-grounded");
  assert.equal(linked.result.sentencesAreObservedUserState, false);
  assert.equal((linked.result.sentences as { state: string }).state, "你把声音放得很轻");
  const missing = advise("tarot-99");
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.code, "UNKNOWN_ID");
  const empty = advise("hex-qian", []);
  assert.equal(empty.ok, false);
});

test("three-coin cast is bottom-up and is not ichingshifa", () => {
  assert.equal(sumCoins([2, 2, 2]), 6);
  assert.equal(sumCoins([3, 2, 2]), 7);
  assert.equal(sumCoins([3, 3, 2]), 8);
  assert.equal(sumCoins([3, 3, 3]), 9);
  const cast = castFromLines([7, 8, 9, 7, 8, 9]);
  assert.equal(cast.ok, true);
  if (!cast.ok) return;
  assert.equal(cast.result.method, "three-coin");
  assert.equal(cast.result.notIchingshifa, true);
  assert.equal(cast.result.notYarrow, true);
  assert.equal((cast.result.primary as { name: string; kingWen: number }).name, "离");
  assert.equal((cast.result.primary as { kingWen: number }).kingWen, 30);
  assert.equal((cast.result.changed as { name: string; kingWen: number }).name, "震");
  assert.equal((cast.result.changed as { kingWen: number }).kingWen, 51);
  assert.deepEqual(cast.result.changingPositions, [3, 6]);
  const coins = castFromCoins([3, 2, 2, 3, 3, 2, 3, 3, 3, 3, 2, 2, 3, 3, 2, 3, 3, 3]);
  assert.equal(coins.ok, true);
  if (!coins.ok) return;
  assert.equal((coins.result.primary as { name: string }).name, "离");
  const bad = castFromLines([7, 8, 5]);
  assert.equal(bad.ok, false);
});

test("seeded coin and tarot draws repeat and do not call Math.random", () => {
  const a = castFromSeed(20241121);
  const b = castFromSeed(20241121);
  assert.deepEqual(a, b);
  const cardA = drawTarot(3);
  const cardB = drawTarot(3);
  assert.deepEqual(cardA, cardB);
  assert.equal(drawTarot(3).ok, true);
  const source = readFileSync(`${repoRoot()}/src/coin.ts`, "utf8") + readFileSync(`${repoRoot()}/src/tarot.ts`, "utf8");
  assert.equal(source.includes("Math.random"), false);
});

test("hexagram table has the king wen anchors", () => {
  const file = loadHexagrams();
  assert.equal(file.hexagrams.length, 64);
  const by = Object.fromEntries(file.hexagrams.map((item) => [item.kingWen, item.linesBottomUp.join("")]));
  assert.equal(by[1], "111111");
  assert.equal(by[2], "000000");
  assert.equal(by[3], "100010");
  assert.equal(by[30], "101101");
  assert.equal(by[51], "100100");
  assert.equal(by[63], "101010");
  assert.equal(by[64], "010101");
});
