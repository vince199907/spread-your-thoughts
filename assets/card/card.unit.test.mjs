import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderThoughtsCard} from './thoughts-card.mjs';

function fixture(){
  const media=new EventTarget();media.matches=false;
  class N extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.ownerDocument=doc;this.parent=null;this.values={};this.style={setProperty:(k,v)=>this.values[k]=v,removeProperty:(k)=>delete this.values[k]};}
    append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}
    setAttribute(k,v){this.attrs[k]=v;}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}
    getBoundingClientRect(){return {left:0,top:0,width:400,height:240};}
    walk(fn){return [this,...this.children.flatMap(n=>n.walk(fn))].filter(fn);}
  }
  const doc={createElement: tag=>new N(tag),createElementNS:(_,tag)=>new N(tag),defaultView:{matchMedia:()=>media},baseURI:'https://localhost/preview'};
  const host=new N('main');
  return {host,media};
}
const sentences=['一句。','二句。','三句。'];
const cls=(node,name)=>node.walk(x=>x.className===name)[0];
const event=(name,attrs={})=>Object.assign(new Event(name),attrs);
test('four skins produce exactly one card, three reading rows, three separate vector layers',()=>{
  const {host}=fixture();const art=new Set();
  for(const skin of ['tarot','iching','astrology','psychology']){
    const {card}=renderThoughtsCard(host,{skin,sentences});
    assert.equal(host.walk(x=>x.tag==='article').length,1);
    assert.equal(card.dataset.skin,skin);
    assert.deepEqual(card.walk(x=>x.tag==='dd').map(x=>x.textContent),sentences);
    assert.equal(card.walk(x=>x.tag==='svg').length,3);
    art.add(JSON.stringify(card.walk(x=>x.tag==='svg').map(x=>x.children.map(x=>x.attrs))));
  }
  assert.equal(art.size,4);
});
test('mouse updates bounded variables only on art; reduced motion and touch are static',()=>{
  const {host,media}=fixture();
  const {card,destroy}=renderThoughtsCard(host,{skin:'tarot',sentences});
  const art=cls(card,'st-art'), dl=cls(card,'st-advice');
  art.dispatchEvent(event('pointermove',{pointerType:'mouse',clientX:470,clientY:-30}));
  assert.deepEqual(art.values,{'--st-x':'1.000','--st-y':'-1.000'});
  assert.deepEqual(dl.values,{});
  media.matches=true;media.dispatchEvent(event('change'));
  assert.deepEqual(art.values,{});
  art.dispatchEvent(event('pointermove',{pointerType:'mouse',clientX:357,clientY:217}));
  assert.deepEqual(art.values,{});
  media.matches=false;
  art.dispatchEvent(event('pointermove',{pointerType:'touch',clientX:357,clientY:217}));
  assert.deepEqual(art.values,{});
  destroy();assert.equal(host.children.length,0);
});
test('hexagram runs bottom-to-top and accessible text records moving line',()=>{
  const {host}=fixture();
  const {card}=renderThoughtsCard(host,{skin:'iching',hexLines:[9,8,8,8,8,8],sentences});
  const layer=card.walk(x=>x.attrs.class==='st-plane st-plane-1')[0];
  assert.equal(layer.walk(x=>x.tag==='rect').length,11);
  assert.deepEqual(layer.walk(x=>x.attrs.r==='3.1').map(x=>x.attrs.cy),['164']);
  assert.equal(cls(card,'st-sr-only').textContent,'六爻，自下而上：老阳（动）、少阴、少阴、少阴、少阴、少阴。');
});
test('links are allowlisted and user copy is text; malformed and sparse arrays fail',()=>{
  const {host}=fixture();const text='<img src=x onerror=alert(1)>';
  const {root}=renderThoughtsCard(host,{skin:'tarot',sentences:{state:text,risk:'a',action:'b'},links:[{href:'javascript:alert(1)',label:'bad'},{href:'https://example.org/',label:'valid'}]});
  assert.equal(root.walk(x=>x.tag==='dd')[0].textContent,text);
  assert.deepEqual(root.walk(x=>x.tag==='img'),[]);
  assert.deepEqual(root.walk(x=>x.tag==='a').map(x=>x.href),['https://example.org/']);
  for(const bad of [[],['1','2'],Array(3),[1,2,3]]) assert.throws(()=>renderThoughtsCard(host,{skin:'tarot',sentences:bad}));
  assert.throws(()=>renderThoughtsCard(host,{skin:'iching',sentences,hexLines:Array(6)}));
});
test('palette CSS meets 4.5:1 text contrast in all cards',()=>{
  const css=fs.readFileSync(new URL('./thoughts-card.css',import.meta.url),'utf8');
  function luminance(hex){
    return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,b,i)=>a+b*[.2126,.7152,.0722][i],0);
  }
  let count=0;
  for(const [,declarations] of css.matchAll(/\.st-card(?:\[data-skin="[^"]+"\])?\s*\{(--st-base:[^}]+)\}/g)){
    const v=Object.fromEntries([...declarations.matchAll(/--st-([\w-]+):#([\da-f]{6});/g)].map(([,k,v])=>[k,v]));
    for(const [a,b] of [['text','level'],['muted','level'],['muted','base']]){
      const [x,y]=[luminance(v[a]),luminance(v[b])];
      assert.ok((Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5,v[a]+'/'+v[b]);count++;
    }
  }
  assert.equal(count,12);
});
