// Uses actual browser canvas paths/pixels. All APIs are mocked; no images or other binary files are written.
// Optional PLAYWRIGHT_MODULE and PLAYWRIGHT_CHROMIUM_EXECUTABLE select existing local dependencies.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve,extname,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../frontend');
const boot='<script type="module">const hot=await import("/js/hot.js");hot.initHotSettings();const finance=await import("/js/finance.js");finance.renderFinance();</script>';
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{
    let body=await readFile(path);
    if(path.endsWith('/index.html'))body=Buffer.from(body.toString().replace('<script type="module" src="js/main.js"></script>',boot));
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'}[extname(path)]||'application/octet-stream')+';charset=utf-8');res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:process.env.CI?['--no-sandbox']:[]});
const contexts=[];
const cn={timeZone:'Asia/Shanghai',ranges:[[570,690],[780,900]]};
const us={timeZone:'America/New_York',ranges:[[570,960]]};
const hk={timeZone:'Asia/Hong_Kong',ranges:[[570,720],[780,960]],closingAuctionEnd:970};
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
async function open(fixture,motion='reduce'){
  const context=await browser.newContext({viewport:{width:1360,height:1000},deviceScaleFactor:2,reducedMotion:motion});contexts.push(context);
  await context.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext,seen=new WeakSet();
    HTMLCanvasElement.prototype.getContext=function(...args){
      const ctx=original.apply(this,args);
      if(args[0]!=='2d'||!ctx||seen.has(ctx))return ctx;
      seen.add(ctx);let path=[];const canvas=this;canvas.testDraws=[];
      for(const name of ['beginPath','moveTo','lineTo','arc','closePath']){
        const method=ctx[name];ctx[name]=function(...values){if(name==='beginPath')path=[];else path.push({name,values});return method.apply(this,values);};
      }
      const clear=ctx.clearRect;ctx.clearRect=function(...values){canvas.testDraws=[];return clear.apply(this,values);};
      for(const kind of ['stroke','fill']){
        const method=ctx[kind];ctx[kind]=function(...values){canvas.testDraws.push({kind,color:String(kind==='stroke'?ctx.strokeStyle:ctx.fillStyle),width:ctx.lineWidth,path:path.map(p=>({...p,values:[...p.values]}))});return method.apply(this,values);};
      }
      return ctx;
    };
  });
  const page=await context.newPage(),errors=[];let requests=0;page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/intraday'){requests++;return route.fulfill({json:{data:{name:'回归行情',live:true,date:'2026-10-29',prevClose:100,...fixture},source_label:'fixture'}});}
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{data:[]}});
    return route.continue();
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  try { await page.waitForFunction(name=>document.querySelector('.fin-card-name')?.textContent===name,fixture.name||'回归行情'); }
  catch(error) { throw new Error(error.message+' '+JSON.stringify({errors,names:await page.locator('.fin-card-name').allTextContents()})); }
  return {context,page,errors,requests:()=>requests};
}
async function state(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return page.locator('.fin-card').first().evaluate(card=>{
  const canvas=card.querySelector('canvas'),price=card.querySelector('.fin-price'),change=card.querySelector('.fin-chg');
  const draws=canvas.testDraws,arc=draws.flatMap(d=>d.path).findLast(p=>p.name==='arc');
  const ratio=canvas.width/canvas.clientWidth;
  const pixel=arc?Array.from(canvas.getContext('2d').getImageData(Math.max(0,Math.min(canvas.width-1,Math.round(arc.values[0]*ratio))),Math.max(0,Math.min(canvas.height-1,Math.round(arc.values[1]*ratio))),1,1).data):null;
  const allPixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const rgb=getComputedStyle(price).color.match(/[\d.]+/g).slice(0,3).map(Number);let coloredMaxX=-1;
  for(let i=0;i<allPixels.length;i+=4){if(allPixels[i+3]>32&&rgb.every((c,j)=>Math.abs(allPixels[i+j]-c)<3))coloredMaxX=Math.max(coloredMaxX,(i/4)%canvas.width);}
  return {draws,width:canvas.clientWidth,height:canvas.clientHeight,pixel,arc,price:price.textContent,change:change.textContent,priceClass:price.className,changeClass:change.className,rootColor:document.documentElement.dataset.finColor,priceColor:getComputedStyle(price).color,changeColor:getComputedStyle(change).color,coloredMaxX:coloredMaxX/ratio,painted:allPixels.some((x,i)=>i%4===3&&x>0)};
});}
function checkGeometry(value,start,end,expectedPrice='101.00'){
  assert(value.arc,'actual canvas endpoint missing');near(value.arc.values[0],end*(value.width-1));assert.equal(value.price,expectedPrice);
  const stroke=value.draws.find(d=>d.kind==='stroke'&&Math.abs(d.width-1.4)<1e-5);assert(stroke);
  const positions=stroke.path.filter(p=>p.name==='moveTo'||p.name==='lineTo');near(positions[0].values[0],start*(value.width-1));near(positions.at(-1).values[0],end*(value.width-1));
  const fill=value.draws.find(d=>d.kind==='fill'&&d.color==='[object CanvasGradient]');
  if(fill){const xs=fill.path.filter(p=>p.name==='moveTo'||p.name==='lineTo').map(p=>p.values[0]);near(Math.min(...xs),start*(value.width-1));near(Math.max(...xs),end*(value.width-1));}
  const rgb=value.priceColor.match(/[\d.]+/g).slice(0,3).map(Number);assert.deepEqual(value.pixel.slice(0,3),rgb,'endpoint pixel color must match quote color: '+JSON.stringify({mode:value.rootColor,price:value.priceColor,change:value.changeColor,cls:value.priceClass}));assert.equal(value.pixel[3],255);
  assert.deepEqual(stroke.color.match(/[\da-f]{2}/gi).map(x=>parseInt(x,16)),rgb,'actual line stroke uses the same color');
  assert(value.coloredMaxX<=end*(value.width-1)+3,'no colored line or fill extends into future trading minutes');
}
try{
  const cases=[
    {name:'CN 10:30, stale closed sample',points:[{t:'09:30',p:99},{t:'10:30',p:101}],session:cn,live:false,start:0,end:.25},
    {name:'CN lunch',points:[{t:'09:30',p:99},{t:'12:00',p:101}],session:cn,start:0,end:.5},
    {name:'CN late first/missing minutes at 14:00',points:[{t:'09:45',p:99},{t:'10:30',p:99.5},{t:'14:00',p:101}],session:cn,start:15/240,end:.75},
    {name:'CN close',points:[{t:'09:30',p:99},{t:'15:00',p:101}],session:cn,start:0,end:1},
    {name:'single point',points:[{t:'10:30',p:101}],session:cn,start:.25,end:.25},
    {name:'US missing minutes',points:[{t:'10:00',p:99},{t:'10:30',p:101}],session:us,start:30/390,end:60/390},
    {name:'US 15:59',points:[{t:'09:30',p:99},{t:'15:59',p:101}],session:us,start:0,end:389/390},
    {name:'FX UTC',points:[{t:'00:00',p:99},{t:'06:00',p:101}],session:{timeZone:'UTC',ranges:[[0,1440]]},start:0,end:.25},
    {name:'HK closing auction',points:[{t:'09:30',p:99},{t:'16:00',p:99},{t:'16:08',p:101}],session:hk,start:0,end:1},
  ];
  for(const test of cases){
    const view=await open(test);checkGeometry(await state(view.page),test.start,test.end);assert.deepEqual(view.errors,[]);await view.context.close();console.log('✓ Canvas time axis / bounded fill / quote color: '+test.name);
  }
  const reopenedFixture={session:cn,live:false,marketOpen:false,points:[{t:'09:30',p:99},{t:'15:00',p:101}]};
  const reopened=await open(reopenedFixture);checkGeometry(await state(reopened.page),0,1);
  reopenedFixture.live=true;reopenedFixture.marketOpen=true;reopenedFixture.points=[{t:'09:30',p:99},{t:'10:30',p:101}];
  await reopened.page.evaluate(async()=>{(await import('/js/finance.js')).loadFinance();});
  await reopened.page.waitForFunction(()=>{const c=document.querySelector('.fin-canvas');const arc=c.testDraws.flatMap(d=>d.path).findLast(p=>p.name==='arc');return arc&&arc.values[0]<c.clientWidth*.3;});
  assert(reopened.requests()>=6,'closed response must not suppress the next visible-page poll');checkGeometry(await state(reopened.page),0,.25);await reopened.context.close();
  console.log('✓ Opening recovery: previous closed quote cannot suppress polling or leave yesterday’s full line');
  for(const motion of ['reduce','no-preference']){
  const reversal=await open({session:cn,points:Array.from({length:31},(_,i)=>({t:(i<30?'09:':'10:')+String(i<30?30+i:0).padStart(2,'0'),p:i===30?101:99})),live:false},motion);
  const original=await state(reversal.page);checkGeometry(original,0,30/240);assert.equal(original.change,'+1.00%');assert.match(original.priceClass,/is-up/);assert.equal(original.priceColor,original.changeColor);near(original.arc.values[1],4);
  await reversal.page.locator('#hotSettingsBtn').click();
  // Assert in the same JavaScript turn as the click: no timer, animation frame or retry may hide a color transition.
  const immediate=await reversal.page.evaluate(()=>{
    const capture=()=>[...document.querySelectorAll('.fin-card')].map(card=>{
      const price=card.querySelector('.fin-price'),change=card.querySelector('.fin-chg'),c=card.querySelector('canvas');
      const arc=c.testDraws.flatMap(d=>d.path).findLast(p=>p.name==='arc'),scale=c.width/c.clientWidth;
      return {price:getComputedStyle(price).color,change:getComputedStyle(change).color,transition:getComputedStyle(price).transitionProperty,pixel:Array.from(c.getContext('2d').getImageData(Math.round(arc.values[0]*scale),Math.round(arc.values[1]*scale),1,1).data)};
    });
    const samples=[];
    for(let i=0;i<20;i++){document.querySelector(`[data-mode="${i%2===0?'green-up':'red-up'}"]`).click();samples.push(...capture());}
    document.querySelector('[data-mode="green-up"]').click();samples.push(...capture());
    document.getElementById('hotCancel').click();samples.push(...capture());
    return samples;
  });
  for(const sample of immediate){const rgb=sample.price.match(/[\d.]+/g).slice(0,3).map(Number);assert.deepEqual(sample.pixel.slice(0,3),rgb,`same-turn ${motion} canvas/price mismatch`);assert.equal(sample.change,sample.price);assert.equal(sample.transition,'none');}
  await reversal.page.locator('#hotSettingsBtn').click();await reversal.page.locator('[data-mode="green-up"]').click();const preview=await state(reversal.page);checkGeometry(preview,0,30/240);assert.notDeepEqual(preview.pixel,original.pixel);assert.equal(preview.priceColor,preview.changeColor);
  await reversal.page.locator('#hotCancel').click();const cancelled=await state(reversal.page);checkGeometry(cancelled,0,30/240);assert.deepEqual(cancelled.pixel,original.pixel);
  await reversal.page.locator('#hotSettingsBtn').click();await reversal.page.locator('[data-mode="green-up"]').click();await reversal.page.locator('#hotSave').click();checkGeometry(await state(reversal.page),0,30/240);
  await reversal.context.close();console.log(`✓ Raw reversal and same-turn palette preview/cancel/save: ${motion} (no waiting in color assertions)`);
  }
  const neutral=await open({session:cn,prevClose:0,points:[{t:'09:30',p:99},{t:'10:30',p:101}]});const neutralState=await state(neutral.page);checkGeometry(neutralState,0,.25);assert.equal(neutralState.change,'--');assert.doesNotMatch(neutralState.priceClass,/is-(up|down)/);await neutral.context.close();
  for(const fixture of [{points:[{t:'09:30',p:99},{t:'10:30',p:101}]},{session:cn,points:[{p:99},{p:101}]},{session:cn,points:[{t:'09:30',p:99},{t:'15:01',p:101}]},{session:cn,points:[{t:'09:30',p:99},{t:'10:30',p:0}]}]){
    const view=await open(fixture),value=await state(view.page);assert.equal(value.painted,false);assert.equal(value.price,fixture.points.at(-1).p===0?'--':'101.00');await view.context.close();
  }
  console.log('✓ Invalid previous/last values and missing session/time use consistent neutral or quote-only fallback');
}finally{await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();await new Promise(r=>server.close(r));}
