// 用户提供的 RSS URL 不能使用会自行重新解析域名/自动重定向的 fetch。
// 每跳先验证所有 DNS 结果，再把结果绑定到此次 socket lookup，保留原域名的 Host/SNI。
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import ipaddr from 'ipaddr.js';

const IPV6_GLOBAL = ipaddr.parse('2000::');
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_BYTES = 2 * 1024 * 1024;
const hostnameOf = url => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
const machineAddresses = () => Object.values(networkInterfaces()).flat().filter(Boolean).map(item => item.address);

export function isPublicRssAddress(address) {
  // net.isIP 严格接受标准地址；ipaddr 再区分保留、私有、隧道和映射地址。
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(IPV6_GLOBAL, 3));
}

function parseUrl(raw) {
  if (String(raw).length > 4096) throw new Error('bad_url');
  const url = new URL(String(raw));
  const host = hostnameOf(url).toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('bad_url');
  if (isIP(host) && !isPublicRssAddress(host)) throw new Error('non_public_address');
  url.hash = '';
  return url;
}

export function isSafeFeedUrl(raw) {
  try { parseUrl(raw); return true; } catch { return false; }
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', aborted); resolve(value);
    }, error => {
      signal.removeEventListener('abort', aborted); reject(error);
    });
  });
}

function canonicalAddress(address) {
  return isIP(address) ? ipaddr.parse(address).toNormalizedString() : '';
}

async function resolvePublicAddresses(url, lookup, localAddresses, signal) {
  signal.throwIfAborted();
  const host = hostnameOf(url);
  const addresses = isIP(host) ? [{ address: host }] : await abortable(lookup(host, { all: true, verbatim: true }), signal);
  signal.throwIfAborted();
  const local = new Set(localAddresses().map(canonicalAddress).filter(Boolean));
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !item || !isIP(item.address))) throw new Error('non_public_address');
  // 某些 DNS 代理同时给出公网 A 和私有 AAAA；仅把公网子集交给 socket。
  // 连接失败也不能重新系统解析或回退到被排除的私有/本机地址。
  const approved = addresses.filter(item => isPublicRssAddress(item.address) && !local.has(canonicalAddress(item.address)));
  if (!approved.length) throw new Error('non_public_address');
  return approved.map(({ address }) => ({ address, family: isIP(address) }));
}

function openRequest(url, addresses, request, signal, headers) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      signal,
      headers,
      // 支持正常的 IPv4/IPv6 连接回退，但所有候选均来自本次已验证的解析。
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
      lookup: (_host, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    });
    req.once('response', response => resolve({ req, response }));
    req.once('error', reject);
    req.end();
  });
}

async function readBody(response, maxBytes, signal) {
  const advertised = Number(response.headers['content-length']);
  if (Number.isFinite(advertised) && advertised > maxBytes) throw new Error('rss_body_too_large');
  const encodings = String(response.headers['content-encoding'] || 'identity').toLowerCase().split(',').map(value => value.trim()).reverse();
  if (encodings.length > 2) throw new Error('unsupported_content_encoding');
  const decoders = encodings.filter(value => value !== 'identity').map(value => {
    if (value === 'gzip' || value === 'x-gzip') return createGunzip();
    if (value === 'deflate') return createInflate();
    if (value === 'br') return createBrotliDecompress();
    throw new Error('unsupported_content_encoding');
  });
  const chunks = [];
  let wireBytes = 0, decodedBytes = 0;
  const wireLimit = new Transform({ transform(chunk, _encoding, done) {
    wireBytes += chunk.length;
    done(wireBytes > maxBytes ? new Error('rss_body_too_large') : null, chunk);
  } });
  const collector = new Writable({ write(chunk, _encoding, done) {
    decodedBytes += chunk.length;
    if (decodedBytes > maxBytes) { done(new Error('rss_body_too_large')); return; }
    chunks.push(chunk); done();
  } });
  // pipeline 将源、解压器和收集器的错误/abort 双向传播并销毁所有流。
  await pipeline(response, wireLimit, ...decoders, collector, { signal });
  return Buffer.concat(chunks, decodedBytes);
}

// 注入点只用于无外部请求的安全回归；生产导出使用系统解析器和 Node 原生 HTTP/TLS。
export function createRssFetcher({ lookup = dnsLookup, requestHttp = httpRequest, requestHttps = httpsRequest, localAddresses = machineAddresses } = {}) {
  return async function fetchRssBuffer(raw, { timeoutMs = 12000, maxBytes = MAX_BYTES, maxRedirects = 5, userAgent = 'Mozilla/5.0 (RSS Reader)' } = {}) {
    let url = parseUrl(raw);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('rss_timeout')), timeoutMs);
    try {
      for (let redirects = 0;; redirects++) {
        const addresses = await resolvePublicAddresses(url, lookup, localAddresses, controller.signal);
        const { req, response } = await openRequest(url, addresses, url.protocol === 'https:' ? requestHttps : requestHttp, controller.signal, {
          'User-Agent': userAgent,
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'Accept-Encoding': 'gzip, deflate, br',
        });
        try {
          if (REDIRECTS.has(response.statusCode)) {
            if (redirects >= maxRedirects) throw new Error('too_many_redirects');
            if (typeof response.headers.location !== 'string') throw new Error('bad_redirect');
            url = parseUrl(new URL(response.headers.location, url).href);
            continue;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('HTTP ' + response.statusCode);
          const buffer = await readBody(response, maxBytes, controller.signal);
          controller.signal.throwIfAborted();
          return { buffer, url: url.href };
        } finally {
          response.destroy();
          req.destroy();
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

export const fetchRssBuffer = createRssFetcher();
