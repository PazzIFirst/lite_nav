#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const moduleUrl = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : new URL('../backend/src/sources/rss-parser.js', import.meta.url).href;
const { parseFeed, feedTitle } = await import(moduleUrl);

const rss = `<rss><channel><title>阅读 &amp; 观察</title><item>
<title><![CDATA[标题 &amp; &#x1F600;]]></title><link>../story?id=1&amp;lang=zh</link>
<pubDate>Thu, 29 Oct 2026 04:00:00 GMT</pubDate><dc:creator><![CDATA[作者 <b>甲</b>]]></dc:creator>
<description><![CDATA[<p>一段简短摘要。</p>]]></description>
<content:encoded><![CDATA[<p>完整内容中有字面量 </item> 和 &lt;strong&gt;。</p><img src="../photo.jpg"/><script>alert(1)</script>]]></content:encoded>
<media:thumbnail url="https://cdn.example.com/photo.jpg?a=1&amp;b=2"/></item>
<item><title>标题二</title><link>javascript:alert(1)</link><description>只有一段文字。</description></item></channel></rss>`;
const out = parseFeed(rss, 'https://example.com/feeds/rss.xml');
assert.equal(out.length, 2, 'CDATA 内的结束标签不得截断 item');
assert.equal(out[0].title, '标题 & 😀');
assert.equal(out[0].author, '作者 甲');
assert.equal(out[0].link, 'https://example.com/story?id=1&lang=zh');
assert.equal(out[0].time, Date.UTC(2026,9,29,4));
assert.equal(out[0].summary, '一段简短摘要。');
assert(out[0].content.includes('</item>') && out[0].content.includes('&lt;strong&gt;'));
assert.equal(out[0].contentFormat, 'html');
assert.equal(out[0].image, 'https://cdn.example.com/photo.jpg?a=1&b=2');
assert.equal(out[1].link, '');
assert.equal(feedTitle(rss), '阅读 & 观察');

const atom = `<atom:feed xml:base="https://example.com/blog/" xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Atom</atom:title>
<atom:entry><atom:title>纯文本</atom:title><atom:link rel="self" href="entry.xml"/><atom:link rel="alternate" href="article"/>
<atom:author><atom:name>Alice</atom:name></atom:author><atom:summary>摘要 &amp; 内容</atom:summary><atom:content type="text">&lt;b&gt;文字而非 HTML&lt;/b&gt;</atom:content><atom:updated>2026-10-29T04:00:00Z</atom:updated></atom:entry>
<atom:entry><atom:title>HTML</atom:title><atom:content type="html" xml:base="https://images.example.com/a/">&lt;p&gt;正文&lt;/p&gt;&lt;img src="image.jpg"/&gt;</atom:content></atom:entry>
<atom:entry><atom:title>XHTML</atom:title><atom:content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>段落</p></div></atom:content></atom:entry></atom:feed>`;
const atomItems = parseFeed(atom);
assert.equal(atomItems[0].link, 'https://example.com/blog/article');
assert.equal(atomItems[0].content, '<b>文字而非 HTML</b>');
assert.equal(atomItems[0].contentFormat, 'text');
assert.equal(atomItems[0].author, 'Alice');
assert.equal(atomItems[0].summary, '摘要 & 内容');
assert.equal(atomItems[1].contentBase, 'https://images.example.com/a/');
assert.equal(atomItems[1].contentFormat, 'html');
assert(atomItems[1].content.includes('<img src="image.jpg"/>'));
assert.equal(atomItems[2].contentFormat, 'html');

const caps = parseFeed('<rss><channel>' + Array.from({length:50}, (_,i)=>`<item><title>${i}</title><description><![CDATA[${'文'.repeat(90000)}]]></description></item>`).join('')+'</channel></rss>');
assert.equal(caps.length,40);assert.equal(caps[0].content.length,80000);assert(caps[0].contentTruncated);assert.equal(caps[0].summary.length,4000);
const enclosure = parseFeed('<rss><item><title>配图</title><enclosure type="image/jpeg" url="./cover.jpg"/><description>摘要</description></item></rss>', 'https://example.com/feed.xml');
assert.equal(enclosure[0].image,'https://example.com/cover.jpg');
assert.equal(parseFeed('<feed><entry><title>只有标题</title></entry></feed>')[0].content,'');
console.log('✓ RSS/Atom 内容解析:CDATA、实体、作者、摘要/正文、图片、相对地址、协议与体积限制');


// 固定分隔符不能和原文中的旧占位符混淆；非法 NUL 立即失败。
const marker = '<rss><item><title>占位符</title><description><![CDATA[__RSS_CDATA_0__ </item> &amp;]]></description></item></rss>';
assert.equal(parseFeed(marker)[0].content, '__RSS_CDATA_0__ </item> &amp;');
assert.throws(() => parseFeed('<rss>' + String.fromCharCode(0) + '</rss>'), /invalid_xml_character/);

// 在隔离子进程中施加硬期限，防止未来重引入算法退化时挂住整个测试进程。
const stressScript = `
  import { parseFeed, feedTitle } from ${JSON.stringify(moduleUrl)};
  const xml = '<rss><channel><title>__RSS_CDATA_' + '_'.repeat(1900000) + '</title><item><title>Readable</title><description><![CDATA[literal </item>]]></description></item></channel></rss>';
  const start = performance.now();
  const items = parseFeed(xml, 'https://example.com/feed');
  const title = feedTitle(xml);
  console.log(JSON.stringify({elapsedMs: Math.round(performance.now() - start), items: items.length, content: items[0]?.content, titleLength: title.length}));
`;
const stress = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', stressScript], {encoding:'utf8',timeout:3000}));
assert.equal(stress.items,1);assert.equal(stress.content,'literal </item>');assert.equal(stress.titleLength,80);
console.log(`✓ RSS parser CPU regression: 1.9 MB collision prefix parsed in ${stress.elapsedMs} ms; hard 3s process deadline`);
