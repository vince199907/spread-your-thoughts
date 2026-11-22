import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseBaziInput } from "./bazi.js";
import { validateZone } from "./timezone.js";
import { fail, ok, type Result } from "./result.js";

export type LocalKind = "birth" | "bazi" | "result";
export interface LocalRecordSummary { kind: LocalKind; id: string; savedAt: string }
export interface LocalRecord extends LocalRecordSummary { version: 1; data: Record<string, unknown>; revision?: string; sourceStatus?: "available" | "source-deleted" }

const limitBytes = 4096;
const limitRecords = 500;
const kinds = new Set(["birth", "bazi", "result"]);
const idPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const token = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const revisionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const namePattern = /^(birth|bazi|result)--([a-z0-9][a-z0-9_-]{0,47})\.json$/;
const ganzhi = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/u;
const slots = ["year", "month", "day", "hour"];
const birthKeys = ["calendar","year","month","day","hour","minute","second","leap","zone","timezone","disambiguation","timeStandard","longitude","latitude","gender","sect"];
const own = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ? value as Record<string, unknown> : null;
const valid = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const isKind = (value: unknown): value is LocalKind => typeof value === "string" && kinds.has(value);
const errno = (error: unknown) => (error as NodeJS.ErrnoException).code;
const invalid = () => fail("INVALID_STORAGE_DATA", "本地保存只接受对应类别的有限字段，不保存原始对话、答卷或其他内容。");
const rootFailure = () => fail("INVALID_STORAGE_ROOT", "须指定绝对路径及规范化的、仅当前账户可访问的目录；不跟随符号链接。");
const missing = () => fail("STORAGE_NOT_FOUND", "未找到指定的本地记录。");

function normalizeData(kind: LocalKind, value: unknown): Result<Record<string, unknown>> {
  const data = asObject(value);
  if (data === null) return invalid();
  if (kind === "birth") {
    if (!own(data, birthKeys)) return invalid();
    const parsed = parseBaziInput(data);
    if (!parsed.ok || parsed.result.year < 1 || parsed.result.year > 9999 || (parsed.result.calendar === "lunar" && (parsed.result.day < 1 || parsed.result.day > 30))) return invalid();
    if (data.zone !== undefined && data.timezone !== undefined && data.zone !== data.timezone) return invalid();
    const timezone = data.timezone === undefined ? data.zone : data.timezone;
    if (timezone !== undefined) {
      if (typeof timezone !== "string" || timezone.length > 80) return invalid();
      try { validateZone(timezone); } catch { return invalid(); }
    }
    if (data.disambiguation !== undefined && (
      timezone === undefined || parsed.result.hour === null ||
      (data.disambiguation !== "reject" && data.disambiguation !== "earlier" && data.disambiguation !== "later")
    )) return invalid();
    if (data.timeStandard !== undefined && data.timeStandard !== "civil" && data.timeStandard !== "true-solar") return invalid();
    for (const [key, max] of [["longitude", 180], ["latitude", 90]] as const) {
      const v = data[key];
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > max)) return invalid();
    }
    if (data.timeStandard === "true-solar" && (data.longitude === undefined || timezone === undefined)) return invalid();
    return ok(Object.fromEntries(birthKeys.filter(key => data[key] !== undefined).map(key => [key, data[key]])));
  }
  if (!valid(data.ruleVersion, token)) return invalid();
  if (kind === "bazi") {
    const pillars = asObject(data.pillars);
    if (!own(data, ["profileId", "ruleVersion", "pillars"]) || !valid(data.profileId, idPattern) || !pillars ||
        !own(pillars, slots) || !slots.every(slot => pillars[slot] === null || valid(pillars[slot], ganzhi))) return invalid();
    return ok({ profileId: data.profileId, ruleVersion: data.ruleVersion, pillars: Object.fromEntries(slots.map(slot => [slot, pillars[slot]])) });
  }
  if (!own(data, ["pillar", "ruleVersion", "symbolIds"]) ||
      (data.pillar !== "tarot" && data.pillar !== "iching" && data.pillar !== "astrology" && data.pillar !== "psychology") ||
      !Array.isArray(data.symbolIds) || data.symbolIds.length > 12 || !data.symbolIds.every(id => valid(id, token))) return invalid();
  return ok({ pillar: data.pillar, ruleVersion: data.ruleVersion, symbolIds: [...data.symbolIds] });
}

function checkedRoot(root: string, create = false): Result<string> {
  if (typeof root !== "string" || !isAbsolute(root) || root !== resolve(root) || dirname(root) === root) return rootFailure();
  try {
    if (realpathSync(dirname(root)) !== dirname(root)) return rootFailure();
    let stat;
    try { stat = lstatSync(root); }
    catch (error) {
      if (errno(error) !== "ENOENT") return rootFailure();
      if (!create) return missing();
      try { mkdirSync(root, { mode: 0o700 }); } catch (e) { if (errno(e) !== "EEXIST") return rootFailure(); }
      stat = lstatSync(root);
    }
    if (realpathSync(root) !== root || !stat.isDirectory() || stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) return rootFailure();
    return ok(root);
  } catch { return rootFailure(); }
}
const filename = (root: string, kind: LocalKind, id: string) => join(root, `${kind}--${id}.json`);
const summary = ({ kind, id, savedAt }: LocalRecord): LocalRecordSummary => ({ kind, id, savedAt });

function readChecked(root: string, kind: LocalKind, id: string): Result<LocalRecord> {
  let handle: number | undefined;
  try {
    const target = filename(root, kind, id);
    const link = lstatSync(target);
    if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) return fail("INVALID_STORAGE_FILE", "拒绝读取非普通记录或链接。");
    handle = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.ino !== link.ino || stat.dev !== link.dev || stat.nlink !== 1 || stat.size > limitBytes ||
        (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
      return fail("INVALID_STORAGE_FILE", "本地记录格式或权限无效。");
    }
    const raw = readFileSync(handle, { encoding: "utf8" });
    const record = Buffer.byteLength(raw) <= limitBytes ? asObject(JSON.parse(raw)) : null;
    if (!record || !own(record, ["version","kind","id","data","savedAt","revision"]) || record.version !== 1 ||
        record.kind !== kind || record.id !== id || typeof record.savedAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.savedAt) ||
        !Number.isFinite(Date.parse(record.savedAt)) ||
        (kind === "result" ? record.revision !== undefined : !valid(record.revision, revisionPattern))) return fail("INVALID_STORAGE_FILE", "本地记录格式无效。");
    const data = normalizeData(kind, record.data);
    return data.ok ? ok({ kind, id, version: 1, savedAt: record.savedAt, data: data.result, ...(typeof record.revision === "string" ? { revision: record.revision } : {}) }) : data;
  } catch (error) {
    return errno(error) === "ENOENT" ? missing() : fail("INVALID_STORAGE_FILE", "无法读取本地记录；未追随链接。");
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

export function saveLocal(root: string, request: unknown): Result<LocalRecordSummary> {
  const value = asObject(request);
  if (!value || value.consent !== true) return fail("STORAGE_CONSENT_REQUIRED", "本次未明确选择保存该记录；未写入。");
  if (!own(value, ["consent","kind","id","data"]) || !isKind(value.kind) || !valid(value.id, idPattern)) return invalid();
  const { kind, id } = value;
  const data = normalizeData(kind, value.data);
  if (!data.ok) return data;
  const base = checkedRoot(root, true);
  if (!base.ok) return base;
  let revision: string | undefined = kind === "birth" ? randomUUID() : undefined;
  if (kind === "bazi") {
    const profile = readChecked(root, "birth", data.result.profileId as string);
    if (!profile.ok) return fail("STORAGE_PROFILE_REQUIRED", "须先分开授权保存对应的出生资料，才可另存命盘引用。");
    revision = profile.result.revision;
  }
  const record: LocalRecord = { kind, id, savedAt: new Date().toISOString(), version: 1, data: data.result, ...(revision ? { revision } : {}) };
  const tmp = join(root, `.tmp-${randomUUID()}`);
  const target = filename(root, kind, id);
  try {
    if (readdirSync(root).filter(name => namePattern.test(name)).length >= limitRecords) return fail("STORAGE_LIMIT", "本地记录达到上限。");
    writeFileSync(tmp, JSON.stringify(record) + "\n", { flag: "wx", mode: 0o600 });
    linkSync(tmp, target);
    return ok(summary(record));
  } catch (error) {
    return errno(error) === "EEXIST" ? fail("STORAGE_EXISTS", "指定编号已有记录；不会覆盖。") : fail("STORAGE_WRITE_FAILED", "未能保存本地记录。");
  } finally {
    try { unlinkSync(tmp); } catch { /* nothing to remove */ }
  }
}

export function readLocal(root: string, kind: unknown, id: unknown): Result<LocalRecord> {
  if (!isKind(kind) || !valid(id, idPattern)) return invalid();
  const base = checkedRoot(root);
  if (!base.ok) return base;
  const value = readChecked(root, kind, id);
  if (!value.ok || kind !== "bazi") return value;
  const profile = readChecked(root, "birth", value.result.data.profileId as string);
  return ok({ ...value.result, sourceStatus: profile.ok && profile.result.revision === value.result.revision ? "available" : "source-deleted" });
}
export function listLocal(root: string): Result<LocalRecordSummary[]> {
  const base = checkedRoot(root);
  if (!base.ok) return base.error.code === "STORAGE_NOT_FOUND" ? ok([]) : base;
  try {
    const names = readdirSync(root).filter(name => namePattern.test(name)).sort();
    if (names.length > limitRecords) return fail("STORAGE_LIMIT", "本地记录超出读取上限。");
    const items: LocalRecordSummary[] = [];
    for (const name of names) {
      const match = namePattern.exec(name)!;
      const value = readChecked(root, match[1] as LocalKind, match[2]);
      if (!value.ok) return value;
      items.push(summary(value.result));
    }
    return ok(items);
  } catch { return fail("STORAGE_READ_FAILED", "无法列出本地记录。"); }
}
export function deleteLocal(root: string, kind: unknown, id: unknown, options?: { cascadeBazi?: boolean }): Result<LocalRecordSummary> {
  const value = readLocal(root, kind, id);
  if (!value.ok) return value;
  const record = value.result;
  try {
    if (record.kind === "birth" && options?.cascadeBazi === true) {
      const items = listLocal(root);
      if (!items.ok) return items;
      const linked: string[] = [];
      for (const item of items.result) {
        if (item.kind !== "bazi") continue;
        const bazi = readChecked(root, "bazi", item.id);
        if (!bazi.ok) return bazi;
        if (bazi.result.data.profileId === record.id && bazi.result.revision === record.revision) linked.push(filename(root, "bazi", item.id));
      }
      for (const path of linked) unlinkSync(path);
    }
    unlinkSync(filename(root, record.kind, record.id));
    return ok(summary(record));
  } catch { return fail("STORAGE_DELETE_FAILED", "删除未全部完成；请重新列出记录确认。"); }
}
