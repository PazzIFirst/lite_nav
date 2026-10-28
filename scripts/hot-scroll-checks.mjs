// Page-driven hot sidebars: real frontend modules, fixture APIs, no external requests.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM_EXECUTABLE match frontend-state-checks.mjs.
// Optional HOT_SCROLL_SCREENSHOT_DIR must be under the OS temporary directory.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,extname,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../frontend');
const screenshots=process.env.HOT_SCROLL_SCREENSHOT_DIR?resolve(process.env.HOT_SCROLL_SCREENSHOT_DIR):null;
if(screenshots){assert(screenshots.startsWith(resolve(tmpdir())+sep),'Screenshots must stay in the temporary directory');await mkdir(screenshots,{recursive:true});}
const boot=`<script type="module">import{initHotLists,initHotSettings}from'/js/hot.js';import{initRss,loadRss}from'/js/rss.js';initHotSettings();initRss();await Promise.all([initHotLists(),loadRss()]);window.fixtureReady=true;</script>`;
const server=createServer(async(req,res)=>{
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html')));
 if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 try{
  const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';
  let data=await readFile(path);if(path===resolve(root,'index.html'))data=Buffer.from(data.toString().replace('<script type="module" src="js/main.js"></script>',boot));
  res.setHeader('Content-Type',type+';charset=utf-8');res.end(data);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:process.env.CI?['--no-sandbox']:[]});
const catalog=[{id:'zhihu',title:'知乎热榜',link:'https://zhihu.example/'},{id:'weibo',title:'微博热搜',link:'https://weibo.example/'},{id:'baidu',title:'百度热搜',link:'https://baidu.example/'},{id:'bili',title:'B站热榜',link:'https://bili.example/'}];
const feeds=Array.from({length:8},(_,i)=>({url:'https://feed'+i+'.example/rss',ok:true,title:'订阅源 '+(i+1)}));
const items=Array.from({length:64},(_,i)=>({title:'阅读记录 '+(i+1)+'：从一条街道开始，重新观察日常生活',link:'https://article.example/'+i,time:Date.now()-i*60000,feed:feeds[i%8].url,source:feeds[i%8].title,summary:'一座城市的细节，往往藏在每天走过的道路里。这里记录一些关于技术、设计和日常生活的观察，让阅读有一点从容的节奏。'.repeat(8),content:'<p>值得慢下来阅读的内容。</p>'.repeat(30),contentFormat:'html'}));
const contexts=[];
async function settle(page){await page.evaluate(()=>new Promise((resolve,reject)=>{
 let previous=scrollY,quiet=0,frames=0;
 const tick=()=>{const current=scrollY;quiet=Math.abs(current-previous)<0.1?quiet+1:0;previous=current;if(quiet>=4)return resolve();if(++frames>180)return reject(new Error('page scroll did not settle'));requestAnimationFrame(tick)};
 requestAnimationFrame(tick);
}));}
async function snapshot(page){return page.evaluate(()=>{
 const rect=el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,width:r.width}};
 const side=id=>{const el=document.getElementById(id),style=getComputedStyle(el);return{...rect(el),scrollTop:el.scrollTop,overflowY:style.overflowY,maxHeight:style.maxHeight,padding:style.padding,last:rect(el.querySelector('.hot-item:last-child')?el.querySelector('.hot-panel:last-child .hot-item:last-child'):el),headerPosition:getComputedStyle(el.querySelector('.hot-panel-header')).position}};
 return{y:scrollY,height:innerHeight,margin:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-4')),remaining:document.documentElement.scrollHeight-innerHeight-scrollY,rssTop:document.getElementById('rssPanel').getBoundingClientRect().top,left:side('leftSidebar'),right:side('rightSidebar')};
});}
function noInnerScroll(state){for(const side of[state.left,state.right]){assert.equal(side.scrollTop,0,'Hot list acquired internal scroll offset');assert(!['auto','scroll','hidden'].includes(side.overflowY),'Hot sidebar became a separate scrollport');assert.equal(side.maxHeight,'none','Hot sidebar is still viewport-clipped');assert.equal(side.padding,'0px','Original sidebar spacing was not restored');assert.notEqual(side.headerPosition,'sticky','Panel header still uses inner-scroll sticky layout');}}
function pinnedBottom(state){for(const side of[state.left,state.right]){assert(Math.abs(side.bottom-(state.height-state.margin))<3,`Sidebar bottom not at viewport bottom: ${side.bottom}`);assert(side.last.top>=state.margin-2&&side.last.bottom<=state.height-state.margin+2,'Last ranked item is not fully visible');}noInnerScroll(state);}
function pinnedTop(state){for(const side of[state.left,state.right])assert(Math.abs(side.top-state.margin)<3,`Sidebar head not at top margin: ${side.top}`);noInnerScroll(state);}
async function wheelTo(page,target){
 const current=await page.evaluate(()=>scrollY),view=page.viewportSize();
 await page.mouse.move(view.width/2,view.height/2);await page.mouse.wheel(0,target-current);
 await page.waitForFunction(target=>Math.abs(scrollY-target)<2,target);await settle(page);
}
async function preload(page,count){
 while(await page.locator('.rss-item').count()<count){const before=await page.locator('.rss-item').count();await page.evaluate(()=>document.getElementById('rssMoreBtn').click());await page.waitForFunction(before=>document.querySelectorAll('.rss-item').length>before,before);}
 await settle(page);
}
async function start({width=1366,height=768,theme='light',short=false}={}){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'});contexts.push(context);
 await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
 const page=await context.newPage();page.setDefaultTimeout(7000);const errors=[],requests=[];let compact=false,expanded=false;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();requests.push(url.pathname);
  if(url.pathname==='/api/rss')return route.fulfill({json:{data:{items,feeds}}});
  if(url.pathname==='/api/hot/catalog')return route.fulfill({json:{data:catalog}});
  if(url.pathname.startsWith('/api/hot/')){
   const id=url.pathname.split('/').pop(),name=catalog.find(c=>c.id===id)?.title,isLeft=['zhihu','weibo'].includes(id);
   const phrase=isLeft&&!compact?'城市公共空间如何让日常出行更舒适？从街道更新到公共交通，看看这些关于生活与设计的新观察。':'用日常观察记录科技与生活话题，了解一条值得关注的新消息。';
   const extra=expanded&&id==='weibo'?' 更完整的追踪报道，补充不同城市的实践案例。'.repeat(2):'';
   return route.fulfill({json:{source_label:'测试数据',data:Array.from({length:short?2:15},(_,i)=>({title:`${name} · 第 ${i+1} 条：${phrase}${extra}`,url:`https://news.example/${id}/${i}`}))}});
  }
  return route.fulfill({status:404,body:''});
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(count=>window.fixtureReady&&document.querySelectorAll('.hot-item').length===count,short?8:60);
 await page.evaluate(()=>document.fonts.ready);await preload(page,24);
 return{page,context,errors,requests,setCompact:()=>{compact=true;expanded=false},setExpanded:()=>{compact=false;expanded=true}};
}
async function refresh(test,id){
 const count=test.requests.filter(path=>path==='/api/hot/'+id).length;
 await test.page.locator(`#hot-slot${id==='weibo'?1:0}-panel .hot-panel-refresh`).evaluate(el=>el.click());
 await test.page.waitForFunction(()=>document.querySelectorAll('.hot-item').length===60);
 assert.equal(test.requests.filter(path=>path==='/api/hot/'+id).length,count+1);await settle(test.page);
}
const results=[];
try{
 for(const [width,height,theme]of[[1366,768,'light'],[1440,900,'dark'],[1920,1080,'light'],[2560,1440,'dark'],[1366,480,'light']]){
  const test=await start({width,height,theme}),{page}=test;
  const initial=await snapshot(page);noInnerScroll(initial);
  assert(initial.left.height>height+120&&initial.right.height>height+120,'Fixture needs two overflowing sidebars');
  assert(Math.abs(initial.left.height-initial.right.height)>100,'The two sidebar heights must differ');
  const overflow=Math.max(initial.left.height,initial.right.height)-height+2*initial.margin;
  await wheelTo(page,overflow+100);let bottom=await snapshot(page);pinnedBottom(bottom);assert(bottom.remaining>height,'Seeing the last hot item required reaching the RSS end');
  await wheelTo(page,bottom.y+height);pinnedBottom(await snapshot(page));
  const beforeKey=await snapshot(page);await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('PageDown');
  await page.waitForFunction(y=>scrollY>y+20,beforeKey.y);await settle(page);bottom=await snapshot(page);pinnedBottom(bottom);
  assert(bottom.remaining>height,'RSS unexpectedly reached the end');
  const reverse=Math.min(120,Math.min(bottom.left.height,bottom.right.height)-height+2*bottom.margin);
  await wheelTo(page,bottom.y-reverse);const reversed=await snapshot(page);
  for(const key of['left','right'])assert(Math.abs(reversed[key].top-bottom[key].top-reverse)<3,'Reversing page scroll did not immediately move the hot sidebar');
  noInnerScroll(reversed);
  if(width===1366&&height===768){
   // A restored document must retain a mid-scroll sidebar's current position/direction.
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await settle(page);
   let kept=await snapshot(page);assert(Math.abs(kept.y-reversed.y)<1);
   for(const key of['left','right'])assert(Math.abs(kept[key].top-reversed[key].top)<3,'pageshow reset a mid-scroll sidebar');
   const originalPanel=await page.locator('#leftSidebar .hot-panel').first().elementHandle();
   const hotRequests=test.requests.filter(path=>path.startsWith('/api/hot/')&&path!=='/api/hot/catalog').length;
   for(const action of['#hotSave','#hotReset']){
    await page.locator('#hotSettingsBtn').click();await page.locator(action).click();await settle(page);
    assert(await originalPanel.evaluate(el=>el.isConnected),'Unchanged settings rebuilt the hot-list DOM');
    kept=await snapshot(page);assert(Math.abs(kept.y-reversed.y)<1);
    for(const key of['left','right'])assert(Math.abs(kept[key].top-reversed[key].top)<3,'Unchanged settings moved the sidebar');
   }
   assert.equal(test.requests.filter(path=>path.startsWith('/api/hot/')&&path!=='/api/hot/catalog').length,hotRequests,'Unchanged settings unnecessarily refreshed the hot lists');
  }
  const upperTarget=Math.max(100,reversed.y-overflow-40);await wheelTo(page,upperTarget);pinnedTop(await snapshot(page));
  const upper=await snapshot(page);await wheelTo(page,upper.y+80);const downAgain=await snapshot(page);
  for(const key of['left','right'])assert(Math.abs(downAgain[key].top-upper[key].top+80)<3,'Hot sidebar did not follow the page when scrolling downward again');
  await wheelTo(page,downAgain.y+overflow+40);pinnedBottom(await snapshot(page));
  // Adding RSS cards changes the parent height, not the visible hot-list position.
  const beforeMore=await snapshot(page),count=await page.locator('.rss-item').count();
  await page.evaluate(()=>document.getElementById('rssMoreBtn').click());await page.waitForFunction(n=>document.querySelectorAll('.rss-item').length>n,count);await settle(page);
  const afterMore=await snapshot(page);assert(Math.abs(afterMore.y-beforeMore.y)<1);for(const key of['left','right'])assert(Math.abs(afterMore[key].top-beforeMore[key].top)<3,'RSS append moved the sidebar');pinnedBottom(afterMore);
  if(screenshots&&[1366,1440,1920].includes(width))await page.screenshot({path:join(screenshots,`hot-page-scroll-${width}x${height}-${theme}.png`)});
  if(width===1366&&height===768){
   const before=await snapshot(page);test.setCompact();await refresh(test,'weibo');const compact=await snapshot(page);
   assert(compact.left.height<before.left.height,'Refresh did not change sidebar height');assert(Math.abs(compact.y-before.y)<1,'Refresh scrolled the RSS page');pinnedBottom(compact);
   await wheelTo(page,compact.y+100);pinnedBottom(await snapshot(page));
   test.setExpanded();await refresh(test,'weibo');let changed=await snapshot(page);assert(changed.left.height>compact.left.height);pinnedBottom(changed);
   await wheelTo(page,changed.y+Math.max(changed.left.height-compact.left.height,0)+100);pinnedBottom(await snapshot(page));
   await page.setViewportSize({width,height:600});await settle(page);pinnedBottom(await snapshot(page));await wheelTo(page,(await snapshot(page)).y+100);pinnedBottom(await snapshot(page));
   await page.setViewportSize({width:1260,height:600});await settle(page);assert(!(await page.locator('#leftSidebar').isVisible()));assert(!(await page.locator('#rightSidebar').isVisible()));
   await page.setViewportSize({width,height});await settle(page);changed=await snapshot(page);pinnedBottom(changed);
   await wheelTo(page,changed.y+200);pinnedBottom(await snapshot(page));
   // Stay within the loading skeleton's scrollable height: otherwise Chromium
   // clamps restored scroll before asynchronous RSS content has arrived.
   const restoreY=40;
   await wheelTo(page,restoreY);await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.fixtureReady&&document.querySelectorAll('.hot-item').length===60&&scrollY>0).catch(async error=>{
    console.error('reload diagnostics',await page.evaluate(()=>({ready:window.fixtureReady,items:document.querySelectorAll('.hot-item').length,scrollY,scrollRestoration:history.scrollRestoration,documentHeight:document.documentElement.scrollHeight,rssItems:document.querySelectorAll('.rss-item').length,leftTop:document.getElementById('leftSidebar').getBoundingClientRect().top,rightTop:document.getElementById('rightSidebar').getBoundingClientRect().top})));
    throw error;
   });await settle(page);
   const restored=await snapshot(page);noInnerScroll(restored);
   assert(Math.abs(restored.y-restoreY)<3,'Reload did not restore the nonzero page scroll position');
   for(const key of['left','right']){
    const lower=Math.min(restored.margin,restored.height-restored.margin-restored[key].height);
    const expected=Math.min(restored.margin,Math.max(lower,restored.margin-restored.y));
    assert(Math.abs(restored[key].top-expected)<3,'Reload positioned the sidebar as if the page were at the top');
   }
  }
  assert.equal(test.errors.length,0);results.push({width,height,theme,pageScroll:true,bottomBeforeRssEnd:true,reverseImmediately:true,noInnerScroll:true});await test.context.close();
 }
 const short=await start({short:true});await wheelTo(short.page,500);let state=await snapshot(short.page);assert(state.left.height<state.height-state.margin*2);pinnedTop(state);
 await wheelTo(short.page,1000);pinnedTop(await snapshot(short.page));await wheelTo(short.page,700);pinnedTop(await snapshot(short.page));assert.equal(short.errors.length,0);await short.context.close();
 console.log(JSON.stringify(results,null,2));
 console.log('✓ Page-driven hot lists: both directions, unequal/tall/short sidebars, keyboard scrolling, refresh/resize, RSS append, pageshow/reload, unchanged settings, no inner scrollport, themes and narrow breakpoint');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
