'use strict';

const fs = require('fs');
const path = require('path');
const { probe } = require('../desktop/src/main/net');
const { HttpDownloader } = require('../desktop/src/main/http-downloader');

const OUT = path.join(__dirname, '_accel_result.txt');
const DIR = path.join(__dirname, '_accel_tmp');

const URLS = [
  'https://mirrors.cloud.tencent.com/nodejs-release/v20.17.0/node-v20.17.0-headers.tar.gz',
  'https://registry.npmmirror.com/typescript/-/typescript-5.6.3.tgz',
  'https://speed.cloudflare.com/__down?bytes=8388608',
];

function log(lines) {
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
}

async function tryOne(url, connections) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SDL-Fast-Test',
    Accept: '*/*',
  };
  const info = await probe(url, headers);
  const dest = path.join(DIR, 'part.bin');
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  const task = {
    url: info.url || url,
    savePath: dest,
    connections,
    headers,
    size: info.size,
    downloaded: 0,
    ranges: null,
  };
  const started = Date.now();
  const dl = new HttpDownloader(task, { onProgress() {} });
  await dl.run(info);
  const ms = Date.now() - started;
  const stat = fs.statSync(dest);
  return {
    url,
    status: info.status,
    acceptRanges: info.acceptRanges,
    probeSize: info.size,
    fileSize: stat.size,
    connections: task.connections,
    peakThreads: dl.peakThreads || task.peakThreads || 0,
    ranges: (task.ranges || []).length,
    ms,
    ok: info.size ? stat.size === info.size : stat.size > 0,
  };
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const lines = [];
  let lastErr = '';
  for (const url of URLS) {
    try {
      const r = await tryOne(url, 8);
      lines.push(JSON.stringify(r, null, 2));
      if (r.ok && r.acceptRanges && r.connections > 1) {
        lines.push('ACCEL_OK');
        log(lines);
        process.exit(0);
      }
      if (r.ok) {
        lines.push('DOWNLOAD_OK_SINGLE');
        log(lines);
        process.exit(r.acceptRanges ? 2 : 0);
      }
    } catch (err) {
      lastErr = String(err && err.stack || err);
      lines.push('ERR ' + url + ' ' + lastErr);
    }
  }
  lines.push('FAIL ' + lastErr);
  log(lines);
  process.exit(1);
})();
