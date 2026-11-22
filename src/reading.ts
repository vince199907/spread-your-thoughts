import { randomBytes } from "node:crypto";
import { computeBazi } from "./bazi.js";
import { castFromCoins, castFromLines, castFromSeed } from "./coin.js";
import { runIchingshifa } from "./ichingshifa.js";
import { ASTROLOGY_VERSION, calculateAstrology } from "./astrology_adapter.js";
import { TIME_RULES_VERSION, TimeInputError } from "./timezone.js";
import { readTarot } from "./tarot.js";
import { summarizePsychology } from "./psychology.js";
import { composeGroundedAdvice, hasCrisisSignal } from "./grounded-advice.js";
import { scoreConfirmedItems } from "./confirmed-item-scoring.js";
import { validateDocument } from "./protocol.js";
import { fail, ok, type Result } from "./result.js";

type Pillar="tarot"|"iching"|"astrology"|"psychology";
type Status="ok"|"partial"|"unknown"|"not_requested"|"safety_support";
type Obj=Record<string,unknown>;
type ErrorData={code:string;message:string;details?:Obj};
type Three={state:string;risk:string;action:string};
interface ReadingInput {pillar:Pillar;topic?:string;birth?:Obj;symbol?:Obj;conversation?:Obj;profile?:Obj;responses?:unknown[]}
export interface CardModel {
  skin:Pillar; title:string; subject?:string; hexLines?:number[]; cardMotif?:string;
  sentences:Three; details:string[]; links:{label:string;href:string}[]; boundary?:string;
}
export interface Reading {
  pillar:Pillar; calculation_status:Status; missing_inputs:string[];
  facts:{symbolic:Obj|null;bazi:Obj|null;psychology:Obj|null;confirmed_items:Obj|null};
  core_view:string; explanation:string[]; actions:string[]; reading_links:string[];
  evidence_ids:string[]; three_sentences:Three;
  source_versions:Record<string,string>;trace:Obj; errors:ErrorData[];card:CardModel;
}
const themes:Record<Pillar,{title:string;label:string;href:string}> = {
  tarot:{title:"桌边的一张牌",label:"牌义与牌阵（象征素材）",href:"https://github.com/daman-ovo-0404/tarot-skill"},
  iching:{title:"纸上有变",label:"卦爻规则（独立于三钱法）",href:"https://github.com/kentang2017/ichingshifa"},
  astrology:{title:"夜里的星图",label:"天文计算来源（不验证解读）",href:"https://github.com/cosinekitty/astronomy"},
  psychology:{title:"给此刻留一页",label:"Mini-IPIP 项目与计分键",href:"https://ipip.ori.org/MiniIPIPKey.htm"},
};
const record=(value:unknown):Obj|null=>value && typeof value==="object" && !Array.isArray(value)?value as Obj:null;
const str=(value:unknown):string|undefined=>typeof value==="string"&&value.length>0?value:undefined;
const roll=()=>randomBytes(4).readUInt32BE(0);
const bookNote="象征阅读仅供反思，不能证明心理倾向或预测。";
const psychNote="对话画像是证据有限的探索，不是临床诊断、官方 MBTI 或中文量表常模。";

export function runReading(raw:unknown):Result<Reading>{
  const invalid=validateDocument("input",raw); if(invalid)return invalid;
  const input=raw as ReadingInput;
  const supplied=input.conversation??{observations:[]};
  const profileQuotes = [input.profile?.utterances,input.profile?.evidence].flatMap(list =>
    Array.isArray(list) ? list.flatMap((e,i)=>{
      const row=record(e);const text=typeof e==="string"?e:str(row?.text)??str(row?.quote);
      return text?[{text,id:str(row?.id)??str(row?.quoteId)??"profile-"+(i+1)}]:[];
    }) : []);
  const critical=[...(input.topic?[{text:input.topic,id:"topic"}]:[]),...profileQuotes].find(q=>hasCrisisSignal(q.text));
  // Already detected: do not truncate the source and run the safety check a second time.
  const safetyId=critical?.id && /^[\p{L}\p{N}_:.\-]{1,64}$/u.test(critical.id)?critical.id:"input-safety";
  const proposed=critical?ok({mode:"safety-support" as const,evidence_ids:[safetyId],three_sentences:{
    state:"你提到了可能伤害自己或他人的想法，现在先关注安全。",
    risk:"此刻独自应对可能不安全，先不做占卜或人格判断。",
    action:"请现在联系可信的人陪伴；如果有眼前的危险，立即拨打当地急救或报警电话。",
  }}):composeGroundedAdvice(supplied);
  if(!proposed.ok)return proposed;
  const advice=proposed.result;
  const urgent=advice.mode==="safety-support";
  const theme=themes[input.pillar];
  const out:Reading={
    pillar:input.pillar,calculation_status:urgent?"safety_support":"not_requested",missing_inputs:[],
    facts:{symbolic:null,bazi:null,psychology:null,confirmed_items:null}, core_view:advice.three_sentences.state,
    explanation:urgent?["先处理安全与现实支持；本次不运行占卜、画像或量表。"]:[input.pillar==="psychology"?psychNote:bookNote],
    actions:[advice.three_sentences.action],reading_links:urgent?[]:[theme.href],evidence_ids:advice.evidence_ids,
    three_sentences:advice.three_sentences,
    source_versions:{skill:"spread-your-thoughts-v1",advice:"grounded-three-v1"},
    trace:{advice_mode:advice.mode,model:"deterministic-local-no-model",raw_inputs_saved:false},
    errors:[],card:{skin:urgent?"psychology":input.pillar,title:urgent?"先照顾当下":input.topic??theme.title,
      sentences:advice.three_sentences,details:[],links:urgent?[]:[{label:theme.label,href:theme.href}],
      ...(urgent?{boundary:"此卡不提供占卜或诊断。"}:{})},
  };
  let requested=0, succeeded=0;
  const err=(code:string,message:string,details?:Obj)=>out.errors.push({code,message,...(details?{details}:{})});
  const run=(key:keyof Reading["facts"],attempt:()=>Result<unknown>)=>{
    requested++;
    try {
      const result=attempt();
      if(!result.ok){err(result.error.code,result.error.message,result.error.details);return;}
      const item=record(result.result);
      if(!item){err("INVALID_ENGINE_SNAPSHOT","所选模块没有返回有效对象。");return;}
      succeeded++;
      out.facts[key]=item;
    } catch(e) {
      if(e instanceof TimeInputError)err(e.code,e.message,e.code==="AMBIGUOUS_LOCAL_TIME"?e.details:undefined);
      else err("ENGINE_FAILED","所选模块运行失败，没有用猜测补出结果。");
    }
  };
  const miss=(x:string)=>{if(!out.missing_inputs.includes(x))out.missing_inputs.push(x);};
  if(!urgent){
    if(input.birth){
      if (!input.birth.timezone) miss("birth.timezone");
      else run("bazi",()=>computeBazi(input.birth));
      const bazi=out.facts.bazi;
      if(bazi){
        const p=record(bazi.provenance);
        out.source_versions.bazi=str(p?.ruleVersion)??"bazi-zoned-v2";out.source_versions.lunar="1.7.8";
        if(p?.hourKnown===false)miss("birth.time");
        const slots=record(bazi.pillars);
        const labels=["年","月","日","时"];
        const summary=["year","month","day","hour"].map((k,i)=>labels[i]+"柱："+(str(record(record(slots?.[k])?.value)?.ganZhi)??"未定"));
        out.explanation.push(summary.join("；")+"。八字是命理轨，不进入心理证据。");
      }
    }
    if(input.pillar==="psychology"||input.profile){
      const conversation=Array.isArray(input.conversation?.observations)?input.conversation.observations:[];
      const inherited=conversation.flatMap(e=>{
        const q=record(e);
        // The legacy raw matcher does not carry structured period or counterexample edges.
        // Pass only uncontradicted long-term statements, and only when exact source context exists.
        const text=str(q?.quote);
        if(q?.period!=="long_term"||!text||Array.isArray(q.counterEvidence)&&q.counterEvidence.length)return [];
        const contradicted=conversation.some(x=>{const r=record(x);return Array.isArray(r?.counterEvidence)&&r.counterEvidence.includes(q.id);});
        return contradicted?[]:[{id:q.id,text}];
      });
      const profile=input.profile??{};
      run("psychology",()=>summarizePsychology("evidence" in profile || "utterances" in profile ? profile : {...profile,utterances:inherited}));
      if(out.facts.psychology){out.source_versions.profile="mini-ipip-reference/legacy-offline";out.explanation.push("未见长期行为及反例的项目保持未知；聊天确认不等于给量表选档。");}
    }
    if(input.responses){
      run("confirmed_items",()=>scoreConfirmedItems({responses:input.responses}));
      if(out.facts.confirmed_items){out.source_versions.ipip="mini-ipip-en-1-5-v1";out.explanation.push("量尺仅记录本人明确选档；未答项目不补值。");}
    }
    const s=input.symbol;const method=s?.method;
    if(s){
      if((input.pillar==="tarot"&&method!=="tarot") || (input.pillar==="iching"&&method!=="coin"&&method!=="yarrow") ||
         (input.pillar==="astrology"&&method!=="astrology") || input.pillar==="psychology"){
        return fail("PILLAR_METHOD_MISMATCH","入口与计算方法不一致，请选择对应的方法。");
      }
      if (method==="tarot") {
        if(s.cards&&s.seed!==undefined)return fail("AMBIGUOUS_INPUT","实体录牌与随机种子只能选一个。");
        run("symbolic",()=>readTarot({spread:(s.spread??"single") as "single"|"three",seed:s.cards?undefined:(s.seed as number|undefined)??roll(),
          cards:s.cards,reversals:s.reversals as boolean|undefined}));
        const t=out.facts.symbolic;
        if(t){
          const cards=Array.isArray(t.cards)?t.cards.map(record).filter(Boolean):[];
          const captions=cards.map(c=>{
            const name = str(c?.name)??str(c?.nameZh)??str(record(c?.card)?.name)??str(c?.id);
            return name ? name+(c?.orientation==="reversed"?"（逆位）":"（正位）") : null;
          }).filter(Boolean);
          if(captions.length){out.card.subject=captions.join(" · ");out.explanation.push("抽牌次序："+captions.join("、")+"。");}
          for(const c of cards){const question=str(c?.symbolicPrompt);if(question)out.explanation.push((str(c?.nameZh)??"牌面")+" · 象征提问："+question);}
          const key=str(cards[0]?.id)??str(record(cards[0]?.card)?.id)??"";
          const motif:Record<string,string>={"tarot-09":"lantern","tarot-17":"star","tarot-18":"moon","tarot-19":"sun"};
          out.card.cardMotif=motif[key]??(/cups?|圣杯/i.test(key)?"cup":/wands?|权杖/i.test(key)?"wand":/swords?|宝剑/i.test(key)?"sword":/pentacles?|coins?|星币/i.test(key)?"coin":"abstract");
          out.source_versions.tarot="rws-78-v1";
        }
      } else if(method==="coin") {
        const n=[s.lines,s.coins,s.seed].filter(x=>x!==undefined).length;
        if(n>1)return fail("AMBIGUOUS_INPUT","爻值、钱面和随机种子只能选一个。");
        run("symbolic",()=>Array.isArray(s.lines)?castFromLines(s.lines):Array.isArray(s.coins)?castFromCoins(s.coins):castFromSeed((s.seed as number|undefined)??roll()));
        const c=out.facts.symbolic;
        if(c){
          const base=record(c.primary),changed=record(c.changed);
          const lines=Array.isArray(c.lines)?c.lines.map(a=>record(a)?.value).filter((v):v is number=>typeof v==="number"):[];
          if(lines.length===6)out.card.hexLines=lines;
          const title=str(base?.name),cname=str(changed?.name);
          out.card.subject=title?(title+(cname?" → "+cname:"")):undefined;
          out.explanation.push("三枚钱、六爻自下而上；6/9 动，7/8 不动。"+(out.card.subject??""));
          out.source_versions.iching=str(c.ruleVersion)??"coin-bottom-up-v1";
        }
      } else if(method==="yarrow") {
        if(s.lines&&s.seed!==undefined)return fail("AMBIGUOUS_INPUT","实体爻值与随机种子只能选一个。");
        run("symbolic",()=>runIchingshifa(Array.isArray(s.lines)?s.lines.join(""):{seed:(s.seed as number|undefined)??roll()}));
        const y=out.facts.symbolic;
        if(y){
          out.card.subject=[str(y.primaryName),str(y.changedName)].filter(Boolean).join(" → ")||undefined;
          if(typeof y.inputBottomUp==="string"&&/^[6789]{6}$/.test(y.inputBottomUp))out.card.hexLines=[...y.inputBottomUp].map(Number);
          out.explanation.push("ichingshifa 解读蓍草爻序；与三钱独立。"+(out.card.subject??""));
          out.source_versions.ichingshifa=str(y.packageVersion)??"未报告";
        }
      } else if(method==="astrology") {
        const {method: _ignored,...fields}=s;
        run("symbolic",()=>ok(calculateAstrology(fields)));
        const a=out.facts.symbolic;
        if(a){
          const sf=record(record(a.facts)?.sun);
          const choices=Array.isArray(sf?.possible_signs)?sf.possible_signs.filter(x=>typeof x==="string"):[];
          out.card.subject=str(sf?.sign)??(choices.length?"太阳候选："+choices.join("／"):undefined);
          if(Array.isArray(a.missing_inputs))for(const field of a.missing_inputs)if(typeof field==="string")miss("astrology."+field);
          if(a.calculation_status==="partial"||a.calculation_status==="unknown")out.calculation_status=a.calculation_status;
          out.explanation.push("地心热带黄道位置，不含上升、宫位或相位。"+(out.card.subject??""));
          out.source_versions.astronomy=ASTROLOGY_VERSION;out.source_versions.timezone=TIME_RULES_VERSION;
        }
      }
    } else if(input.pillar!=="psychology")miss("symbol");
    if(out.calculation_status==="unknown" && succeeded>1)out.calculation_status="partial";
    if(out.calculation_status==="not_requested"){
      if(out.errors.length||out.missing_inputs.length)out.calculation_status=succeeded?"partial":"unknown";
      else if(requested>0)out.calculation_status=succeeded?"ok":"unknown";
    }
    if(out.errors.length)out.explanation.push(...out.errors.slice(0,5).map(e=>"未生成替代结果："+e.message.slice(0,400)));
    if(out.missing_inputs.length)out.explanation.push("尚缺："+out.missing_inputs.join("、")+"。");
  }
  out.card.details=[...out.explanation, "建议依据："+(out.evidence_ids.length?out.evidence_ids.join("、"):"没有可引用的对话证据。")];
  const checked=validateDocument("result",out);if(checked)return checked;
  if(out.card.sentences!==out.three_sentences || out.card.skin!==(urgent?"psychology":out.pillar))return fail("INVALID_RESULT","卡片未与计算或忠告结果对应。");
  return ok(out);
}
