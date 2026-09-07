'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_REDIRECTS = 8;

function pickAgent(u) {
  return u.protocol === 'https:' ? https : http;
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    let current = url;
    let hops = 0;

    const go = () => {
      let parsed;
      try {
        parsed = new URL(current);
      } catch (err) {
        reject(err);
        return;
      }
      const lib = pickAgent(parsed);
      const headers = Object.assign({}, options.headers || {});
      const req = lib.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers,
        timeout: options.timeout || 30000,
      }, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && hops < MAX_REDIRECTS) {
          hops += 1;
          current = new URL(res.headers.location, current).href;
          res.resume();
          go();
          return;
        }
        resolve({ res, url: current });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('请求超时'));
      });
      if (options.signal) {
        const abort = () => req.destroy(new Error('aborted'));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
      req.end();
    };
    go();
  });
}

function header(res, name) {
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(res.headers[key]) : '';
}

async function probe(url, headers) {
  const common = { headers, timeout: 20000 };
  let result = await request(url, Object.assign({ method: 'HEAD' }, common));
  if (result.res.statusCode >= 400 || !header(result.res, 'content-length')) {
    result.res.resume();
    result = await request(url, Object.assign({
      method: 'GET',
      headers: Object.assign({}, headers, { Range: 'bytes=0-0' }),
    }, { timeout: 20000 }));
  }
  const res = result.res;
  const mime = header(res, 'content-type').split(';')[0].trim();
  const acceptRanges = /bytes/i.test(header(res, 'accept-ranges')) || header(res, 'content-range');
  let size = 0;
  const cr = header(res, 'content-range');
  const m = /\/(\d+)\s*$/.exec(cr);
  if (m) size = parseInt(m[1], 10);
  else {
    const cl = parseInt(header(res, 'content-length'), 10);
    if (Number.isFinite(cl)) size = cl;
  }
  const disp = header(res, 'content-disposition');
  let filename = '';
  const fm = /filename\*?=(?:UTF-8'')?"?([^;"]+)"?/i.exec(disp);
  if (fm) {
    try { filename = decodeURIComponent(fm[1]); } catch { filename = fm[1]; }
  }
  res.resume();
  return {
    url: result.url,
    status: res.statusCode,
    mime,
    size,
    acceptRanges: Boolean(acceptRanges && size > 0),
    filename,
  };
}

function readBody(res, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    res.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        res.destroy();
        reject(new Error('响应过大'));
        return;
      }
      chunks.push(c);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

module.exports = { request, probe, header, readBody };
