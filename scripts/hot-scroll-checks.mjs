// Independent sidebar scroll regressions. Only fixture APIs are used.
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
if(screenshots){assert(screenshots.startsWith(resolve(tmpdir())+sep),'Screenshots must stay outside the repository in the temporary directory');await mkdir(screenshots,{recursive:true});}
const boot=`<script type="module">import{initHotLists}from'/js/hot.js';import{initRss,loadRss}from'/js/rss.js';initRss();await Promise.all([initHotLists(),loadRss()]);window.fixtureReady=true;</script>`;
const server=createServer(async(req,res)=>{
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html')));
 if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 try {
  const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';
  let data=await readFile(path);if(path.endsWith('/index.html'))data=Buffer.from(data.toString().replace('<script type="module" src="js/main.js"></script>',boot));
  res.setHeader('Content-Type',type+';charset=utf-8');res.end(data);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:process.env.CI?['--no-sandbox']:[]});
const catalog=[{id:'zhihu',title:'知乎热榜',link:'https://zhihu.example/'},{id:'weibo',title:'微博热搜',link:'https://weibo.example/'},{id:'baidu',title:'百度热搜',link:'https://baidu.example/'},{id:'bili',title:'B站热榜',link:'https://bili.example/'}];
const feeds=Array.from({length:5},(_,i)=>({url:'https://feed'+i+'.example/rss',ok:true,title:'订阅源 '+(i+1)}));
const items=Array.from({length:40},(_,i)=>({title:'阅读记录 '+(i+1)+'：从一条街道开始，重新观察日常生活',link:'https://article.example/'+i,time:Date.now()-i*60000,feed:feeds[i%5].url,source:feeds[i%5].title,summary:'一座城市的细节，往往藏在每天走过的道路里。这里记录一些关于技术、设计和日常生活的观察，让阅读有一点从容的节奏。'.repeat(8),content:'<p>值得慢下来阅读的内容。</p>'.repeat(30),contentFormat:'html'}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[];
async function metrics(page){return page.evaluate(()=>({window:scrollY,rss:document.getElementById('rssPanel').getBoundingClientRect().top,left:document.getElementById('leftSidebar').scrollTop,right:document.getElementById('rightSidebar').scrollTop}));}
function unchangedMain(before,after){assert(Math.abs(before.window-after.window)<1,'Window scrolled with the sidebar');assert(Math.abs(before.rss-after.rss)<1,'RSS moved with the sidebar');}
async function scrollSide(page,id,other){
 const sidebar=page.locator('#'+id),box=await sidebar.boundingBox();
 assert(box.y>=0&&box.y+box.height<=(await page.viewportSize()).height+1,'Sidebar exceeds viewport');
 assert(await sidebar.evaluate(el=>el.scrollHeight>el.clientHeight+100),'Fixture must overflow its whole sidebar');
 assert.equal(await sidebar.getAttribute('role'),'region');assert.equal(await sidebar.getAttribute('tabindex'),'0');
 const before=await metrics(page),opposite=await page.locator('#'+other).evaluate(el=>el.scrollTop);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,100000);
 await page.waitForFunction(id=>{const el=document.getElementById(id);return el.scrollTop>=el.scrollHeight-el.clientHeight-1;},id);
 let after=await metrics(page);unchangedMain(before,after);
 assert.equal(await page.locator('#'+other).evaluate(el=>el.scrollTop),opposite,'Other sidebar moved');
 const last=await sidebar.locator('.hot-item').last().boundingBox();
 assert(last.y>=box.y-1&&last.y+last.height<=box.y+box.height+1,'Last ranked item is not fully visible');
 await page.mouse.wheel(0,100000);await pause(120);unchangedMain(before,await metrics(page));
 await page.mouse.wheel(0,-100000);await page.waitForFunction(id=>document.getElementById(id).scrollTop===0,id);
 await page.mouse.wheel(0,-100000);await pause(120);unchangedMain(before,await metrics(page));
 // The first title follows this scrollport, not an invisible inner panel scroller.
 await sidebar.evaluate(el=>{el.scrollTop=180;});
 const header=await sidebar.locator('.hot-panel-header').first().boundingBox();
 assert(header.y>=box.y-1&&header.y<=box.y+8,'Panel title is not pinned inside the sidebar');
 assert(await sidebar.locator('.hot-panel').evaluateAll(els=>els.every(el=>!['auto','scroll'].includes(getComputedStyle(el).overflowY))),'Nested panel scrollports were introduced');
 await sidebar.focus();await page.keyboard.press('Home');await page.waitForFunction(id=>document.getElementById(id).scrollTop===0,id);
 await page.keyboard.press('PageDown');await page.waitForFunction(id=>document.getElementById(id).scrollTop>0,id);
 await page.keyboard.press('End');await page.waitForFunction(id=>{const el=document.getElementById(id);return el.scrollTop>=el.scrollHeight-el.clientHeight-1;},id);
 unchangedMain(before,await metrics(page));
}
try {
 for(const [width,height,theme]of [[1366,768,'light'],[1440,900,'dark'],[1920,1080,'light'],[2560,1440,'dark'],[1366,480,'light'],[1366,360,'light'],[1280,720,'light']]) {
  const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'});
  await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   requests.push(url.pathname);
   if(url.pathname==='/api/rss')return route.fulfill({json:{data:{items,feeds}}});
   if(url.pathname==='/api/hot/catalog')return route.fulfill({json:{data:catalog}});
   if(url.pathname.startsWith('/api/hot/')) {
    const id=url.pathname.split('/').pop(),name=catalog.find(c=>c.id===id)?.title;
    return route.fulfill({json:{source_label:'测试数据',data:Array.from({length:15},(_,i)=>({title:`${name} · 第 ${i+1} 条：城市公共空间如何让日常出行更舒适？从街道更新到公共交通，看看这些关于生活与设计的新观察。`,url:`https://news.example/${id}/${i}`}))}});
   }
   return route.fulfill({status:404,body:''});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.fixtureReady&&document.querySelectorAll('.hot-item').length===60);
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>scrollTo(0,400));
  await scrollSide(page,'leftSidebar','rightSidebar');await scrollSide(page,'rightSidebar','leftSidebar');
  assert.equal(errors.length,0);
  if(screenshots&&[1366,1440,1920].includes(width))await page.screenshot({path:join(screenshots,`hot-scroll-${width}x${height}-${theme}.png`)});
  const refresh=page.locator('#leftSidebar .hot-panel-refresh').last();
  const count=requests.filter(path=>path==='/api/hot/weibo').length;
  await refresh.focus();await refresh.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#leftSidebar .hot-item').length===30);
  assert.equal(requests.filter(path=>path==='/api/hot/weibo').length,count+1,'Keyboard refresh failed');
  const rightRefresh=page.locator('#rightSidebar .hot-panel-refresh').last();
  const rightCount=requests.filter(path=>path==='/api/hot/bili').length;
  await rightRefresh.click();await page.waitForFunction(()=>document.querySelectorAll('#rightSidebar .hot-item').length===30);
  assert.equal(requests.filter(path=>path==='/api/hot/bili').length,rightCount+1,'Sticky refresh is covered by fixed page tools');
  await page.setViewportSize({width:1260,height});assert(!(await page.locator('#leftSidebar').isVisible()));assert(!(await page.locator('#rightSidebar').isVisible()));
  results.push({width,height,theme,independentScroll:true,lastItemsVisible:true,noWheelChaining:true,keyboardScrollAndRefresh:true});
  await context.close();
 }
 console.log(JSON.stringify(results,null,2));
 console.log('✓ Whole-side scrolling: viewport bounds, both last-ranked items, wheel containment, sticky titles, keyboard, themes and existing narrow breakpoint');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
