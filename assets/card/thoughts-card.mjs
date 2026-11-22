const skins = {
  tarot: ['塔罗', 'I', '象征阅读，不作预测'],
  iching: ['易经', 'II', '卦象用于反思，不作预测'],
  astrology: ['星座', 'III', '象征阅读，不作预测'],
  psychology: ['心理', 'IV', '自我探索，非诊断或正式测量'],
};
const labels = ['当前状态', '风险', '行动'];
const ns = 'http://www.w3.org/2000/svg';
const box = '0 0 400 240';

function element(doc, tag, className, content) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (content != null) el.textContent = content;
  return el;
}
function mark(doc, tag, attrs) {
  const el = doc.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}
const path = (d, a = {}) => ['path', {d, ...a}];
const circle = (cx, cy, r, a = {}) => ['circle', {cx, cy, r, ...a}];
const rect = (x, y, width, height, a = {}) => ['rect', {x, y, width, height, ...a}];
const line = (x1, y1, x2, y2, a = {}) => ['line', {x1,y1,x2,y2,...a}];
const ink = 'var(--st-ink)', mist = 'var(--st-mist)', wash = 'var(--st-wash)', accent = 'var(--st-accent)';
const outline = {fill:'none',stroke:ink,'stroke-width':1};
const hairline = {...outline,opacity:.42};
const grain = Array.from({length:68}, (_,i)=> {
  const x=(i*67+11)%400, y=(i*109+23)%240;
  return line(x,y,x+4+(i%9),y+(i%3)-1,{stroke:ink,opacity:.07,'stroke-width':.7});
});
const stars = [[31,91],[67,43],[102,132],[113,68],[147,45],[172,99],[191,47],[220,71],[244,40],[267,62],[280,136],[302,93],[340,43],[356,67],[374,131],[328,153]];
const starMap = stars.map(([x,y],i)=>circle(x,y,i%5===0?1.5:.75,{fill:ink,opacity:.25+(i%4)*.13}));

const tarotMotifs = {
  lantern: [
    path('M161 176c11-14 15-32 18-53 2-17 13-34 26-34 13 0 19 16 21 35l7 42 14 10H161Z',{fill:wash,stroke:ink}),
    path('M182 125c6-25 16-36 29-34 10 2 16 11 16 27l-14 1-7-15-7 16-17 5Z',outline),
    path('M219 127l24 10 20-11M241 139v29M165 177l17-72',outline),
    rect(255,121,16,17,{rx:2,fill:accent,stroke:ink}),
    line(252,139,274,139,{stroke:ink}),circle(263,129,17,{...hairline,stroke:accent}),
  ],
  star: [
    path('M200 53l7 24 24 7-24 7-7 25-7-25-24-7 24-7Z',{fill:accent,stroke:ink}),
    path('M169 126c10 10 19 11 31 0 11-10 22-10 32 0M151 145c13 8 24 9 39 0 15-9 27-10 40-1 13 9 21 9 33 1M145 165c20 10 29 10 49 0 15-8 24-8 38 0 17 8 25 9 38 1',outline),
  ],
  moon: [
    path('M219 63c-44-5-62 41-30 64 20 13 44 5 52-12-36 10-53-28-22-52Z',{fill:accent,stroke:ink}),
    path('M120 161l35-39 39 46 42-12 44-33 26 37M143 179q30-14 52-6t61-3',outline),
  ],
  sun: [circle(200,104,29,{fill:accent,stroke:ink}), ...Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return line(200+35*Math.cos(a),104+35*Math.sin(a),200+44*Math.cos(a),104+44*Math.sin(a),{stroke:ink});}),path('M111 163q43 27 89 2t89 0M116 183q46 23 88 0t82 1',outline)],
  cup:[path('M167 92h66q-1 37-27 43v24h18v6h-48v-6h18v-24q-26-6-27-43Z',{fill:wash,stroke:ink,'stroke-width':1.8}),path('M174 103q26 10 52 0',outline)],
  wand:[path('M176 166l48-89 6 4-47 90Z',{fill:accent,stroke:ink}),path('M220 95q-19-19-36-12 5 20 29 24M216 115q22-11 34 1-12 17-35 9',outline)],
  sword:[path('M200 68l10 23-6 49h-8l-6-49ZM188 140h24v7h-9v17h-6v-17h-9Z',{fill:wash,stroke:ink,'stroke-width':1.5})],
  coin:[circle(200,114,34,{fill:wash,stroke:ink}),circle(200,114,27,outline),path('M200 91l7 15 16 3-12 11 3 17-14-9-14 9 3-17-12-11 16-3Z',{fill:accent,stroke:ink})],
  abstract:[path('M200 70l50 50-50 50-50-50Z',outline),circle(200,120,38,hairline),circle(200,120,15,{fill:accent}),path('M156 120h88M200 76v88',hairline)],
};

function layers(model) {
  if (model.skin==='tarot') {
    const motif = Object.hasOwn(tarotMotifs,model.cardMotif) ? tarotMotifs[model.cardMotif] : tarotMotifs.abstract;
    return [
      [rect(0,0,400,240,{fill:mist,opacity:.14}),...starMap,
        path('M-9 192C62 180 83 143 119 146s58 46 93 31 53-35 83-34 63 29 113 49V250H-9Z',{fill:wash,opacity:.48})],
      [path('M115 199V117a85 85 0 1 1 170 0v82M124 199v-81a76 76 0 0 1 152 0v81',hairline),
        path('M112 202h176M25 191h50m250 0h50',hairline), ...motif],
      [rect(14,14,372,212,{fill:'none',stroke:ink,opacity:.56}),rect(19,19,362,202,{fill:'none',stroke:ink,opacity:.18}),
       ...[27,373].flatMap(x=>[circle(x,27,2,{fill:ink}),circle(x,212,2,{fill:ink})])],
    ];
  }
  if (model.skin==='iching') {
    const rows = (model.hexLines || []).slice().reverse().flatMap((value,i)=>{
      const y=66+i*19, a={rx:2,fill:ink,opacity:.86};
      const marks=value%2 ? [rect(144,y,112,6,a)] : [rect(144,y,47,6,a),rect(209,y,47,6,a)];
      if(value===6||value===9) marks.push(circle(272,y+3,3.1,{fill:accent}));
      return marks;
    });
    return [
      [...grain,path('M-8 180 Q43 157 76 175 T145 197 Q224 228 296 177 T408 175 L408 250H-8Z',{fill:wash,opacity:.4}),
       path('M-10 202 Q37 185 87 198T181 217Q247 220 287 204T414 194',{...hairline,opacity:.2})],
      [circle(200,117,82,{fill:mist,opacity:.35}),circle(200,117,78,{...hairline,opacity:.24}), 
       ...rows, ...(rows.length?[]:[path('M173 117h54M200 90v54',{...outline,opacity:.28})])],
      [rect(17,17,366,206,{fill:'none',stroke:ink,opacity:.23}),
        path('M17 33v-16h16m334 0h16v16m0 174v16h-16m-334 0H17v-16',outline),
        rect(346,184,18,18,{fill:'none',stroke:accent,opacity:.7}),
        path('M350 188h10m-10 5h9m-9 5h10m-7-10v10m4-10v10',{fill:'none',stroke:accent,opacity:.7})],
    ];
  }
  if(model.skin==='astrology') {
    const points = [[102,151],[140,117],[170,136],[206,81],[239,93],[273,61],[300,111]];
    const contour=points.map(p=>p.join(',')).join(' ');
    return [
      [...stars.slice(0,12).map(([x,y],i)=>circle(x,y,i%5===0?1.5:.75,{fill:ink,opacity:.26+i%3*.1})),
       path('M-5 191c79-46 108 31 200 11 45-10 94-66 213-37v83H0Z',{fill:wash,opacity:.31})],
      [circle(200,117,89,{...hairline,opacity:.28}),circle(200,117,74,{...hairline,opacity:.18,'stroke-dasharray':'1 4'}),
        ['polyline',{points:contour,...outline,opacity:.64}], ...points.map(([x,y],i)=>circle(x,y,i===3?3.1:2.2,{fill:i===3?accent:ink})),
        path('M59 181h20m242 0h20',hairline)],
      [rect(17,17,366,206,{fill:'none',stroke:ink,opacity:.24}),
        ...[27,373].flatMap(x=>[circle(x,27,1.6,{fill:ink}),circle(x,212,1.6,{fill:ink})])],
    ];
  }
  return [
    [...grain,path('M22 155 C62 106 121 135 157 173S147 210 104 213 40 202 22 155Z',{fill:wash,opacity:.42})],
    [path('M129 84Q145 55 197 51l4 126-79-20Z',{fill:mist,stroke:ink,'stroke-width':.8}),
     path('M199 73l77-18 30 99-83 38Z',{fill:wash,stroke:ink,'stroke-width':.8}),
     path('M179 142q31-17 55-4 19 11 52-4l-6 32-89 33Z',{fill:accent,opacity:.46}),
     path('M144 128q17-26 38-21 29 8 42 4t44-22M157 146q14-16 36-13 30 5 68-21',hairline),
     circle(245,102,14,{fill:'none',stroke:ink,opacity:.3})],
    [rect(17,17,366,206,{fill:'none',stroke:ink,opacity:.25}),
     path('M32 35h16m-8-8v16m312 154h16m-8-8v16',hairline)],
  ];
}

function validate(input) {
  if (!input || !Object.hasOwn(skins,input.skin)) throw new TypeError('未知卡片皮肤');
  const {sentences} = input;
  const three = Array.isArray(sentences) ? [...sentences] : [sentences?.state, sentences?.risk, sentences?.action];
  if (three.length!==3 || three.some(x=>typeof x!=='string'||!x.trim())) throw new TypeError('卡片需要状态、风险、行动共三条非空文字');
  if (input.hexLines != null && (!Array.isArray(input.hexLines)||input.hexLines.length!==6||[...input.hexLines].some(x=>!Number.isInteger(x)||x<6||x>9))) throw new TypeError('卦爻须是六个 6–9 整数，自下而上');
  return three;
}
function artOf(doc, model) {
  const art=element(doc,'div','st-art');
  art.setAttribute('aria-hidden','true');
  layers(model).forEach((entries,i)=>{
    const layer=mark(doc,'svg',{class:'st-plane st-plane-'+i,viewBox:box,preserveAspectRatio:'xMidYMid meet',focusable:'false'});
    for(const [tag,attrs] of entries) layer.append(mark(doc,tag,attrs));
    art.append(layer);
  });
  art.append(element(doc,'div','st-foil'));
  return art;
}
function addMotion(art, mode) {
  const media=art.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reset=()=>{
    art.style.removeProperty('--st-x');
    art.style.removeProperty('--st-y');
    delete art.dataset.moving;
  };
  if (mode===false) return reset;
  const update=(e)=>{
    if (media?.matches || e.pointerType==='touch') return;
    const r=art.getBoundingClientRect();
    if(!r.width||!r.height) return;
    const clamp=x=>Math.max(-1,Math.min(1,x));
    art.style.setProperty('--st-x',clamp((e.clientX-r.left)/r.width*2-1).toFixed(3));
    art.style.setProperty('--st-y',clamp((e.clientY-r.top)/r.height*2-1).toFixed(3));
    art.dataset.moving='1';
  };
  art.addEventListener('pointermove',update,{passive:true});
  art.addEventListener('pointerleave',reset);
  art.addEventListener('pointercancel',reset);
  media?.addEventListener?.('change',reset);
  return ()=>{
    art.removeEventListener('pointermove',update);
    art.removeEventListener('pointerleave',reset);
    art.removeEventListener('pointercancel',reset);
    media?.removeEventListener?.('change',reset);
    reset();
  };
}
const mounted = new WeakMap();
function safeLink(value, doc) {
  if(typeof value!=='string' || !value.trim() || /^[\\/]{2}|[\u0000-\u001f]/.test(value.trim())) return null;
  try {
    const url=new URL(value,doc.baseURI);
    return ['https:','http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

/** Mount one offline result card. No persistence, effects outside the illustrations, or hidden network requests. */
export function renderThoughtsCard(host, model, {motion=true}={}) {
  if(!host?.ownerDocument || !host.replaceChildren) throw new TypeError('需要 DOM 容器');
  const three=validate(model);
  const doc=host.ownerDocument;
  const [pillar, folio, boundary]=skins[model.skin];
  const article=element(doc,'article','st-card');
  article.dataset.skin=model.skin;
  const head=element(doc,'header','st-head');
  const ribbon=element(doc,'p','st-kicker');
  ribbon.append(element(doc,'span',null,'把心事摊开看'),element(doc,'span',null,'卷 '+folio+' / '+pillar));
  head.append(ribbon,element(doc,'h2','st-title',model.title||pillar+' · 一页札记'));
  const figure=element(doc,'figure','st-figure');
  const art=artOf(doc,model);
  figure.append(art);
  if(model.subject || model.skin==='astrology' || (model.skin==='iching' && model.hexLines)) {
    const caption=[model.subject,model.skin==='astrology'?'星图为示意':null].filter(Boolean).join(' · ');
    const summary=element(doc,'figcaption','st-caption',caption);
    if(model.skin==='iching' && model.hexLines) {
      const names={6:'老阴（动）',7:'少阳',8:'少阴',9:'老阳（动）'};
      summary.append(element(doc,'span','st-sr-only','六爻，自下而上：'+model.hexLines.map(x=>names[x]).join('、')+'。'));
    }
    figure.append(summary);
  }
  const advice=element(doc,'dl','st-advice');
  for(let i=0;i<3;i++){
    const row=element(doc,'div','st-row');
    row.append(element(doc,'dt',null,labels[i]),element(doc,'dd',null,three[i]));
    advice.append(row);
  }
  article.append(head,figure,advice,element(doc,'p','st-boundary',model.boundary||boundary));
  const root=element(doc,'div','st-result');
  root.append(article);
  if(Array.isArray(model.details) && model.details.some(x=>typeof x==='string'&&x.trim())){
    const details=element(doc,'details','st-details');
    details.append(element(doc,'summary',null,'展开推导与依据'));
    const list=element(doc,'ul');
    for(const item of model.details.filter(x=>typeof x==='string'&&x.trim())) list.append(element(doc,'li',null,item));
    details.append(list);root.append(details);
  }
  const links=Array.isArray(model.links) ? model.links.flatMap(x=>{
    const href=safeLink(x?.href,doc);
    if(!href||typeof x?.label!=='string'||!x.label.trim()) return [];
    const a=element(doc,'a',null,x.label);
    a.href=href;a.rel='noreferrer noopener';
    return [a];
  }) : [];
  if(links.length){
    const nav=element(doc,'nav','st-links');
    nav.setAttribute('aria-label','知识链接（编辑关联）');
    nav.append(element(doc,'p',null,'延伸阅读 · 编辑关联'),...links);
    root.append(nav);
  }
  mounted.get(host)?.();
  const detach=addMotion(art,motion);
  const destroy=()=>{
    detach();
    root.remove();
    if(mounted.get(host)===destroy) mounted.delete(host);
  };
  host.replaceChildren(root);
  mounted.set(host,destroy);
  return {root,card:article,destroy};
}
