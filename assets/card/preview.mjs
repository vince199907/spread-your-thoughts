import {renderThoughtsCard} from './thoughts-card.mjs';

const examples={
  tarot:{title:'在回答之前',subject:'隐士 · 正位',cardMotif:'lantern',sentences:['你说今晚还没想好怎样回复那条消息。','如果现在匆忙发送，真正想问的事可能没说清。','先写下一句最想问的话，明早再决定要不要发。'],details:['虚构的单牌示例：隐士正位。','建议依据是对话里提到的消息，不是牌面。']},
  iching:{title:'先走一小步',subject:'地雷复 · 自下而上',hexLines:[9,8,8,8,8,8],sentences:['你说这周想恢复写作，却一直没定从哪里开始。','一开始就计划写完一整篇，可能让开始变得更难。','今天先打开旧稿，补写一个句子。'],details:['虚构铜钱记录（自下而上）：9、8、8、8、8、8。','朱色小点是动爻位置；图像不用于预测。']},
  astrology:{title:'留一点余地',subject:'太阳星座阅读',sentences:['你说这几天把每天的空档都排上了事。','如果没有缓冲，一件临时的事就可能打乱整天安排。','明天挑一个半小时，不提前给它安排任务。'],details:['示意星图并非实测天体位置。','本示例未请求出生资料，也未计算个人星盘。']},
  psychology:{title:'分开今天与平时',subject:'对话辅助 · 近期观察',sentences:['你说临近交付时会反复确认，但平时未必如此。','如果确认占了休息时间，晚上可能更难收工。','今晚只确认一次截止时间，把下一次查看留给明早。'],details:['虚构近期自述，不外推为长期人格。','本示例没有用户确认的量尺作答。']},
};
const host=document.querySelector('#card');
const buttons=[...document.querySelectorAll('button[data-skin]')];
function select(skin){
  for(const btn of buttons)btn.setAttribute('aria-pressed',String(btn.dataset.skin===skin));
  renderThoughtsCard(host,{skin,...examples[skin]});
}
for(const btn of buttons)btn.addEventListener('click',()=>select(btn.dataset.skin));
select('tarot');
