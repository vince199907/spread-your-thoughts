import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { civilToUtc, type CivilInput } from "../src/timezone.js";
import { saveLocal, listLocal, readLocal, deleteLocal } from "../src/storage.js";

const birth = { calendar: "solar", year: 1994, month: 4, day: 18, hour: 9, zone: "Asia/Shanghai", timeStandard: "civil" };
const bazi = { profileId: "p1", ruleVersion: "bazi-v1", pillars: { year: "甲子", month: "乙丑", day: "丙寅", hour: null } };
const result = { pillar: "tarot", ruleVersion: "spread-v1", symbolIds: ["tarot-09"] };
function sandbox(fn: (root: string, outer: string) => void) {
  return () => {
    const outer = mkdtempSync(join(realpathSync(tmpdir()), "syt-test-"));
    try { fn(join(outer, "private"), outer); } finally { rmSync(outer, { recursive: true, force: true }); }
  };
}
function code(result: { ok: true } | { ok: false; error: { code: string } }) { return result.ok ? "ok" : result.error.code; }

test("storage creates nothing for read, list, invalid data or missing consent", sandbox(root => {
  assert.deepEqual(listLocal(root), { ok: true, result: [] });
  assert.equal(code(readLocal(root, "birth", "p1")), "STORAGE_NOT_FOUND");
  assert.equal(code(saveLocal(root, { kind: "birth", id: "p1", data: birth })), "STORAGE_CONSENT_REQUIRED");
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "p1", data: { ...birth, quote: "never store" } })), "INVALID_STORAGE_DATA");
  assert.equal(existsSync(root), false);
}));

test("birth save, metadata-only listing, separate derivative and no overwrite", sandbox(root => {
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "p1", data: birth })), "ok");
  assert.equal(lstatSync(root).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(root, "birth--p1.json")).mode & 0o777, 0o600);
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "p1", data: { ...birth, year: 2000 } })), "STORAGE_EXISTS");
  const saved = readLocal(root, "birth", "p1");
  assert.ok(saved.ok);
  assert.deepEqual(saved.result.data, birth);
  assert.equal(code(saveLocal(root, { consent: true, kind: "bazi", id: "b1", data: bazi })), "ok");
  assert.equal(code(saveLocal(root, { consent: true, kind: "result", id: "r1", data: result })), "ok");
  const files = listLocal(root);
  assert.ok(files.ok);
  assert.deepEqual(files.result.map(x => x.kind), ["bazi","birth","result"]);
  assert.ok(files.result.every(x => Object.keys(x).sort().join(",") === "id,kind,savedAt"));
  assert.doesNotMatch(readFileSync(join(root, "bazi--b1.json"), "utf8"), /1994|Shanghai/);
}));

test("deletes one scope unless cascade explicitly set", sandbox(root => {
  assert.equal(code(saveLocal(root, { consent: true, kind: "bazi", id: "b1", data: bazi })), "STORAGE_PROFILE_REQUIRED");
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "p1", data: birth })), "ok");
  assert.equal(code(saveLocal(root, { consent: true, kind: "bazi", id: "b1", data: bazi })), "ok");
  assert.equal(code(deleteLocal(root, "birth", "p1")), "ok");
  assert.equal(code(readLocal(root, "birth", "p1")), "STORAGE_NOT_FOUND");
  const orphan = readLocal(root, "bazi", "b1");
  assert.ok(orphan.ok);
  assert.equal(orphan.result.sourceStatus, "source-deleted");
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "p1", data: birth })), "ok");
  const orphanAfter = readLocal(root, "bazi", "b1");
  assert.ok(orphanAfter.ok);
  assert.equal(orphanAfter.result.sourceStatus, "source-deleted");
  assert.equal(code(saveLocal(root, { consent: true, kind: "bazi", id: "b2", data: bazi })), "ok");
  assert.equal(code(deleteLocal(root, "birth", "p1", { cascadeBazi: true })), "ok");
  assert.equal(code(readLocal(root, "bazi", "b2")), "STORAGE_NOT_FOUND");
  assert.equal(code(readLocal(root, "bazi", "b1")), "ok");
}));

test("rejects directories and entry symlinks, traversal and open permissions", sandbox((root, outer) => {
  mkdirSync(root, { mode: 0o700 });
  const linkedRoot = join(outer, "linked");
  symlinkSync(root, linkedRoot);
  assert.equal(code(listLocal(linkedRoot)), "INVALID_STORAGE_ROOT");
  const external = join(outer, "outside");
  writeFileSync(external, "untouched");
  symlinkSync(external, join(root, "result--r1.json"));
  assert.equal(code(readLocal(root, "result", "r1")), "INVALID_STORAGE_FILE");
  assert.equal(code(deleteLocal(root, "result", "r1")), "INVALID_STORAGE_FILE");
  assert.equal(code(saveLocal(root, { consent: true, kind: "result", id: "r1", data: result })), "STORAGE_EXISTS");
  assert.equal(readFileSync(external, "utf8"), "untouched");
  assert.equal(code(saveLocal(root, { consent: true, kind: "result", id: "../outside", data: result })), "INVALID_STORAGE_DATA");
  chmodSync(root, 0o755);
  assert.equal(code(listLocal(root)), "INVALID_STORAGE_ROOT");
}));

test("rejects narrative, evidence, scores, impossible date, invalid zone and oversized file", sandbox(root => {
  for (const data of [{ ...birth, day: 31 }, { ...birth, zone: "Moon/Space" }, { ...birth, timeStandard: "true-solar" }]) {
    assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "p1", data })), "INVALID_STORAGE_DATA");
  }
  for (const data of [{ ...result, three_sentences: ["a","b","c"] }, { ...result, answers: [1,2] }, { ...result, symbolIds: ["not a token"] }]) {
    assert.equal(code(saveLocal(root, { consent: true, kind: "result", id: "r1", data })), "INVALID_STORAGE_DATA");
  }
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(join(root, "result--r1.json"), "x".repeat(4097), { mode: 0o600 });
  assert.equal(code(readLocal(root, "result", "r1")), "INVALID_STORAGE_FILE");
}));

test("stores the explicit historical Shanghai DST fold choice for reproducible readback", sandbox(root => {
  for (const [choice, zoneKey, expected, offset] of [
    ["earlier", "zone", "1991-09-14T16:30:00.000Z", "+09:00"],
    ["later", "timezone", "1991-09-14T17:30:00.000Z", "+08:00"],
  ] as const) {
    const date = { calendar: "solar", year: 1991, month: 9, day: 15, hour: 1, minute: 30, [zoneKey]: "Asia/Shanghai", disambiguation: choice };
    assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: choice, data: date })), "ok");
    const stored = readLocal(root, "birth", choice);
    assert.ok(stored.ok);
    assert.deepEqual(stored.result.data, date);
    const d = stored.result.data;
    const p = (value: unknown) => String(value).padStart(2, "0");
    const actual = civilToUtc({
      local: `${d.year}-${p(d.month)}-${p(d.day)}T${p(d.hour)}:${p(d.minute)}`,
      timezone: (d.timezone ?? d.zone) as string,
      disambiguation: d.disambiguation as CivilInput["disambiguation"],
    });
    assert.equal(actual.utc, expected);
    assert.equal(actual.offset, offset);
  }
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "invalid", data: { ...birth, timezone: "America/New_York" } })), "INVALID_STORAGE_DATA");
  assert.equal(code(saveLocal(root, { consent: true, kind: "birth", id: "invalid", data: { ...birth, disambiguation: "compatible" } })), "INVALID_STORAGE_DATA");
}));
