import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../frontend/js/finance-chart.js',import.meta.url),'utf8');
const {quoteSnapshot,sessionProgress,thinTimedPoints,smoothTimedPoints,buildFinanceChart}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const cn={timeZone:'Asia/Shanghai',ranges:[[570,690],[780,900]]};
const us={timeZone:'America/New_York',ranges:[[570,960]]};
const fx={timeZone:'UTC',ranges:[[0,1440]]};
const hk={timeZone:'Asia/Hong_Kong',ranges:[[570,720],[780,960]],closingAuctionEnd:970};
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
for(const [time,fraction] of [['09:30',0],['10:30',.25],['11:30',.5],['12:00',.5],['13:00',.5],['14:00',.75],['15:00',1]])near(sessionProgress(time,cn),fraction);
near(sessionProgress('10:30',us),60/390);near(sessionProgress('15:59',us),389/390);near(sessionProgress('16:00',us),1);
near(sessionProgress('06:00',fx),.25);near(sessionProgress('23:59',fx),1439/1440);near(sessionProgress('24:00',fx),1);
near(sessionProgress('16:08',hk),1);assert.equal(sessionProgress('16:11',hk),null);assert.equal(sessionProgress('16:08',us),null);
assert.equal(sessionProgress('09:20',cn),null);assert.equal(sessionProgress('15:01',cn),null);
for(const session of [null,{}, {ranges:[[570,900]]},{timeZone:'X',ranges:[[900,570]]},{timeZone:'X',ranges:[[570,700],[690,900]]},{...cn,closingAuctionEnd:899}])assert.equal(sessionProgress('10:30',session),null);
for(const time of ['',null,'2026-10-29 10:30','10:60','25:00'])assert.equal(sessionProgress(time,cn),null);

const late=[{t:'09:45',p:99},{t:'10:30',p:101}];
const partial=buildFinanceChart(late,100,cn,241,64);near(partial.points[0].x,15);near(partial.points.at(-1).x,60);
const sparse=buildFinanceChart([{t:'09:30',p:99},{t:'10:00',p:100},{t:'14:00',p:101}],100,cn,241,64);
assert.deepEqual(sparse.points.map(p=>p.x),[0,30,180]);
const single=buildFinanceChart([{t:'11:00',p:101}],100,cn,241,64);near(single.points[0].x,90);assert.equal(single.points.length,1);
const afterAuction=buildFinanceChart([{t:'09:30',p:99},{t:'16:00',p:99},{t:'16:08',p:101}],100,hk,241,64);
near(afterAuction.points.at(-1).x,240);assert.equal(afterAuction.points.at(-1).p,101);assert.equal(afterAuction.quote.direction,'up');

const dense=Array.from({length:241},(_,i)=>{const minute=i<=120?570+i:780+i-120;return {t:String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'),p:i===240?101:99}});
const thinned=thinTimedPoints(dense,60);assert.equal(thinned.length,60);assert.strictEqual(thinned[0],dense[0]);assert.strictEqual(thinned.at(-1),dense.at(-1));
const smooth=smoothTimedPoints(thinned);assert.strictEqual(smooth[0],dense[0]);assert.strictEqual(smooth.at(-1),dense.at(-1));assert.deepEqual(smooth.map(p=>p.t),thinned.map(p=>p.t));
const reversal=buildFinanceChart(dense,100,cn,60,64);assert.equal(reversal.quote.direction,'up');assert.equal(reversal.quote.last,101);near(reversal.quote.pct,1);assert.equal(reversal.points.at(-1).p,101);near(reversal.points.at(-1).x,59);near(reversal.points.at(-1).y,4);
const neutral=buildFinanceChart(late,0,cn,241,64);assert.equal(neutral.quote.pct,null);assert.equal(neutral.quote.direction,null);assert.equal(neutral.quote.last,101);assert.equal(neutral.baselineY,null);
for(const price of [NaN,Infinity,-1,0,null,'101']){const invalid=buildFinanceChart([{t:'09:30',p:99},{t:'10:30',p:price}],100,cn,241,64);assert.equal(invalid.quote.last,null);assert.equal(invalid.quote.pct,null);assert.equal(invalid.points.length,0);}
for(const [points,session] of [[late,null],[[{p:101}],cn],[[{t:'09:30',p:99},{p:101}],cn],[[{t:'10:30',p:99},{t:'09:30',p:101}],cn],[[{t:'15:01',p:101}],cn]]){const old=buildFinanceChart(points,100,session,241,64);assert.equal(old.points.length,0);assert.equal(old.quote.last,101);}
assert.equal(quoteSnapshot([{p:1e308}],1e-308).pct,null);
console.log('✓ Finance chart: exchange minutes, lunch compression, sparse/late/single-point data, US/FX/HK auction bounds, preserved endpoints, raw-price direction, invalid/legacy fallback');
