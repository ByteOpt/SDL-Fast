'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { request, readBody } = require('./net');

function resolveUri(base, uri) {
  if (/^https?:/i.test(uri)) return uri;
  return new URL(uri, base).href;
}

function parseAttr(line) {
  const out = {};
  const body = line.replace(/^#EXT[^:]+:/, '');
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[3] != null ? m[3] : m[2];
  return out;
}

async function fetchText(url, headers) {
  const { res, url: finalUrl } = await request(url, { headers, timeout: 20000 });
  if (res.statusCode >= 400) {
    res.resume();
    throw new Error(`播放列表 HTTP ${res.statusCode}`);
  }
  const buf = await readBody(res);
  return { text: buf.toString('utf8'), url: finalUrl };
}

function pickVariant(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const attr = parseAttr(lines[i]);
    const bw = parseInt(attr.BANDWIDTH, 10) || 0;
    const uri = lines[i + 1] && !lines[i + 1].startsWith('#') ? lines[i + 1].trim() : '';
    if (!uri) continue;
    if (!best || bw > best.bw) best = { bw, url: resolveUri(baseUrl, uri) };
  }
  return best;
}

function parseMedia(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let key = null;
  let seq = 0;
  let mediaSeq = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSeq = parseInt(line.split(':')[1], 10) || 0;
      seq = mediaSeq;
    } else if (line.startsWith('#EXT-X-KEY')) {
      const attr = parseAttr(line);
      if ((attr.METHOD || 'NONE') === 'NONE') key = null;
      else key = {
        method: attr.METHOD,
        uri: attr.URI ? resolveUri(baseUrl, attr.URI) : '',
        iv: attr.IV || '',
      };
    } else if (line.startsWith('#EXTINF')) {
      let uri = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith('#')) { uri = lines[j].trim(); i = j; break; }
      }
      if (uri) {
        segments.push({ url: resolveUri(baseUrl, uri), seq, key });
        seq += 1;
      }
    }
  }
  return segments;
}

function ivFor(segment) {
  if (segment.key && segment.key.iv) {
    return Buffer.from(segment.key.iv.replace(/^0x/i, ''), 'hex');
  }
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(segment.seq, 12);
  return buf;
}

class HlsDownloader {
  constructor(task, hooks, ffmpegPath) {
    this.task = task;
    this.hooks = hooks;
    this.ffmpegPath = ffmpegPath;
    this.alive = true;
    this.abort = new AbortController();
  }

  stop() {
    this.alive = false;
    try { this.abort.abort(); } catch { /* ignore */ }
    this.abort = new AbortController();
  }

  async run() {
    const headers = this.task.headers || {};
    let { text, url } = await fetchText(this.task.url, headers);
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = pickVariant(text, url);
      if (!variant) throw new Error('未找到可用清晰度');
      const next = await fetchText(variant.url, headers);
      text = next.text;
      url = next.url;
    }
    if (!text.includes('#EXTINF')) throw new Error('不是有效的 HLS 播放列表');
    const segments = parseMedia(text, url);
    if (!segments.length) throw new Error('播放列表没有分片');

    const dest = this.task.savePath;
    const tsPath = dest.replace(/\.[^.]+$/, '') + '.ts';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(tsPath);
    const keyCache = new Map();
    const concurrency = Math.min(16, this.task.connections || 8);
    this.task.size = segments.length;
    this.task.downloaded = 0;

    const results = new Map();
    let next = 0;
    let written = 0;
    const runWorker = async () => {
      while (this.alive) {
        const i = next++;
        if (i >= segments.length) return;
        const buf = await this.fetchSegment(segments[i], headers, keyCache);
        results.set(i, buf);
        while (results.has(written)) {
          out.write(results.get(written));
          results.delete(written);
          written += 1;
          this.task.downloaded = written;
          this.hooks.onProgress();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
    await new Promise((resolve, reject) => {
      out.on('error', reject);
      out.end(resolve);
    });

    if (this.ffmpegPath && fs.existsSync(this.ffmpegPath)) {
      this.task.status = 'merging';
      this.hooks.onProgress();
      await runFfmpeg(this.ffmpegPath, tsPath, dest);
      try { fs.unlinkSync(tsPath); } catch { /* ignore */ }
    } else if (path.extname(dest).toLowerCase() !== '.ts') {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(tsPath, dest.replace(/\.[^.]+$/, '.ts'));
      this.task.savePath = dest.replace(/\.[^.]+$/, '.ts');
      this.task.filename = path.basename(this.task.savePath);
    }
    this.task.downloaded = this.task.size;
  }

  async fetchSegment(segment, headers, keyCache) {
    const retries = 4;
    let lastErr;
    for (let i = 0; i < retries; i++) {
      if (!this.alive) throw new Error('aborted');
      try {
        const { res } = await request(segment.url, { headers, signal: this.abort.signal, timeout: 30000 });
        if (res.statusCode >= 400) {
          res.resume();
          throw new Error(`分片 HTTP ${res.statusCode}`);
        }
        let buf = await readBody(res, 32 * 1024 * 1024);
        if (segment.key && segment.key.method === 'AES-128') {
          const key = await this.loadKey(segment.key.uri, headers, keyCache);
          const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivFor(segment));
          buf = Buffer.concat([decipher.update(buf), decipher.final()]);
        }
        return buf;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw lastErr || new Error('分片下载失败');
  }

  async loadKey(uri, headers, cache) {
    if (cache.has(uri)) return cache.get(uri);
    const { res } = await request(uri, { headers, timeout: 15000 });
    const key = await readBody(res, 64);
    cache.set(uri, key);
    return key;
  }
}

function runFfmpeg(bin, input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-y', '-i', input, '-c', 'copy', output], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `ffmpeg 退出 ${code}`));
    });
  });
}

module.exports = { HlsDownloader };
