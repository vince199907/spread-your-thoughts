import {readFileSync,writeFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const card=read('thoughts-card.mjs').replace('export function renderThoughtsCard','function renderThoughtsCard');
const demo=read('preview.mjs').replace(/^import[^\n]*\n/,'');
const html=read('preview.html')
 .replace('<link rel="stylesheet" href="./thoughts-card.css">','<style>\n'+read('thoughts-card.css')+'\n</style>')
 .replace('<script type="module" src="./preview.mjs"></script>','<script type="module">\n'+card+'\n'+demo+'\n</script>');
writeFileSync(new URL('card-preview-offline.html',import.meta.url),html);
