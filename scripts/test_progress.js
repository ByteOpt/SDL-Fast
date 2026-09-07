'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { probe } = require('../desktop/src/main/net');
const { HttpDownloader } = require('../desktop/src/main/http-downloader');
const { taskProgress } = require('../desktop/src/main/manager');

const DIR = path.join(__dirname, '_progress_tmp');
const SIZE = 512 * 1024;
const UA = { 'User-Agent': 'SDL-Fast-Test', Accept: '*/*' };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/file.bin` });
    });
    server.on('error', reject);
  });
}

function writeSlow(res, size) {
  let sent = 0;
  const chunk = 32 * 1024;
  const tick = () => {
    if (sent >= size) {
      res.end();
      return;
    }
    const n = Math.min(chunk, size - sent);
    res.write(Buffer.alloc(n, 7));
    sent += n;
    setTimeout(tick, 25);
  };
  tick();
}

async function download(url, connections) {
  fs.mkdirSync(DIR, { recursive: true });
  const dest = path.join(DIR, `out-${Date.now()}.bin`);
  const info = await probe(url, UA);
  const task = {
    url: info.url || url,
    savePath: dest,
    connections,
    headers: UA,
    size: info.size,
    downloaded: 0,
    ranges: null,
  };
  const samples = [];
  const dl = new HttpDownloader(task, {
    onProgress() {
      samples.push({
        downloaded: task.downloaded || 0,
        size: task.size || 0,
        progress: taskProgress(task),
      });
    },
  });
  await dl.run(info);
  return { info, task, dest, samples };
}

async function testMath() {
  assert(taskProgress({ status: 'completed', downloaded: 0, size: 0 }) === 100, 'done=100');
  assert(taskProgress({ status: 'downloading', downloaded: 25, size: 100 }) === 25, '25%');
  assert(taskProgress({ status: 'downloading', downloaded: 0, size: 100 }) === 0, '0%');
  assert(taskProgress({ status: 'downloading', downloaded: 10, size: 0, progressHint: 40 }) === 40, 'hint');
  assert(taskProgress({ status: 'downloading', downloaded: 10, size: 0 }) === 0, 'unknown');
}

async function testIgnoreRange() {
  const { server, url } = await listen((req, res) => {
    if (req.headers.range) {
      res.writeHead(200, {
        'Content-Length': SIZE,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
      });
      if (req.headers.range === 'bytes=0-0') {
        res.end(Buffer.alloc(SIZE, 1));
        return;
      }
      writeSlow(res, SIZE);
      return;
    }
    res.writeHead(200, {
      'Content-Length': SIZE,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
    });
    writeSlow(res, SIZE);
  });
  try {
    const { info, task, dest, samples } = await download(url, 8);
    assert(info.acceptRanges === false, '200+Accept-Ranges must not enable multi-range');
    assert(info.size === SIZE, 'probe size');
    assert(fs.statSync(dest).size === SIZE, 'file size');
    const mid = samples.filter((s) => s.downloaded > 0 && s.downloaded < SIZE && s.progress > 0 && s.progress < 100);
    assert(mid.length > 0, 'progress must move before complete when range is ignored');
    assert(taskProgress(Object.assign({ status: 'downloading' }, task)) === 100 || task.downloaded === SIZE, 'finished bytes');
  } finally {
    server.close();
  }
}

async function testFakePartialThenFull() {
  const { server, url } = await listen((req, res) => {
    const range = req.headers.range || '';
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'Content-Range': `bytes 0-0/${SIZE}`,
        'Content-Length': 1,
        'Accept-Ranges': 'bytes',
      });
      res.end(Buffer.alloc(1));
      return;
    }
    if (range) {
      res.writeHead(200, { 'Content-Length': SIZE, 'Accept-Ranges': 'bytes' });
      res.end(Buffer.alloc(SIZE, 2));
      return;
    }
    res.writeHead(200, { 'Content-Length': SIZE });
    writeSlow(res, SIZE);
  });
  try {
    const started = Date.now();
    const { info, dest, samples } = await download(url, 8);
    const ms = Date.now() - started;
    assert(info.status === 206 && info.acceptRanges === true, `probe 206 is ranged got ${info.status} size=${info.size} range=${info.acceptRanges}`);
    assert(fs.statSync(dest).size === SIZE, 'fallback file size');
    assert(ms < 15000, 'must not download discarded 200 bodies');
    const mid = samples.filter((s) => s.progress > 0 && s.progress < 100);
    assert(mid.length > 0, 'fallback to whole file must still report progress');
  } finally {
    server.close();
  }
}

async function main() {
  fs.rmSync(DIR, { recursive: true, force: true });
  await testMath();
  await testIgnoreRange();
  await testFakePartialThenFull();
  fs.rmSync(DIR, { recursive: true, force: true });
  process.stdout.write('PROGRESS_OK\n');
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
