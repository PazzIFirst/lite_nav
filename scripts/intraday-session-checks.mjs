// Run: node --experimental-vm-modules scripts/intraday-session-checks.mjs
// Real adapter code, fixed clock and in-memory upstream/cache fixtures; no external requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
let now=Date.parse('2026-06-15T02:30:00Z');
class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
let cached=null,yahooFixture={},emFixture={},txFixture={},failYahoo=false;
const requests=[],writes=[];
const context=vm.createContext({Date:Clock,Intl,URL,Buffer,console});
const bindings={
 '../redis.js':{readThreeState:async()=>cached,writeBoth:async(key,payload,ttl)=>writes.push({key,payload,ttl})},
 '../fetcher.js':{
  fetchT:async url=>{requests.push(url);if(failYahoo&&url.includes('finance.yahoo'))throw new Error('offline');return {url};},
  readJsonLimited:async({url})=>url.includes('finance.yahoo')?yahooFixture:url.includes('eastmoney')?emFixture:url.includes('/minute/query')?txFixture:{},
  readBufferLimited:async()=>Buffer.from(''),
 },
};
const module=new vm.SourceTextModule(readFileSync(new URL('../backend/src/sources/chart.js',import.meta.url),'utf8'),{context});
await module.link(specifier=>{
 const values=bindings[specifier];assert(values,specifier);
 return new vm.SyntheticModule(Object.keys(values),function(){for(const [name,value]of Object.entries(values))this.setExport(name,value);},{context});
});
await module.evaluate();
const {getTradingSession,getIntraday,isMarketOpen}=module.namespace;
const plain=value=>JSON.parse(JSON.stringify(value));
const epoch=value=>Date.parse(value)/1000;
function yahoo(stamps,prices,{tz='America/New_York',period}={}) {
 return {chart:{result:[{meta:{exchangeTimezoneName:tz,shortName:'Fixture',chartPreviousClose:100,...(period?{currentTradingPeriod:{regular:{start:epoch(period[0]),end:epoch(period[1])}}}:{})},timestamp:stamps.map(epoch),indicators:{quote:[{close:prices}]}}]}};
}
function reset(){cached=null;yahooFixture={};emFixture={};txFixture={};failYahoo=false;requests.length=0;writes.length=0;}
assert.deepEqual(plain(getTradingSession('1.000001')),{timeZone:'Asia/Shanghai',ranges:[[570,690],[780,900]]});
assert.deepEqual(plain(getTradingSession('105.AAPL')),{timeZone:'America/New_York',ranges:[[570,960]]});
assert.deepEqual(plain(getTradingSession('100.N225')).ranges,[[540,690],[750,930]]);
assert.equal(getTradingSession('999.UNKNOWN'),null);
assert.equal(getTradingSession('100.toString'),null);
assert.equal(getTradingSession('100.__proto__'),null);
for(const secid of ['116.00700','100.HSI','100.HSCE','100.HSTECH']) {
 assert.equal(getTradingSession(secid).closingAuctionEnd,970);
 now=Date.parse('2026-06-15T08:08:00Z');assert(isMarketOpen(secid));
 now=Date.parse('2026-06-15T08:10:00Z');assert(!isMarketOpen(secid));
}
now=Date.parse('2026-06-15T06:20:00Z');assert(isMarketOpen('100.N225'));
now=Date.parse('2026-06-15T06:30:00Z');assert(!isMarketOpen('100.N225'));

reset();now=Date.parse('2026-06-15T02:30:00Z');
emFixture={data:{name:'上证',preClose:100,trends:['2026-06-12 15:00,99','2026-06-15 09:30,100','2026-06-15 10:30,102']}};
let result=await getIntraday('1.000001');
assert.equal(result.data.date,'20260615');assert.equal(result.data.live,true);assert.equal(result.data.marketOpen,true);
assert.deepEqual(plain(result.data.points),[{t:'09:30',p:100},{t:'10:30',p:102}]);
assert.equal(writes.at(-1).key,'chart:t:v2:1.000001');

// Open market + previous session data must keep polling but must not label yesterday's complete line as live.
reset();emFixture={data:{name:'上证',preClose:100,trends:['2026-06-12 09:30,100','2026-06-12 15:00,102']}};
result=await getIntraday('1.000001');
assert.equal(result.data.live,false);assert.equal(result.data.marketOpen,true);assert.equal(result.data.date,'20260612');
cached={...result,freshness:'fresh'};requests.length=0;
result=await getIntraday('1.000001');assert.equal(requests.length,0);assert.equal(result.data.live,false);assert.equal(result.data.marketOpen,true);

// The first real minute is sufficient; do not fall back to yesterday merely because there are <5 samples.
reset();now=Date.parse('2026-06-15T13:30:00Z');
yahooFixture=yahoo(['2026-06-15T13:30:00Z'],[101]);
result=await getIntraday('105.AAPL');
assert.equal(result.data.points.length,1);assert.equal(result.data.points[0].t,'09:30');assert.equal(result.data.live,true);
assert(requests[0].includes('includePrePost=false'));

// Current metadata may refer to tomorrow, while quotes (including the closing auction) belong to yesterday.
reset();now=Date.parse('2026-06-16T02:00:00Z');
yahooFixture=yahoo(['2026-06-15T07:59:00Z','2026-06-15T08:08:00Z','2026-06-16T01:30:00Z'],[100,103,null],{tz:'Asia/Hong_Kong',period:['2026-06-16T01:30:00Z','2026-06-16T08:00:00Z']});
result=await getIntraday('100.HSI');
assert.equal(result.data.date,'20260615');assert.equal(result.data.points.at(-1).t,'16:08');
assert.equal(result.data.points.at(-1).p,103);assert.equal(result.data.live,false);assert.equal(result.data.marketOpen,true);
assert.deepEqual(plain(result.data.session.ranges),[[570,720],[780,960]]);

// 5d FX window spans London BST midnight; normalize epochs, dedupe minutes and take one UTC day.
reset();now=Date.parse('2026-06-15T23:01:00Z');
yahooFixture=yahoo(['2026-06-14T23:30:00Z','2026-06-15T00:30:00Z','2026-06-15T22:59:00Z','2026-06-15T23:01:00Z','2026-06-15T23:01:00Z','2026-06-16T00:02:00Z'],[6.9,7,7.1,7.2,7.3,null],{tz:'Europe/London'});
result=await getIntraday('133.USDCNH');
assert(requests[0].includes('range=5d'));assert.equal(result.data.session.timeZone,'UTC');
assert.equal(result.data.date,'20260615');assert.deepEqual(plain(result.data.points),[{t:'00:30',p:7},{t:'22:59',p:7.1},{t:'23:01',p:7.3}]);

// Half day metadata is only applied when it belongs to the plotted day, including cached live status/TTL.
reset();now=Date.parse('2026-11-27T18:30:00Z');
yahooFixture=yahoo(['2026-11-27T14:30:00Z','2026-11-27T18:00:00Z'],[100,101],{period:['2026-11-27T14:30:00Z','2026-11-27T18:00:00Z']});
result=await getIntraday('105.AAPL');
assert.deepEqual(plain(result.data.session.ranges),[[570,780]]);assert.equal(result.data.live,false);assert.equal(result.data.marketOpen,false);
assert.equal(writes.at(-1).ttl,300);
cached={...result,freshness:'fresh'};requests.length=0;
result=await getIntraday('105.AAPL');assert.equal(requests.length,0);assert.equal(result.data.marketOpen,false);

for(const [stamp,time]of [['2026-06-15T15:15:00Z','11:15'],['2026-12-15T16:15:00Z','11:15']]){
 reset();now=Date.parse(stamp);yahooFixture=yahoo([stamp],[101]);
 result=await getIntraday('105.AAPL');assert.equal(result.data.points[0].t,time);assert.equal(result.data.live,true);
}
// A timezone-ambiguous naive FX fallback may supply a quote, never an invented UTC chart.
reset();now=Date.parse('2026-06-15T03:00:00Z');failYahoo=true;
emFixture={data:{name:'USDCNH',preClose:7,trends:['2026-06-15 09:30,7.1']}};
result=await getIntraday('133.USDCNH');assert.equal(result.data.session,null);assert.equal(result.data.points[0].p,7.1);
// Tencent US occasionally omits data.date; its quote timestamp still identifies the closing sample.
reset();now=Date.parse('2026-06-15T20:01:00Z');failYahoo=true;
const qt=Array(31).fill('');qt[1]='Apple';qt[4]='100';qt[30]='2026-06-15 16:00:01';
txFixture={data:{usAAPL:{data:{date:'',data:['1600 101 1000 100000']},qt:{usAAPL:qt}}}};
result=await getIntraday('105.AAPL');assert.equal(result.data.date,'20260615');assert.equal(result.data.points[0].t,'16:00');
assert.equal(result.data.points[0].p,101);assert.equal(result.data.session.timeZone,'America/New_York');assert.equal(result.data.live,false);
console.log('✓ Intraday sessions: elapsed trading time, lunch breaks, closing auctions, one-point open, stale-day labels, FX UTC/BST, half days, DST and ambiguous-source fallback');
