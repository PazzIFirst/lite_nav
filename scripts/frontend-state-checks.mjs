// Browser regressions; serves the checked-out frontend and mocks every API/external request.
// Install Playwright separately or set PLAYWRIGHT_MODULE to its module path.
// Optional PLAYWRIGHT_CHROMIUM_EXECUTABLE selects an existing Chromium binary.
// No backend, real third-party requests, screenshots or repository writes are needed.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve,extname,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../frontend');
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{
    const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(path)]||'application/octet-stream';
    res.setHeader('Content-Type',type+'; charset=utf-8');res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:process.env.CI?['--no-sandbox']:[]});
const contexts=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitUntil(check,label){
  const deadline=Date.now()+4000;
  while(!check()){if(Date.now()>deadline)throw new Error('Timed out: '+label);await sleep(10);}
}
async function start({holdQuotes=false,holdSymbols=false,calendar=false}={}){
  const context=await browser.newContext({viewport:{width:1360,height:1000},timezoneId:'America/Los_Angeles',reducedMotion:'reduce'});
  contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(5000);
  const requests=[],pending=new Map(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(calendar)await page.clock.install({time:new Date('2026-10-29T15:59:58Z')});
  let todayCount=0;
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==base)return route.abort();
    if(!u.pathname.startsWith('/api/'))return route.continue();
    requests.push(u.pathname+u.search);
    let gate;
    async function hold(key){
      const decision=await new Promise(release=>pending.set(key,{release,done:false}));
      gate=pending.get(key);
      return decision;
    }
    try{
      if(u.pathname==='/api/intraday'){
        const secid=u.searchParams.get('secid');
        if(holdQuotes&&['1.000001','0.399001'].includes(secid)){
          const decision=await hold('quote:'+secid);
          if(decision==='error')return await route.fulfill({status:502,json:{error:'test'}});
        }
        const names={'1.000001':'上证指数','0.399001':'深证成指','105.AAPL':'Apple','105.TSLA':'Tesla'};
        return await route.fulfill({json:{data:{name:names[secid]||secid,live:false,date:'20261029',prevClose:100,points:[{p:101},{p:secid==='0.399001'?202:102}]},source_label:'regression fixture'}});
      }
      if(u.pathname==='/api/symbol'){
        const code=u.searchParams.get('code');
        if(holdSymbols){const decision=await hold('symbol:'+code);if(decision==='error')return await route.fulfill({status:502,json:{error:'test'}});}
        return await route.fulfill({json:{data:{secid:'105.'+code,name:code==='AAPL'?'Apple':'Tesla',code}}});
      }
      if(u.pathname==='/api/today'){
        const number=++todayCount;
        if(calendar&&number===1)await hold('today:old');
        return await route.fulfill({json:{data:{lunar_text:'农历第'+number+'次',lunar_year_ganzhi:'丙午',lunar_year_zodiac:'马'}}});
      }
      if(u.pathname==='/api/rss')return await route.fulfill({json:{data:{items:[],feeds:[]}}});
      if(u.pathname.startsWith('/api/hot'))return await route.fulfill({json:{data:[]}});
      return await route.fulfill({json:{data:{}}});
    }finally{if(gate)gate.done=true;}
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.fin-card');
  return {page,context,pending,requests,errors,todayCount:()=>todayCount};
}
async function release(test,key,result='ok'){
  await waitUntil(()=>test.pending.has(key),key+' requested');
  const gate=test.pending.get(key);gate.release(result);
  await waitUntil(()=>gate.done,key+' fulfilled');
  await test.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function dismiss(page,kind,modal,button){
  if(kind==='button')await page.locator(button).click();
  else if(kind==='backdrop')await page.locator(modal).click({position:{x:2,y:2}});
  else await page.keyboard.press('Escape');
}
try{
  for(const oldResult of ['ok','error']){
    const test=await start({holdQuotes:true}),{page}=test;
    await waitUntil(()=>test.pending.has('quote:1.000001'),'initial quote');
    await page.locator('.fin-card').nth(0).click();await page.locator('#finPreset').selectOption('0.399001');await page.locator('#finPickOk').click();
    await waitUntil(()=>test.pending.has('quote:0.399001'),'new quote starts before old request finishes');
    await release(test,'quote:1.000001',oldResult);
    assert.equal(await page.locator('.fin-card-name').nth(0).textContent(),'深证成指');
    assert.notEqual(await page.locator('.fin-chg').nth(0).textContent(),'暂无数据');
    await page.evaluate(async()=>{(await import('/js/finance.js')).loadFinance();});
    assert.equal(test.requests.filter(r=>r==='/api/intraday?secid=0.399001').length,1,'old finally must not clear new busy state');
    await release(test,'quote:0.399001');
    await page.waitForFunction(()=>document.querySelector('.fin-price').textContent==='202.00');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nav.fin.slots'))[0].secid),'0.399001');
    assert.deepEqual(test.errors,[]);await test.context.close();
  }
  console.log('✓ Quote generation: old success/error/finally cannot affect a replacement card or its pending request');

  for(const [cancel,oldResult] of [['button','ok'],['backdrop','error'],['escape','ok']]){
    const test=await start({holdSymbols:true}),{page}=test;
    await page.locator('.fin-card').nth(0).click();await page.getByRole('button',{name:'美股',exact:true}).click();await page.locator('#finCode').fill('AAPL');await page.locator('#finPickOk').click();
    await waitUntil(()=>test.pending.has('symbol:AAPL'),'AAPL requested');
    await page.locator('#finCode').press('Enter');
    assert.equal(test.requests.filter(r=>r.includes('/api/symbol')).length,1,'duplicate Enter is ignored while pending');
    await dismiss(page,cancel,'#finPickModal','#finPickCancel');
    await page.locator('.fin-card').nth(1).click();await page.getByRole('button',{name:'美股',exact:true}).click();await page.locator('#finCode').fill('TSLA');await page.locator('#finPickOk').click();
    await waitUntil(()=>test.pending.has('symbol:TSLA'),'new symbol requested');
    await release(test,'symbol:AAPL',oldResult);
    assert(await page.locator('#finPickModal').evaluate(el=>el.classList.contains('open')));
    assert(await page.locator('#finPickOk').isDisabled(),'old finally must not enable new request button');
    assert(!(await page.locator('#finCodeHint').textContent()).includes('没找到'));
    assert(!(await page.evaluate(()=>localStorage.getItem('nav.fin.slots')||'')).includes('105.AAPL'));
    await release(test,'symbol:TSLA');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nav.fin.slots')));
    assert.equal(saved[0].secid,'1.000001');assert.equal(saved[1].secid,'105.TSLA');assert.equal(saved[1].kind,'us');
    assert.deepEqual(test.errors,[]);await test.context.close();
  }
  // Switching tabs and editing a pending code also invalidate the previous picker operation.
  const edit=await start({holdSymbols:true});
  await edit.page.locator('.fin-card').nth(0).click();await edit.page.getByRole('button',{name:'美股',exact:true}).click();await edit.page.locator('#finCode').fill('AAPL');await edit.page.locator('#finPickOk').click();
  await waitUntil(()=>edit.pending.has('symbol:AAPL'),'editable pending code');
  await edit.page.locator('#finCode').fill('TSLA');assert(!(await edit.page.locator('#finPickOk').isDisabled()));
  await edit.page.getByRole('button',{name:'股指',exact:true}).click();await release(edit,'symbol:AAPL');
  assert(await edit.page.locator('#finPickModal').evaluate(el=>el.classList.contains('open')));
  assert(!(await edit.page.evaluate(()=>localStorage.getItem('nav.fin.slots')||'')).includes('105.AAPL'));
  await edit.context.close();
  console.log('✓ Picker sessions: cancel/backdrop/Escape/reopen/tab/edit/duplicate-submit protect slot, kind, controls and errors');

  const settings=await start(),{page}=settings;
  await page.waitForFunction(()=>document.querySelector('.fin-price').textContent==='102.00');
  const originalCanvas=await page.locator('.fin-canvas').nth(0).evaluate(c=>c.toDataURL());
  for(const cancel of ['button','backdrop','escape']){
    await page.locator('#hotSettingsBtn').click();await page.locator('[data-mode="green-up"]').click();
    assert.notEqual(await page.locator('.fin-canvas').nth(0).evaluate(c=>c.toDataURL()),originalCanvas,'closed-market chart repaints immediately');
    await dismiss(page,cancel,'#hotModal','#hotCancel');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.finColor),'red-up');
    assert.equal(await page.evaluate(()=>localStorage.getItem('nav.fin.color')),null);
    assert.equal(await page.locator('.fin-canvas').nth(0).evaluate(c=>c.toDataURL()),originalCanvas);
  }
  await page.locator('#hotSettingsBtn').click();await page.locator('[data-mode="green-up"]').click();await page.locator('#hotSave').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('nav.fin.color')),'green-up');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.fin-card');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.finColor),'green-up');
  await page.locator('#hotSettingsBtn').click();await page.getByRole('switch',{name:'搜索词联想'}).uncheck();await page.locator('#hotSave').click();
  await page.locator('#hotSettingsBtn').click();await page.locator('#hotReset').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.finColor),'red-up');
  assert.equal(await page.evaluate(()=>localStorage.getItem('nav.fin.color')),'red-up');
  assert.equal(await page.evaluate(()=>localStorage.getItem('nav.search.suggestions')),'true');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('hotSlots'))),['zhihu','weibo','baidu','bili']);
  assert.deepEqual(settings.errors,[]);await settings.context.close();
  console.log('✓ Settings transaction: every cancellation rolls back; save persists; reset restores color, search and slots');

  const calendar=await start({calendar:true});
  await waitUntil(()=>calendar.pending.has('today:old'),'initial calendar');
  assert.match(await calendar.page.locator('#solar-date').textContent(),/10月29日/);
  await calendar.page.clock.fastForward(5000);
  await calendar.page.waitForFunction(()=>document.getElementById('lunar-date').textContent.includes('第2次'));
  assert.match(await calendar.page.locator('#solar-date').textContent(),/10月30日/);
  assert.match(await calendar.page.locator('#weekend-row').textContent(),/明天/);
  await release(calendar,'today:old');
  assert.match(await calendar.page.locator('#lunar-date').textContent(),/第2次/,'yesterday response is ignored');
  await calendar.page.clock.fastForward(60000);assert.equal(calendar.todayCount(),2,'no request on each clock tick');
  await calendar.page.clock.setSystemTime(new Date('2026-10-30T16:00:03Z'));
  await calendar.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await calendar.page.waitForFunction(()=>document.getElementById('lunar-date').textContent.includes('第3次'));
  assert.match(await calendar.page.locator('#solar-date').textContent(),/10月31日/);
  assert.match(await calendar.page.locator('#weekend-row').textContent(),/今天是周末/);
  await calendar.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(calendar.todayCount(),3);
  assert.deepEqual(calendar.errors,[]);await calendar.context.close();
  console.log('✓ Beijing calendar: midnight, stale lunar response and visible-tab recovery; no per-second network requests');
}finally{
  await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();await new Promise(r=>server.close(r));
}
