// 报价方向和图表几何共用原始末价；横轴只由完整交易时段与真实分钟决定。
const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function quoteSnapshot(points, prevClose) {
  const rawLast = Array.isArray(points) ? points.at(-1)?.p : null;
  const last = validPrice(rawLast) ? rawLast : null;
  const previous = validPrice(prevClose) ? prevClose : null;
  const change = last !== null && previous !== null ? (last - previous) / previous * 100 : null;
  const pct = Number.isFinite(change) ? change : null;
  return { last, prevClose: previous, pct, direction: pct === null ? null : pct >= 0 ? 'up' : 'down' };
}

function tradingRanges(session) {
  if (!session || typeof session.timeZone !== 'string' || !session.timeZone || !Array.isArray(session.ranges) || !session.ranges.length) return null;
  let previousEnd = -1;
  for (const range of session.ranges) {
    if (!Array.isArray(range) || range.length !== 2) return null;
    const [start, end] = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end || start < previousEnd) return null;
    previousEnd = end;
  }
  if (session.closingAuctionEnd !== undefined && (!Number.isInteger(session.closingAuctionEnd) || session.closingAuctionEnd < previousEnd || session.closingAuctionEnd > 1440)) return null;
  return session.ranges;
}

function clockMinute(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(typeof time === 'string' ? time : '');
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
}

function progressAt(time, ranges, closingAuctionEnd) {
  const minute = clockMinute(time);
  if (minute === null || minute < ranges[0][0]) return null;
  if (minute > ranges.at(-1)[1]) return closingAuctionEnd !== undefined && minute <= closingAuctionEnd ? 1 : null;
  const duration = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
  let elapsed = 0;
  for (const [start, end] of ranges) {
    if (minute < start) return elapsed / duration; // 午休不占横轴长度。
    if (minute <= end) return (elapsed + minute - start) / duration;
    elapsed += end - start;
  }
  return 1;
}

export function sessionProgress(time, session) {
  const ranges = tradingRanges(session);
  return ranges ? progressAt(time, ranges, session.closingAuctionEnd) : null;
}

// 抽稀保留原始点的时间；首尾原样留下，不能把尚未收盘的末点挪到右边。
export function thinTimedPoints(points, maxPoints) {
  const count = Math.max(2, Math.floor(maxPoints));
  if (points.length <= count) return points;
  return Array.from({ length: count }, (_, i) => points[Math.round(i * (points.length - 1) / (count - 1))]);
}

export function smoothTimedPoints(points, radius = 3) {
  if (points.length < radius * 2 + 3) return points;
  return points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return point;
    const start = Math.max(0, i - radius), end = Math.min(points.length - 1, i + radius);
    let total = 0;
    for (let j = start; j <= end; j++) total += points[j].p;
    return { ...point, p: total / (end - start + 1) };
  });
}

export function buildFinanceChart(rawPoints, prevClose, session, width, height) {
  const input = Array.isArray(rawPoints) ? rawPoints : [];
  const quote = quoteSnapshot(input, prevClose);
  const empty = { quote, points: [], baselineY: null };
  const ranges = tradingRanges(session);
  if (!ranges || quote.last === null || !Number.isFinite(width) || width < 2 || !Number.isFinite(height) || height < 9) return empty;
  const timed = [];
  for (let i = 0; i < input.length; i++) {
    const point = input[i];
    if (!validPrice(point?.p)) continue;
    const progress = progressAt(point.t, ranges, session.closingAuctionEnd);
    if (progress === null) continue;
    // 跨日或倒序数据的横轴不可安全推断；报价仍可显示。
    if (timed.length && progress < timed.at(-1).progress) return empty;
    timed.push({ t: point.t, p: point.p, progress, originalIndex: i });
  }
  // 末价没有可信的交易时间时，不画一个与报价不相符的旧尾点。
  if (!timed.length || timed.at(-1).originalIndex !== input.length - 1) return empty;
  const points = smoothTimedPoints(thinTimedPoints(timed, Math.max(60, Math.round(width))));
  const base = quote.prevClose ?? timed[0].p;
  const deviation = Math.max(...points.map(point => Math.abs(point.p - base))) || base * 0.001;
  const y = price => height - 4 - (price - (base - deviation)) / (2 * deviation) * (height - 8);
  return {
    quote,
    points: points.map(point => ({ ...point, x: point.progress * (width - 1), y: y(point.p) })),
    baselineY: quote.prevClose === null ? null : y(base),
  };
}
