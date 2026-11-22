import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "../src/paths.js";
import { runIchingshifa } from "../src/ichingshifa.js";

function run(args: string[]) {
  return spawnSync(process.execPath, ["dist/src/cli.js", ...args], {
    cwd: repoRoot(),
    encoding: "utf8",
  });
}

test("cli sample date prints real pillars", () => {
  const child = run(["bazi", "--input", "examples/solar-known-hour.json"]);
  assert.equal(child.status, 0, child.stderr);
  const body = JSON.parse(child.stdout) as { ok: boolean; result: { pillars: { year: { value: { ganZhi: string } }; hour: { value: { ganZhi: string } } } } };
  assert.equal(body.ok, true);
  assert.equal(body.result.pillars.year.value.ganZhi, "乙酉");
  assert.equal(body.result.pillars.hour.value.ganZhi, "壬辰");
});

test("cli advice and unknown hour", () => {
  const advice = run(["advice", "--id", "tarot-17"]);
  assert.equal(advice.status, 0);
  const adviceBody = JSON.parse(advice.stdout) as { result: { mode: string; sentencesAreObservedUserState: boolean; sentences: { state: string } } };
  assert.equal(adviceBody.result.mode, "symbolic-template");
  assert.equal(adviceBody.result.sentencesAreObservedUserState, false);
  assert.equal(adviceBody.result.sentences.state, "你开始看见一点光");
  const unknown = run(["bazi", "--calendar", "solar", "--year", "2005", "--month", "12", "--day", "23", "--hour", "unknown"]);
  assert.equal(unknown.status, 0);
  const body = JSON.parse(unknown.stdout) as { result: { pillars: { hour: { value: null } } } };
  assert.equal(body.result.pillars.hour.value, null);
  const bad = run(["advice", "--id", "no-such"]);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).error.code, "UNKNOWN_ID");
  const invalid = run(["bazi", "--calendar", "solar", "--year", "2023", "--month", "2", "--day", "29", "--hour", "8"]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).error.code, "INVALID_DATE");
});

test("examples are synthetic and the program does not write them", () => {
  for (const name of readdirSync(`${repoRoot()}/examples`)) {
    const body = JSON.parse(readFileSync(`${repoRoot()}/examples/${name}`, "utf8")) as { synthetic?: boolean };
    assert.equal(body.synthetic, true, name);
  }
  const temp = mkdtempSync(join(tmpdir(), "mingli-default-no-write-"));
  try {
    const store = join(temp, "missing");
    const child = spawnSync(process.execPath, [join(repoRoot(), "dist/src/cli.js"), "read", "--root", store], {
      cwd: temp, input: JSON.stringify({pillar:"psychology",synthetic:true}), encoding: "utf8",
      env: {...process.env, HOME:temp, XDG_DATA_HOME:temp},
    });
    assert.equal(child.status, 0, child.stdout);
    assert.equal(existsSync(store), false);
    assert.deepEqual(readdirSync(temp), []);
  } finally { rmSync(temp, {recursive:true,force:true}); }
});

test("ichingshifa adapter is explicit when the package is missing or present", () => {
  const result = runIchingshifa("789789");
  if (result.ok) {
    assert.equal(result.result.api, "Iching.mget_bookgua_details");
    assert.equal(result.result.primaryName, "離");
    assert.equal(result.result.changedName, "震");
    assert.equal(result.result.notThreeCoin, true);
    assert.equal(result.result.classicalTextIncluded, false);
  } else {
    assert.equal(result.error.code, "ICHINGSHIFA_UNAVAILABLE");
    assert.equal(JSON.stringify(result).includes("離"), false);
  }
  const bad = runIchingshifa("123");
  assert.equal(bad.ok, false);
});
