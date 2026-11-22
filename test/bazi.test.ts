import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { computeBazi } from "../src/bazi.js";
import { repoRoot } from "../src/paths.js";

test("known solar vector matches lunar-javascript eight characters", () => {
  const result = computeBazi({
    calendar: "solar",
    year: 2005,
    month: 12,
    day: 23,
    hour: 8,
    minute: 37,
    second: 0,
    sect: 2,
    gender: "female",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const pillars = result.result.pillars as {
    year: { value: { ganZhi: string } };
    month: { value: { ganZhi: string } };
    day: { value: { ganZhi: string } };
    hour: { value: { ganZhi: string } };
  };
  assert.equal(pillars.year.value.ganZhi, "乙酉");
  assert.equal(pillars.month.value.ganZhi, "戊子");
  assert.equal(pillars.day.value.ganZhi, "辛巳");
  assert.equal(pillars.hour.value.ganZhi, "壬辰");
  const dayMaster = result.result.dayMaster as { stem: string; label: string };
  assert.equal(dayMaster.stem, "辛");
  assert.equal(dayMaster.label, "日主");
  const ten = result.result.tenGods as { stems: Record<string, string>; branches: Record<string, string[]> };
  assert.equal(ten.stems.year, "偏财");
  assert.equal(ten.stems.month, "正印");
  assert.equal(ten.stems.day, "日主");
  assert.equal(ten.stems.hour, "伤官");
  assert.deepEqual(ten.branches.year, ["比肩"]);
  assert.deepEqual(ten.branches.day, ["正官", "劫财", "正印"]);
  const elements = result.result.elements as {
    elementCountsArePersonalityMeasures: boolean;
    surface: { counts: Record<string, number> };
  };
  assert.equal(elements.elementCountsArePersonalityMeasures, false);
  assert.deepEqual(elements.surface.counts, { 木: 1, 火: 1, 土: 2, 金: 2, 水: 2 });
  assert.equal((result.result.provenance as { engineVersion: string }).engineVersion, "1.7.8");
  assert.equal(result.result.genderUsedInCalculation, false);
});

test("gender is recorded and does not change pillars", () => {
  const female = computeBazi({ calendar: "solar", year: 2005, month: 12, day: 23, hour: 8, minute: 37, gender: "female" });
  const male = computeBazi({ calendar: "solar", year: 2005, month: 12, day: 23, hour: 8, minute: 37, gender: "male" });
  assert.equal(female.ok && male.ok, true);
  if (!female.ok || !male.ok) return;
  const strip = (value: Record<string, unknown>) => {
    const copy = structuredClone(value);
    (copy.input as { gender: unknown }).gender = null;
    return copy;
  };
  assert.deepEqual(strip(female.result), strip(male.result));
});

test("unknown hour omits the hour pillar and does not use noon", () => {
  const unknown = computeBazi({ calendar: "solar", year: 2005, month: 12, day: 23, hour: "unknown", sect: 2 });
  const noon = computeBazi({ calendar: "solar", year: 2005, month: 12, day: 23, hour: 12, minute: 0, sect: 2 });
  assert.equal(unknown.ok && noon.ok, true);
  if (!unknown.ok || !noon.ok) return;
  const hour = (unknown.result.pillars as { hour: { status: string; value: null } }).hour;
  assert.equal(hour.status, "unknown");
  assert.equal(hour.value, null);
  const noonHour = (noon.result.pillars as { hour: { value: { ganZhi: string } } }).hour.value.ganZhi;
  assert.equal(noonHour, "甲午");
  assert.equal(JSON.stringify(unknown.result).includes("甲午"), false);
  const day = (unknown.result.pillars as { day: { value: { ganZhi: string } } }).day.value.ganZhi;
  assert.equal(day, "辛巳");
  assert.equal((unknown.result.provenance as { noonSubstitution: boolean }).noonSubstitution, false);
});

test("sect 1 with unknown hour keeps both day pillars", () => {
  const result = computeBazi({ calendar: "solar", year: 2005, month: 12, day: 23, hour: null, sect: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const day = result.result.pillars as { day: { status: string; value: null; candidates: { value: { ganZhi: string } }[] }; hour: { value: null } };
  assert.equal(day.day.status, "ambiguous");
  assert.equal(day.day.value, null);
  assert.deepEqual(day.day.candidates.map((item) => item.value.ganZhi).sort(), ["壬午", "辛巳"]);
  assert.equal(day.hour.value, null);
  assert.equal((result.result.tenGods as { status: string }).status, "ambiguous");
});

test("lichun day is ambiguous when the hour is unknown", () => {
  const result = computeBazi({ calendar: "solar", year: 2024, month: 2, day: 4, hour: "unknown", sect: 2 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const pillars = result.result.pillars as {
    year: { status: string; candidates: { value: { ganZhi: string } }[] };
    month: { status: string; candidates: { value: { ganZhi: string } }[] };
    hour: { value: null };
  };
  assert.equal(pillars.hour.value, null);
  assert.equal(pillars.year.status, "ambiguous");
  assert.equal(pillars.month.status, "ambiguous");
  assert.deepEqual(pillars.year.candidates.map((item) => item.value.ganZhi).sort(), ["甲辰", "癸卯"]);
  assert.deepEqual(pillars.month.candidates.map((item) => item.value.ganZhi).sort(), ["丙寅", "乙丑"]);
  assert.equal((result.result.elements as { surface: { status: string } }).surface.status, "ambiguous");
});

test("late zi sect switch matches the library vector", () => {
  const sect2 = computeBazi({ calendar: "solar", year: 1988, month: 2, day: 15, hour: 23, minute: 30, sect: 2 });
  const sect1 = computeBazi({ calendar: "solar", year: 1988, month: 2, day: 15, hour: 23, minute: 30, sect: 1 });
  assert.equal(sect2.ok && sect1.ok, true);
  if (!sect2.ok || !sect1.ok) return;
  const day2 = (sect2.result.pillars as { day: { value: { ganZhi: string } }; hour: { value: { ganZhi: string } } });
  const day1 = (sect1.result.pillars as { day: { value: { ganZhi: string } }; hour: { value: { ganZhi: string } } });
  assert.equal(day2.day.value.ganZhi, "庚子");
  assert.equal(day2.hour.value.ganZhi, "戊子");
  assert.equal(day1.day.value.ganZhi, "辛丑");
  assert.equal(day1.hour.value.ganZhi, "戊子");
});

test("invalid solar date is rejected before a chart is returned", () => {
  const result = computeBazi({ calendar: "solar", year: 2023, month: 2, day: 29, hour: 8 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "INVALID_DATE");
});

test("leap month is supported only when the library has that leap", () => {
  const missing = computeBazi({ calendar: "lunar", year: 2021, month: 4, day: 1, leap: true, hour: 8 });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.code, "NO_LEAP_MONTH");
  const required = computeBazi({ calendar: "lunar", year: 2020, month: 4, day: 1, hour: 8 });
  assert.equal(required.ok, false);
  if (required.ok) return;
  assert.equal(required.error.code, "LEAP_FLAG_REQUIRED");
  const leap = computeBazi({ calendar: "lunar", year: 2020, month: 4, day: 1, leap: true, hour: 8 });
  const regular = computeBazi({ calendar: "lunar", year: 2020, month: 4, day: 1, leap: false, hour: 8 });
  assert.equal(leap.ok && regular.ok, true);
  if (!leap.ok || !regular.ok) return;
  assert.deepEqual(leap.result.resolvedSolar, { year: 2020, month: 5, day: 23 });
  assert.deepEqual(regular.result.resolvedSolar, { year: 2020, month: 4, day: 23 });
  const tooLong = computeBazi({ calendar: "lunar", year: 2020, month: 4, day: 30, leap: true, hour: 8 });
  assert.equal(tooLong.ok, false);
});

test("sample files are synthetic", () => {
  for (const name of ["solar-known-hour.json", "solar-unknown-hour.json", "lunar-leap.json"]) {
    const body = JSON.parse(readFileSync(`${repoRoot()}/examples/${name}`, "utf8")) as { synthetic: boolean };
    assert.equal(body.synthetic, true);
  }
});
