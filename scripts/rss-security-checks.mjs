#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { createRssFetcher, isSafeFeedUrl, isPublicRssAddress } from '../backend/src/rss-network.js';

const PUBLIC4 = '93.184.216.34', PUBLIC6 = '2606:4700:4700::1111';
const PUBLIC = [{address:PUBLIC4,family:4},{address:PUBLIC6,family:6}];
const XML = '<rss><channel><title>Safe fixture</title></channel></rss>';
let cases = 0;
const forbidden = ['0.0.0.0','127.1.2.3','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','192.0.0.9','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','255.255.255.255','::','::1','::127.0.0.1','::ffff:127.0.0.1','::ffff:93.184.216.34','64:ff9b::7f00:1','64:ff9b:1::1','2002:7f00:1::1','2001::1','2001:db8::1','2001:2::1','fc00::1','fd00::1','fe80::1','fec0::1','ff02::1','100::1','3fff::1','5f00::1','4000::1'];
for (const address of forbidden) {
  assert.equal(isPublicRssAddress(address),false,address);
  assert.equal(isSafeFeedUrl(`http://${address.includes(':')?'['+address+']':address}/feed`),false,address);
  cases++;
}
for (const url of ['http://localhost/feed','http://localhost./feed','http://x.localhost/feed','http://2130706433/feed','http://0x7f000001/feed','http://user:pass@example.com/feed','ftp://example.com/feed','file:///etc/hosts','https://example.com/'+ 'a'.repeat(4096)]) {
  assert.equal(isSafeFeedUrl(url),false,url); cases++;
}
assert(isPublicRssAddress(PUBLIC4));assert(isPublicRssAddress(PUBLIC6));

// 请求和 DNS 均为内存 fake，不连接私网、第三方或现有服务。
function fixture({ records=()=>PUBLIC, replies=[{}], local=[], inspect }={}) {
  const queries=[], requests=[];
  const lookup=async(host,options)=>{queries.push({host,options});return typeof records==='function'?records(host,queries.length):records};
  const request=(url,options)=>{
    const req=new EventEmitter();
    const record={url:new URL(url),options,req};requests.push(record);
    const abort=()=>{req.destroy(options.signal.reason);req.emit('error',options.signal.reason)};
    req.destroy=error=>{req.destroyed=true;options.signal.removeEventListener('abort',abort);record.response?.destroy(error);return req};
    options.signal.addEventListener('abort',abort,{once:true});
    req.end=()=>queueMicrotask(async()=>{
      try {
        record.pinned=await new Promise((resolve,reject)=>options.lookup(url.hostname,{all:true},(error,addresses)=>error?reject(error):resolve(addresses)));
        record.single=await new Promise((resolve,reject)=>options.lookup(url.hostname,{},(error,address,family)=>error?reject(error):resolve({address,family})));
        if(inspect)await inspect(record);
        const reply=replies[Math.min(requests.length-1,replies.length-1)];
        if(reply.headerDelay)await delay(reply.headerDelay);
        if(req.destroyed)return;
        if(reply.noHeaders)return;
        const response=new PassThrough();response.on('error',()=>{});
        record.response=response;
        response.statusCode=reply.status??200;response.headers=reply.headers||{};
        req.emit('response',response);
        if(reply.holdBody){response.write('<rss>');return;}
        if(reply.bodyDelay)await delay(reply.bodyDelay);
        if(!response.destroyed)response.end(reply.body??XML);
      } catch(error) {req.destroy(error);req.emit('error',error);}
    });
    return req;
  };
  return {fetch:createRssFetcher({lookup,requestHttp:request,requestHttps:request,localAddresses:()=>local}),queries,requests};
}

for(const records of [[],[{address:'127.0.0.1',family:4}],[{address:'10.0.0.1',family:4},{address:'fc00::1',family:6}],[{address:PUBLIC4},{address:'not-an-ip'}]]) {
  const f=fixture({records});await assert.rejects(f.fetch('https://rss.example/feed'),/non_public_address/);assert.equal(f.requests.length,0);cases++;
}
{
  const f=fixture({local:[PUBLIC4,PUBLIC6]});await assert.rejects(f.fetch('https://rss.example/feed'),/non_public_address/);assert.equal(f.requests.length,0);
  await assert.rejects(f.fetch('http://'+PUBLIC4+'/feed'),/non_public_address/);cases++;
}
{
  const f=fixture({records:[PUBLIC[0],{address:'127.0.0.1',family:4},{address:'fc00::1',family:6},PUBLIC[1]],inspect:record=>{
    assert.deepEqual(record.pinned,PUBLIC,'all-address lookup must expose only approved public IPs');
    assert.equal(record.single.address,PUBLIC4,'single-address lookup must expose only an approved public IP');
  }});
  assert.equal((await f.fetch('https://rss.example/feed')).buffer.toString(),XML);assert.equal(f.queries.length,1);cases++;
}
{
  const f=fixture({records:[{address:'127.0.0.1',family:4},PUBLIC[0]],inspect:record=>{
    assert.deepEqual(record.pinned,[PUBLIC[0]]);assert.equal(record.single.address,PUBLIC4);
    throw new Error('ECONNREFUSED');
  }});
  await assert.rejects(f.fetch('https://rss.example/feed'),/ECONNREFUSED/);
  assert.equal(f.requests.length,1,'failed public connection must not retry via a private IP');assert.equal(f.queries.length,1);assert(f.requests[0].req.destroyed);cases++;
}
{
  let changed=false;
  const f=fixture({records:()=>changed?[{address:'127.0.0.1'}]:PUBLIC,inspect:record=>{changed=true;assert.deepEqual(record.pinned,PUBLIC);assert.equal(record.single.address,PUBLIC4);assert.equal(record.url.hostname,'rss.example');assert.equal(record.url.protocol,'https:');assert.equal(record.options.agent,false);}});
  const result=await f.fetch('https://rss.example/feed');assert.equal(result.buffer.toString(),XML);
  assert.equal(f.queries.length,1,'socket lookup must not resolve DNS a second time');assert(f.requests.every(r=>r.req.destroyed&&r.response.destroyed));cases++;
}
{
  const f=fixture({replies:[{status:302,headers:{location:'https://next.example/news.xml'}},{}]});
  const result=await f.fetch('http://rss.example/feed');assert.equal(result.url,'https://next.example/news.xml');
  assert.deepEqual(f.queries.map(q=>q.host),['rss.example','next.example']);assert(f.requests.every(r=>r.req.destroyed&&r.response.destroyed));cases++;
}
for(const target of ['http://127.0.0.1/feed','http://[::ffff:127.0.0.1]/feed','file:///etc/hosts','http://user:pass@example.com/feed']) {
  const f=fixture({replies:[{status:302,headers:{location:target}}]});await assert.rejects(f.fetch('https://rss.example/feed'));assert.equal(f.requests.length,1);assert(f.requests[0].req.destroyed);cases++;
}
{
  const f=fixture({records:(_host,count)=>count===1?PUBLIC:[{address:'127.0.0.1'}],replies:[{status:302,headers:{location:'/second'}}]});
  await assert.rejects(f.fetch('https://rss.example/feed'),/non_public_address/);assert.equal(f.requests.length,1);assert.equal(f.queries.length,2);cases++;
}
{
  const f=fixture({replies:[{status:302,headers:{location:'/again'}}]});await assert.rejects(f.fetch('https://rss.example/feed',{maxRedirects:2}),/too_many_redirects/);assert.equal(f.requests.length,3);assert(f.requests.every(r=>r.req.destroyed));cases++;
}
for(const [encoding,compress] of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]]) {
  const f=fixture({replies:[{headers:{'content-encoding':encoding},body:compress(Buffer.from(XML))}]});assert.equal((await f.fetch('https://rss.example/feed')).buffer.toString(),XML);cases++;
}
for(const reply of [
  {headers:{'content-length':'129'},body:'x'},
  {body:'x'.repeat(129)},
  {headers:{'content-encoding':'gzip'},body:gzipSync(Buffer.from('x'.repeat(10000)))},
]) {
  const f=fixture({replies:[reply]});await assert.rejects(f.fetch('https://rss.example/feed',{maxBytes:128}),/rss_body_too_large/);assert(f.requests.every(r=>r.req.destroyed&&r.response.destroyed));cases++;
}
for(const reply of [{status:503},{headers:{'content-encoding':'gzip'},body:'invalid gzip'},{headers:{'content-encoding':'unknown'}},{headers:{'content-encoding':'gzip, gzip, gzip'}}]) {
  const f=fixture({replies:[reply]});await assert.rejects(f.fetch('https://rss.example/feed'));assert(f.requests.every(r=>r.req.destroyed&&r.response.destroyed));cases++;
}
for(const reply of [{noHeaders:true},{holdBody:true}]) {
  const f=fixture({replies:[reply]});await assert.rejects(f.fetch('https://rss.example/feed',{timeoutMs:40}));assert(f.requests.every(r=>r.req.destroyed));cases++;
}
{
  let finishLookup;
  const f=fixture({records:()=>new Promise(resolve=>{finishLookup=resolve})});
  await assert.rejects(f.fetch('https://rss.example/feed',{timeoutMs:40}),/rss_timeout/);assert.equal(f.requests.length,0);
  finishLookup(PUBLIC);await delay(10);assert.equal(f.requests.length,0,'late DNS result must not start a socket');cases++;
}
{
  const f=fixture({replies:[{headerDelay:30,status:302,headers:{location:'/again'}},{headerDelay:30}]});
  await assert.rejects(f.fetch('https://rss.example/feed',{timeoutMs:45}));assert(f.requests.every(r=>r.req.destroyed));cases++;
}
console.log(`✓ RSS security: ${cases} cases; public-only DNS pinning, mixed/private address exclusion, redirect revalidation, total deadlines, decompression bounds and cleanup`);
