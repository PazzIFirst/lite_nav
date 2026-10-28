// 保留每个源内部的时间顺序；跨源交错，最多连续两篇来自同一源。
export const rssSourceKey = item => item.feed || item.source || 'unknown';

export function mixRssItems(input) {
  const queues = new Map();
  for (const item of input) {
    const key = rssSourceKey(item);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(item);
  }
  for (const queue of queues.values()) queue.sort((a, b) => (b.time || 0) - (a.time || 0));
  const items = [];
  let last = '', run = 0, remaining = input.length;
  while (remaining) {
    const candidates = [...queues].filter(([key, queue]) => queue.length && !(key === last && run === 2));
    if (!candidates.length) break;
    // 预留足够的其他来源作间隔，避免先耗尽小来源后剩下连续的大来源。
    const viable = candidates.filter(([key]) => {
      const nextRun = key === last ? run + 1 : 1, total = remaining - 1;
      return [...queues].every(([other, queue]) => {
        const count = queue.length - Number(other === key);
        const capacity = 2 * (total - count) + (other === key ? 2 - nextRun : 2);
        return count <= capacity;
      });
    });
    const choices = viable.length ? viable : candidates;
    choices.sort(([a, aq], [b, bq]) =>
      (viable.length ? Number(a === last) - Number(b === last) : bq.length - aq.length) ||
      (bq[0].time || 0) - (aq[0].time || 0));
    const [key, queue] = choices[0];
    items.push(queue.shift());
    run = key === last ? run + 1 : 1;
    last = key;
    remaining--;
  }
  // 无法交错的单源尾部由界面合并成一个折叠索引，不静默丢掉内容。
  return { items, deferred: [...queues.values()].flat() };
}
