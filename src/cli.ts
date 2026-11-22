#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { advise } from "./advice.js";
import { computeBazi } from "./bazi.js";
import { castFromCoins, castFromLines, castFromSeed } from "./coin.js";
import { runIchingshifa } from "./ichingshifa.js";
import { listOptionalPrompts, summarizePsychology } from "./psychology.js";
import { calculateAstrology } from "./astrology_adapter.js";
import { civilToUtc, utcToCivil, trueSolarTime, TimeInputError } from "./timezone.js";
import { runReading } from "./reading.js";
import { renderCardHtml } from "./card-render.js";
import { miniIPIPQuestionnaire, scoreConfirmedItems } from "./confirmed-item-scoring.js";
import { listConversationQuestions, nextConversationQuestion } from "./conversation.js";
import { saveLocal, listLocal, readLocal, deleteLocal } from "./storage.js";
import { exitCodeFor, fail, ok, type Result } from "./result.js";
import { drawTarot, readTarot } from "./tarot.js";

interface Flags {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): { cmd: string; flags: Flags } {
  const [cmd = "help", ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      return { cmd: "help", flags: { error: `无法识别参数 ${token}` } };
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { cmd, flags };
}

function readJson(path: string): unknown {
  const text = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  return JSON.parse(text);
}

function asNumber(value: string | boolean | undefined, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return undefined;
  return Number(value);
}

function quoteIds(raw: unknown): string[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.evidence)) {
    return obj.evidence.map((item, index) => {
      if (item && typeof item === "object" && typeof (item as { quoteId?: string }).quoteId === "string") {
        return (item as { quoteId: string }).quoteId;
      }
      return `evidence-${index + 1}`;
    });
  }
  if (Array.isArray(obj.utterances)) {
    return obj.utterances.map((item, index) => {
      if (item && typeof item === "object" && typeof (item as { id?: string }).id === "string") {
        return (item as { id: string }).id;
      }
      return `u${index + 1}`;
    });
  }
  return null;
}

function baziFromFlags(flags: Flags): unknown {
  if (typeof flags.input === "string") return readJson(flags.input);
  const hourFlag = flags.hour;
  let hour: number | string | null | undefined;
  if (hourFlag === undefined) hour = undefined;
  else if (hourFlag === true || hourFlag === "unknown") hour = "unknown";
  else hour = asNumber(hourFlag);
  const body: Record<string, unknown> = {
    calendar: flags.calendar,
    year: asNumber(flags.year),
    month: asNumber(flags.month),
    day: asNumber(flags.day),
  };
  if (hour !== undefined) body.hour = hour;
  if (flags.minute !== undefined) body.minute = asNumber(flags.minute);
  if (flags.second !== undefined) body.second = asNumber(flags.second);
  if (flags.sect !== undefined) body.sect = asNumber(flags.sect);
  if (flags.leap !== undefined) {
    if (flags.leap !== "true" && flags.leap !== "false") return { leap: flags.leap };
    body.leap = flags.leap === "true";
  }
  if (typeof flags.gender === "string") body.gender = flags.gender;
  for (const key of ["timezone","timeStandard","disambiguation"]) if (flags[key] !== undefined) body[key]=flags[key];
  if (flags.longitude !== undefined) body.longitude=typeof flags.longitude==="string"&&flags.longitude.trim()!==""?Number(flags.longitude):null;
  return body;
}

function print(result: Result<unknown>): number {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : exitCodeFor(result.error.code);
}

function help(): string {
  return `mingli：离线四柱、三钱、编辑建议与规则心理摘要

  mingli bazi --input examples/solar-known-hour.json
  mingli bazi --calendar solar --year 2005 --month 12 --day 23 --hour 8 --minute 37
  mingli bazi --calendar solar --year 2005 --month 12 --day 23 --hour unknown
  mingli advice --id hex-qian
  mingli advice --id tarot-00 --evidence examples/psychology-two-behaviors.json
  mingli coin --lines 7,8,9,7,8,9
  mingli coin --seed 20241121
  mingli tarot-draw --seed 3
  mingli psychology --input examples/psychology-empty.json
  mingli prompts
  mingli ichingshifa --lines 789789
  mingli astrology --input <json或->
  mingli timezone --input <json或->   # mode: civil-to-utc / utc-to-civil / true-solar
  mingli read --input <json或->
  mingli card --input <json或-> > reading-card.html
  mingli questions | mingli next-question --input <json或->
  mingli questionnaire | mingli score --input <json或->
  mingli tarot-draw --input <json或->
  mingli save --root <绝对路径> --input <含分项 consent:true 的 JSON>
  mingli list --root <绝对路径>
  mingli load|delete --root <绝对路径> --kind <birth|bazi|result> --id <编号>

计算和读取默认不保存。卡片输出到 stdout，仅按显式重定向写入指定文件；
请勿将真实出生资料放进 shell 历史，优先使用 stdin。`;
}

function main(): number {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (flags.error) {
    process.stderr.write(`${String(flags.error)}\n`);
    process.stdout.write(`${help()}\n`);
    return 1;
  }
  try {
    if (cmd === "help" || flags.help === true) {
      process.stdout.write(`${help()}\n`);
      return cmd === "help" ? 1 : 0;
    }
    if (cmd === "bazi") {
      const raw =
        flags.input === undefined && flags.calendar === undefined && !process.stdin.isTTY
          ? readJson("-")
          : baziFromFlags(flags);
      return print(computeBazi(raw));
    }
    if (cmd === "advice") {
      if (typeof flags.id !== "string") return print({ ok: false, error: { code: "MISSING_ID", message: "advice 需要 --id。" } });
      let ids: string[] | undefined;
      if (typeof flags.evidence === "string") {
        const found = quoteIds(readJson(flags.evidence));
        if (!found || found.length === 0) {
          return print({ ok: false, error: { code: "EVIDENCE_REQUIRED", message: "证据文件里没有引用编号。" } });
        }
        ids = found;
      }
      return print(advise(flags.id, ids));
    }
    if (cmd === "coin") {
      if (typeof flags.lines === "string" && flags.seed !== undefined) {
        return print({ ok: false, error: { code: "AMBIGUOUS_INPUT", message: "lines 与 seed 只能选一个。" } });
      }
      if (typeof flags.lines === "string") {
        const values = flags.lines.split(",").map((part) => Number(part.trim()));
        return print(castFromLines(values));
      }
      if (typeof flags.coins === "string") {
        const coins = flags.coins.split(",").map((part) => Number(part.trim()));
        return print(castFromCoins(coins));
      }
      if (typeof flags.seed === "string") {
        const seed = asNumber(flags.seed);
        if (seed === undefined) return print({ ok: false, error: { code: "INVALID_SEED", message: "seed 必须是整数。" } });
        return print(castFromSeed(seed));
      }
      return print({ ok: false, error: { code: "MISSING_CAST", message: "coin 需要 --lines、--coins 或 --seed。" } });
    }
    if (cmd === "tarot-draw") {
      if (typeof flags.input === "string") return print(readTarot(readJson(flags.input)));
      const seed = asNumber(typeof flags.seed === "string" ? flags.seed : undefined);
      if (seed === undefined) return print({ ok: false, error: { code: "INVALID_SEED", message: "tarot-draw 需要整数 --seed。" } });
      return print(drawTarot(seed));
    }
    if (cmd === "psychology") {
      const raw =
        typeof flags.input === "string"
          ? readJson(flags.input)
          : !process.stdin.isTTY
            ? readJson("-")
            : { evidence: [] };
      return print(summarizePsychology(raw));
    }
    if (cmd === "prompts") return print(listOptionalPrompts());
    if (cmd === "ichingshifa") {
      if(flags.lines!==undefined && flags.seed!==undefined) return print(fail("AMBIGUOUS_INPUT","爻值与种子只能选一个。"));
      if(flags.seed!==undefined){
        const seed=asNumber(flags.seed);if(seed===undefined)return print(fail("INVALID_SEED","seed 必须是整数。"));
        return print(runIchingshifa({seed}));
      }
      if (typeof flags.lines !== "string") {
        return print({ ok: false, error: { code: "MISSING_LINES", message: "ichingshifa 需要 --lines，例如 789789。" } });
      }
      return print(runIchingshifa(flags.lines.replace(/,/g, "")));
    }
    const readInput = () => readJson(typeof flags.input === "string" ? flags.input : "-");
    if (cmd === "questions") return print(ok(listConversationQuestions()));
    if (cmd === "next-question") return print(nextConversationQuestion(readInput()));
    if (cmd === "questionnaire") return print(ok(miniIPIPQuestionnaire()));
    if (cmd === "score") return print(scoreConfirmedItems(readInput()));
    if (cmd === "astrology") {
      const raw=readInput();
      if(!raw||typeof raw!=="object"||Array.isArray(raw))return print(fail("INVALID_INPUT","占星输入需要 JSON 对象。"));
      return print(ok(calculateAstrology(raw)));
    }
    if (cmd === "timezone") {
      const raw=readInput();
      if(!raw||typeof raw!=="object"||Array.isArray(raw))return print(fail("INVALID_INPUT","时间输入需要 JSON 对象。"));
      const {mode,...params}=raw as {mode?:string} & Record<string,unknown>;
      if(mode==="civil-to-utc") return print(ok(civilToUtc(params as unknown as Parameters<typeof civilToUtc>[0])));
      if(mode==="utc-to-civil") return print(ok(utcToCivil(params as unknown as Parameters<typeof utcToCivil>[0])));
      if(mode==="true-solar") return print(ok(trueSolarTime(params as unknown as Parameters<typeof trueSolarTime>[0])));
      return print(fail("INVALID_TIME_MODE","请输入 civil-to-utc、utc-to-civil 或 true-solar。"));
    }
    if (cmd === "read" || cmd === "card") {
      const result=runReading(readInput());
      if(cmd==="read")return print(result);
      if(!result.ok){process.stderr.write(JSON.stringify(result)+"\n");return exitCodeFor(result.error.code);}
      process.stdout.write(renderCardHtml(result.result.card));
      return 0;
    }
    if (["save","load","list","delete"].includes(cmd)) {
      if(typeof flags.root!=="string")return print(fail("MISSING_STORE","本地持久化需要 --root 绝对路径。"));
      if(cmd==="save")return print(saveLocal(flags.root,readInput()));
      if(cmd==="list")return print(listLocal(flags.root));
      if(cmd==="load")return print(readLocal(flags.root,flags.kind,flags.id));
      return print(deleteLocal(flags.root,flags.kind,flags.id,{cascadeBazi:flags["cascade-bazi"]===true}));
    }
    process.stdout.write(`${help()}\n`);
    return 1;
  } catch (error) {
    if(error instanceof TimeInputError)return print(fail(error.code,error.message,error.code==="AMBIGUOUS_LOCAL_TIME"?error.details:undefined));
    if(error instanceof SyntaxError)return print(fail("INVALID_JSON","无法读取 JSON，请检查格式。"));
    return print(fail("INVALID_INPUT","读取输入或运行命令失败。请核对文件路径与参数。"));
  }
}

process.exitCode = main();
