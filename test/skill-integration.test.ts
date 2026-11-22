import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { computeBazi } from "../src/bazi.js";
import { renderCardHtml } from "../src/card-render.js";
import { repoRoot } from "../src/paths.js";
import { runReading } from "../src/reading.js";

const fixture=(name:string)=>JSON.parse(readFileSync(join(repoRoot(),"tests","fixtures","demo-"+name+".json"),"utf8"));
const chart=(raw:unknown)=>{const r=computeBazi(raw);assert.equal(r.ok,true,JSON.stringify(r));if(!r.ok)throw Error();return r.result as {pillars:Record<string,{value?:{ganZhi:string}}>;provenance:Record<string,unknown>};};

test("unified input validates shape, rejects wrong method and excludes injected branch",()=>{
 assert.equal(runReading({pillar:"tarot",symbol:{method:"coin"}}).ok,false);
 const r=runReading({pillar:"psychology",profile:{birth:{year:1990}}});assert.ok(!r.ok);assert.equal(r.error.code,"INVALID_SCHEMA");
 const conflicts=runReading({pillar:"iching",symbol:{method:"coin",lines:[7,7,7,7,7,7],seed:3}});assert.ok(!conflicts.ok);
});

test("four real module adapters populate four card skins and exactly three labeled sentences",()=>{
 for(const [name,subject] of [["tarot","隐者"],["iching","离"],["astrology","巨蟹座"],["psychology",null]] as const){
  const r=runReading(fixture(name));
  assert.ok(r.ok,JSON.stringify(r));
  assert.equal(r.result.calculation_status,"ok");
  assert.equal(r.result.card.skin,name);
  if(subject)assert.match(r.result.card.subject??"",new RegExp(subject));
  assert.deepEqual(Object.keys(r.result.three_sentences),["state","risk","action"]);
  assert.deepEqual(r.result.card.sentences,r.result.three_sentences);
  assert.equal(r.result.trace.raw_inputs_saved,false);
 }
});

test("symbol choices and birth data don't become advice; crisis prevents calculations",()=>{
 const a=runReading(fixture("tarot"));
 const b=runReading({...fixture("tarot"),birth:{calendar:"solar",year:1999,month:2,day:10,hour:20,timezone:"Asia/Shanghai"},symbol:{method:"tarot",seed:2}});
 assert.ok(a.ok && b.ok);assert.deepEqual(a.result.three_sentences,b.result.three_sentences);
 const crisis=runReading({...fixture("tarot"),topic:"我现在想自杀"});assert.ok(crisis.ok,JSON.stringify(crisis));
 assert.equal(crisis.result.calculation_status,"safety_support");assert.equal(crisis.result.facts.symbolic,null);
 assert.equal(crisis.result.reading_links.length,0);
});

test("Bazi explicit Shanghai civil clock agrees with the original verified vector",()=>{
 const original={calendar:"solar",year:2005,month:12,day:23,hour:8,minute:37};
 const a=chart(original), b=chart({...original,timezone:"Asia/Shanghai"});
 assert.deepEqual(a.pillars,b.pillars); assert.equal(b.pillars.hour.value?.ganZhi,"壬辰");
 assert.equal(b.provenance.jieClock,"2005-12-23T08:37:00");
});

test("Bazi honors DST and no invented zone/time, true-solar affects day-hour but not year-month",()=>{
 const gap=computeBazi({calendar:"solar",year:2024,month:3,day:10,hour:2,minute:30,timezone:"America/New_York"});
 assert.ok(!gap.ok);assert.match(gap.error.code,/NONEXISTENT|GAP/);
 const fold=computeBazi({calendar:"solar",year:2024,month:11,day:3,hour:1,minute:30,timezone:"America/New_York"});assert.ok(!fold.ok);assert.match(fold.error.code,/AMBIGUOUS/);
 const birth={calendar:"solar",year:2024,month:4,day:15,hour:0,minute:5,timezone:"Asia/Shanghai"};
 const un=chart({...birth,hour:null,minute:undefined}); assert.equal(un.pillars.hour.value,null);
 const a=chart(birth), b=chart({...birth,timeStandard:"true-solar",longitude:90});
 assert.deepEqual(a.pillars.year,b.pillars.year);assert.deepEqual(a.pillars.month,b.pillars.month);
 assert.notEqual(a.pillars.day.value?.ganZhi,b.pillars.day.value?.ganZhi);
});

test("offline HTML uses inline assets, escapes script-like user input, and does not bundle raw birth fields",()=>{
 const malicious="</script><img src=x onerror=alert(1)>";
 const r=runReading({...fixture("tarot"),topic:malicious,birth:{calendar:"solar",year:2005,month:12,day:23,hour:8,timezone:"Asia/Shanghai"}});assert.ok(r.ok);
 const html=renderCardHtml(r.result.card);
 assert.match(html,/^<!doctype html>/);assert.match(html,/default-src 'none'/);
 assert.ok(!html.includes(malicious));assert.ok(!html.includes("Asia/Shanghai"));
 assert.match(html,/u003c\/script/);
 const payload=html.match(/<script type="application\/json" id="card-data">([^]*?)<\/script>/)?.[1];assert.ok(payload);
 assert.equal(JSON.parse(payload).title,malicious);
});

test("CLI emits HTML to stdout and timezone preserves UTC day rollover",()=>{
 const call=(cmd:string,body:unknown)=>spawnSync(process.execPath,["dist/src/cli.js",cmd,"--input","-"],{cwd:repoRoot(),encoding:"utf8",input:JSON.stringify(body)});
 const a=call("card",fixture("iching")); assert.equal(a.status,0,a.stderr); assert.match(a.stdout,/^<!doctype html>/);
 const b=call("timezone",{mode:"civil-to-utc",local:"2024-02-29T00:30:00",timezone:"Asia/Shanghai"});
 assert.equal(b.status,0,b.stdout);assert.match(JSON.parse(b.stdout).result.utc,/^2024-02-28T16:30/);
});


test("safety gate also checks explicit profile evidence and the tail of long profile quotes",()=>{
 const impacts=[
    {evidence:[{quoteId:"u1",quote:"我准备伤害自己",pole:"high",dimension:"neuroticism",timeScope:"recent"}]},
    {utterances:[{id:"u2",text:"普通信息。".repeat(170)+"我准备伤害自己"}]},
 ];
 for(const profile of impacts){
    const result=runReading({...fixture("tarot"),profile});
    assert.ok(result.ok,JSON.stringify(result));
    assert.equal(result.result.calculation_status,"safety_support");
    assert.equal(result.result.facts.symbolic,null);
    assert.match(result.result.evidence_ids[0]??"",/^u[12]$/);
 }
});
