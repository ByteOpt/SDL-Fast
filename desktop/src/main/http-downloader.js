'use strict';

const fs = require('fs');
const path = require('path');
const { request, header } = require('./net');
const { isHuggingFace, isSignedCdn } = require('./classify');

function planConnections(size, requested, url) {
  if (!size || size < 256 * 1024) return 1;
  let max = Math.min(64, requested || 16);
  if (isSignedCdn(url) && !isHuggingFace(url)) max = Math.min(max, 8);
  if (isHuggingFace(url)) max = Math.min(64, Math.max(max, 16));
  const minChunk = isHuggingFace(url) ? 4 * 1024 * 1024 : 256 * 1024;
  return Math.max(1, Math.min(max, Math.ceil(size / minChunk)));
}

function splitRanges(size, n) {
  const ranges = [];
  const chunk = Math.floor(size / n);
  for (let i = 0; i < n; i++) {
    const start = i * chunk;
    const end = i === n - 1 ? size - 1 : start + chunk - 1;
    ranges.push({ start, end, done: 0 });
  }
  return ranges;
}

function remaining(range) {
  return range.end - range.start + 1 - (range.done || 0);
}

class HttpDownloader {
  constructor(task, hooks) {
    this.task = task;
    this.hooks = hooks;
    this.abort = new AbortController();
    this.fd = null;
    this.alive = true;
    this.activeThreads = 0;
    this.peakThreads = 0;
  }

  stop() {
    this.alive = false;
    try { this.abort.abort(); } catch { /* ignore */ }
    this.abort = new AbortController();
  }

  async run(info) {
    const task = this.task;
    const dest = task.savePath;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const size = info.size || 0;
    const finalUrl = info.url || task.url;
    const canRange = info.acceptRanges && size > 0;

    if (!canRange) {
      await this.downloadWhole(finalUrl);
      task.connections = 1;
      return;
    }

    const n = planConnections(size, task.connections, task.url);
    const reuse = Array.isArray(task.ranges)
      && task.ranges.length === n
      && task.size === size
      && task.ranges.some((r) => r.done > 0);
    if (!reuse) task.ranges = splitRanges(size, n);
    task.size = size;
    task.connections = n;
    this.recount();
    this.hooks.onProgress();

    const exists = fs.existsSync(dest);
    this.fd = await fs.promises.open(dest, exists && reuse ? 'r+' : 'w+');
    if (!(exists && reuse)) await this.fd.truncate(size);

    try {
      const workers = task.ranges.map((range, idx) => this.downloadRange(finalUrl, range, idx));
      await Promise.all(workers);
    } catch (err) {
      if (/no-range/i.test(String(err.message))) {
        this.stop();
        this.alive = true;
        this.abort = new AbortController();
        if (this.fd) {
          await this.fd.close();
          this.fd = null;
        }
        task.ranges = null;
        task.connections = 1;
        await this.downloadWhole(finalUrl);
        return;
      }
      throw err;
    } finally {
      if (this.fd) {
        await this.fd.close();
        this.fd = null;
      }
    }
    task.downloaded = size;
    task.peakThreads = this.peakThreads;
  }

  async downloadWhole(url) {
    const dest = this.task.savePath;
    const tmp = dest + '.part';
    const existing = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    const headers = Object.assign({}, this.task.headers);
    if (existing > 0) headers.Range = `bytes=${existing}-`;
    const { res } = await request(url, { headers, signal: this.abort.signal, timeout: 60000 });
    if (res.statusCode >= 400) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode}`);
    }
    const flags = res.statusCode === 206 ? 'a' : 'w';
    const cl = parseInt(header(res, 'content-length'), 10);
    if (res.statusCode === 206) {
      const cr = header(res, 'content-range');
      const total = /\/(\d+)\s*$/.exec(cr);
      if (total) this.task.size = parseInt(total[1], 10);
    } else if (Number.isFinite(cl) && cl > 0) {
      this.task.size = flags === 'a' ? existing + cl : cl;
    }
    const stream = fs.createWriteStream(tmp, { flags });
    let got = flags === 'a' ? existing : 0;
    this.task.downloaded = got;
    this.hooks.onProgress();
    this.activeThreads = 1;
    this.peakThreads = 1;
    await new Promise((resolve, reject) => {
      res.on('data', (chunk) => {
        got += chunk.length;
        this.task.downloaded = got;
        this.hooks.onProgress();
      });
      res.on('error', reject);
      stream.on('error', reject);
      stream.on('finish', resolve);
      res.pipe(stream);
    });
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(tmp, dest);
    this.task.size = got;
    this.task.downloaded = got;
  }

  async downloadRange(url, range, idx) {
    const retries = isHuggingFace(this.task.url) ? 8 : 5;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (!this.alive) throw new Error('aborted');
      if (remaining(range) <= 0) return;
      try {
        await this.pullRange(url, range, idx);
        return;
      } catch (err) {
        if (!this.alive || /aborted/i.test(String(err.message))) throw err;
        if (/no-range/i.test(String(err.message))) throw err;
        await sleep(400 * (attempt + 1));
      }
    }
    throw new Error(`分段 ${idx + 1} 多次失败`);
  }

  async pullRange(url, range) {
    const from = range.start + (range.done || 0);
    const to = range.end;
    if (from > to) return;
    const headers = Object.assign({}, this.task.headers, { Range: `bytes=${from}-${to}` });
    const { res } = await request(url, { headers, signal: this.abort.signal, timeout: 60000 });
    if (res.statusCode === 200) {
      try { res.destroy(); } catch { /* ignore */ }
      throw new Error('no-range');
    }
    if (res.statusCode !== 206) {
      try { res.destroy(); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.statusCode}`);
    }
    this.activeThreads += 1;
    this.peakThreads = Math.max(this.peakThreads, this.activeThreads);
    try {
      await new Promise((resolve, reject) => {
        let offset = from;
        res.on('data', (chunk) => {
          if (!this.alive) {
            res.destroy();
            return;
          }
          const buf = Buffer.from(chunk);
          fs.writeSync(this.fd.fd, buf, 0, buf.length, offset);
          offset += buf.length;
          range.done = offset - range.start;
          this.recount();
          this.hooks.onProgress();
        });
        res.on('end', () => {
          if (offset < to + 1 && this.alive) reject(new Error('分段中断'));
          else resolve();
        });
        res.on('error', reject);
      });
    } finally {
      this.activeThreads = Math.max(0, this.activeThreads - 1);
    }
  }

  recount() {
    this.task.downloaded = (this.task.ranges || []).reduce((s, r) => s + (r.done || 0), 0);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { HttpDownloader, planConnections };
