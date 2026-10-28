import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../frontend/js/rss-flow.js', import.meta.url), 'utf8');
const { mixRssItems } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let cases = 0;
function verify(counts) {
  const input = counts.flatMap((count, source) => Array.from({length:count}, (_, i) => ({feed:String(source), title:source + '-' + i, time:1000 - source * 100 - i})));
  // Input deliberately puts all of each source together; pagination must not reset the run.
  const {items, deferred} = mixRssItems(input);
  const combined = [...items, ...deferred];
  assert.equal(new Set(combined).size, input.length);
  assert.deepEqual(new Set(combined), new Set(input));
  for (let i = 2; i < items.length; i++) assert(!(items[i].feed === items[i-1].feed && items[i].feed === items[i-2].feed), counts.join(','));
  for (let source = 0; source < counts.length; source++) {
    assert.deepEqual(combined.filter(it => it.feed === String(source)), input.filter(it => it.feed === String(source)));
  }
  const feasible = counts.every(n => n <= 2 * (input.length - n + 1));
  if (feasible) assert.equal(deferred.length, 0, counts.join(','));
  else assert.equal(items.length, input.length - Math.max(...counts) + Math.min(Math.max(...counts), 2 * (input.length - Math.max(...counts) + 1)));
  cases++;
}
for (let a=0;a<=12;a++) for(let b=0;b<=12;b++) for(let c=0;c<=8;c++) for(let d=0;d<=4;d++) verify([a,b,c,d]);
verify([8,8,8,8,8]); verify(Array(20).fill(8)); verify([40]);
const byTime = mixRssItems([{feed:'a',time:1},{feed:'b',time:4},{feed:'a',time:3},{feed:'b',time:2}]);
assert.deepEqual(byTime.items.map(i=>i.time),[4,3,2,1]);
console.log(`✓ RSS source mixing: ${cases} distributions; no triples, source order, no dropped entries, maximum feasible output`);
