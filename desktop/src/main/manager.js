'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { HttpDownloader } = require('./http-downloader');
const { HlsDownloader } = require('./hls-downloader');
const { probe } = require('./net');
const { classify, filenameFromUrl, sanitizeFilename, isHuggingFace } = require('./classify');
const ytdlp = require('./ytdlp');

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatEta(downloaded, size, speed) {
  if (!size || !speed) return '';
  const left = (size - downloaded) / speed;
  if (!Number.isFinite(left) || left < 0) return '';
  const s = Math.round(left);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function accrueActive(task) {
  if (!task._runStart) return;
  task.activeMs = (task.activeMs || 0) + Math.max(0, Date.now() - task._runStart);
  task._runStart = 0;
}

function taskProgress(task) {
  if (task.status === 'completed') return 100;
  if (task.size > 0) return Math.min(100, ((task.downloaded || 0) / task.size) * 100);
  if (task.progressHint > 0) return Math.min(100, Number(task.progressHint) || 0);
  return 0;
}

function computeAvgSpeed(task) {
  const bytes = Number(task.size || task.downloaded || 0);
  if (bytes <= 0) return 0;
  if (task.avgSpeed > 0) return Math.round(task.avgSpeed);
  const ms = task.activeMs
    || (task.finishedAt && (task.startedAt || task.createdAt)
      ? task.finishedAt - (task.startedAt || task.createdAt)
      : 0);
  if (ms < 1) return 0;
  return Math.max(1, Math.round(bytes / (ms / 1000)));
}

class Manager extends EventEmitter {
  constructor(store, userData) {
    super();
    this.store = store;
    this.userData = userData;
    this.runners = new Map();
    this.speeds = new Map();
    this.tasks = store.tasks.map((t) => this.hydrate(t));
    this.timer = setInterval(() => this.tickSpeed(), 1000);
  }

  hydrate(raw) {
    return Object.assign({
      downloaded: 0,
      speed: 0,
      eta: '',
      progress: 0,
      error: '',
      headers: {},
    }, raw, {
      status: raw.status === 'downloading' || raw.status === 'merging' ? 'paused' : raw.status,
    });
  }

  persist() {
    this.store.tasks = this.tasks;
    this.store.saveTasks();
  }

  snapshot() {
    return this.tasks.map((t) => ({
      id: t.id,
      url: t.url,
      filename: t.filename,
      savePath: t.savePath,
      category: t.category,
      kind: t.kind,
      mime: t.mime,
      size: t.size || 0,
      downloaded: t.downloaded || 0,
      status: t.status,
      error: t.error || '',
      connections: t.connections,
      speed: t.speed || 0,
      avgSpeed: computeAvgSpeed(t),
      eta: t.eta || '',
      progress: taskProgress(t),
      createdAt: t.createdAt,
      startedAt: t.startedAt || null,
      finishedAt: t.finishedAt || null,
      ranges: (t.ranges || []).map((r) => ({ start: r.start, end: r.end, done: r.done || 0 })),
      peakThreads: t.peakThreads || t.connections || 0,
    }));
  }

  totals() {
    const list = this.snapshot();
    return {
      tasks: list,
      count: list.length,
      speed: list.reduce((s, t) => s + (t.speed || 0), 0),
    };
  }

  emitChange() {
    this.emit('change', this.totals());
  }

  scheduleEmit() {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emitChange();
    }, 200);
  }

  settings() {
    return this.store.settings;
  }

  buildHeaders(extra) {
    const s = this.settings();
    const headers = Object.assign({
      'User-Agent': s.userAgent,
      Accept: '*/*',
    }, extra || {});
    if (s.hfToken) headers.Authorization = `Bearer ${s.hfToken}`;
    return headers;
  }

  add(input) {
    const s = this.settings();
    const url = String(input.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('请输入 http(s) 链接');
    const kind = input.kind || guessKind(url);
    const filename = sanitizeFilename(input.filename || filenameFromUrl(url, 'download'));
    const dir = input.dir || s.downloadDir;
    const savePath = uniquePath(path.join(dir, filename));
    const headers = this.buildHeaders(input.headers || {});
    const task = {
      id: uid(),
      url,
      filename: path.basename(savePath),
      savePath,
      category: input.category || classify(filename, input.mime, kind),
      kind,
      mime: input.mime || '',
      size: input.size || 0,
      downloaded: 0,
      status: 'queued',
      error: '',
      connections: clamp(input.connections || s.connections, 1, 64),
      headers,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      activeMs: 0,
      avgSpeed: 0,
      ranges: null,
      speed: 0,
      eta: '',
      _mark: 0,
    };
    this.tasks.unshift(task);
    this.persist();
    this.kick();
    this.emitChange();
    return task;
  }

  addMany(items) {
    return items.map((it) => this.add(it));
  }

  get(id) {
    return this.tasks.find((t) => t.id === id);
  }

  pause(id) {
    const task = this.get(id);
    if (!task) return;
    const runner = this.runners.get(id);
    if (runner) runner.stop();
    if (task.status === 'downloading' || task.status === 'merging' || task.status === 'queued') {
      accrueActive(task);
      task.status = 'paused';
    }
    this.persist();
    this.emitChange();
    this.kick();
  }

  pauseAll() {
    for (const t of this.tasks) {
      if (t.status === 'downloading' || t.status === 'queued' || t.status === 'merging') this.pause(t.id);
    }
  }

  resume(id) {
    const task = this.get(id);
    if (!task) return;
    if (task.status === 'completed') return;
    task.status = 'queued';
    task.error = '';
    this.persist();
    this.kick();
    this.emitChange();
  }

  resumeAll() {
    for (const t of this.tasks) {
      if (t.status === 'paused' || t.status === 'error') this.resume(t.id);
    }
  }

  remove(id, deleteFile) {
    const task = this.get(id);
    if (!task) return;
    this.pause(id);
    this.runners.delete(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (deleteFile && task.savePath && fs.existsSync(task.savePath)) {
      try { fs.unlinkSync(task.savePath); } catch { /* ignore */ }
    }
    const part = task.savePath + '.part';
    if (deleteFile && fs.existsSync(part)) {
      try { fs.unlinkSync(part); } catch { /* ignore */ }
    }
    this.persist();
    this.emitChange();
  }

  clearAll(deleteFile) {
    const ids = this.tasks.map((t) => t.id);
    for (const id of ids) this.remove(id, deleteFile);
  }

  clearCompleted() {
    const ids = this.tasks.filter((t) => t.status === 'completed').map((t) => t.id);
    for (const id of ids) this.remove(id, false);
  }

  kick() {
    const max = this.settings().maxActive || 3;
    const active = this.tasks.filter((t) => t.status === 'downloading' || t.status === 'merging').length;
    const slots = Math.max(0, max - active);
    const queued = this.tasks.filter((t) => t.status === 'queued');
    for (const task of queued.slice(0, slots)) this.startTask(task);
  }

  async startTask(task) {
    if (this.runners.has(task.id)) return;
    task.status = 'downloading';
    task.error = '';
    if (!task.startedAt) task.startedAt = Date.now();
    task._runStart = Date.now();
    this.emitChange();
    const hooks = {
      onProgress: () => {
        const rec = this.speeds.get(task.id) || { last: task.downloaded, speed: 0 };
        rec.seen = Date.now();
        this.speeds.set(task.id, rec);
        this.scheduleEmit();
      },
    };
    const runner = { stop() {} };
    this.runners.set(task.id, runner);
    try {
      if (task.kind === 'video-platform') {
        await this.runYtdlp(task, runner);
      } else if (task.kind === 'hls' || /\.m3u8(\?|$)/i.test(task.url)) {
        const ffmpeg = ytdlp.findFfmpeg(this.settings().ffmpegPath);
        const dl = new HlsDownloader(task, hooks, ffmpeg);
        runner.stop = () => dl.stop();
        await dl.run();
      } else if (task.kind === 'dash' || /\.mpd(\?|$)/i.test(task.url)) {
        await this.runYtdlp(task, runner);
      } else {
        const info = await probe(task.url, task.headers);
        if (info.filename && (!task.filename || task.filename === 'download')) {
          task.filename = sanitizeFilename(info.filename);
          task.savePath = uniquePath(path.join(path.dirname(task.savePath), task.filename));
        }
        if (info.size) task.size = info.size;
        if (isHuggingFace(task.url) && !task.category) task.category = 'model';
        this.emitChange();
        const dl = new HttpDownloader(task, hooks);
        runner.stop = () => dl.stop();
        await dl.run(info);
      }
      if (task.status === 'paused') {
        accrueActive(task);
        return;
      }
      accrueActive(task);
      task.status = 'completed';
      task.finishedAt = Date.now();
      task.speed = 0;
      task.eta = '';
      if (task.size) task.downloaded = task.size;
      task.avgSpeed = computeAvgSpeed(task);
    } catch (err) {
      accrueActive(task);
      if (/aborted/i.test(String(err.message))) {
        task.status = 'paused';
      } else {
        task.status = 'error';
        task.error = String(err.message || err);
      }
    } finally {
      this.runners.delete(task.id);
      this.persist();
      this.emitChange();
      this.kick();
    }
  }

  async runYtdlp(task, runner) {
    const bin = await ytdlp.ensureYtdlp(this.userData, this.settings().ytdlpPath);
    const ffmpeg = ytdlp.findFfmpeg(this.settings().ffmpegPath);
    const info = await ytdlp.probeVideo(bin, task.url, task.headers);
    if (info.title && (!task.filename || /\.mp4$/i.test(task.filename))) {
      task.filename = sanitizeFilename(info.title) + '.mp4';
    }
    const pick = ytdlp.pickFormat(info, Boolean(ffmpeg));
    let childStop = () => {};
    runner.stop = () => childStop();
    const destDir = path.dirname(task.savePath);
    const file = await ytdlp.downloadVideo(
      bin,
      task.url,
      destDir,
      task.filename,
      pick.format,
      task.headers,
      ffmpeg,
      (line) => {
        const m = /\[download\]\s+(\d+\.?\d*)%/.exec(line);
        if (m) {
          task.progressHint = parseFloat(m[1]);
          if (task.size) task.downloaded = Math.round(task.size * task.progressHint / 100);
          this.emitChange();
        }
        const sz = /of\s+~?([\d.]+[KMG]iB)/.exec(line);
        if (sz) task.sizeText = sz[1];
      },
    );
    if (file && fs.existsSync(file)) {
      task.savePath = file;
      task.filename = path.basename(file);
      task.size = fs.statSync(file).size;
      task.downloaded = task.size;
    }
  }

  tickSpeed() {
    let changed = false;
    for (const task of this.tasks) {
      const rec = this.speeds.get(task.id) || { last: task.downloaded || 0, speed: 0 };
      const now = task.downloaded || 0;
      const speed = Math.max(0, now - (rec.last || 0));
      rec.last = now;
      rec.speed = speed;
      this.speeds.set(task.id, rec);
      if (task.status === 'downloading') {
        task.speed = speed;
        task.eta = formatEta(task.downloaded, task.size, speed);
        changed = true;
      } else if (task.speed) {
        task.speed = 0;
        task.eta = '';
        changed = true;
      }
    }
    if (changed) this.emitChange();
  }
}

function guessKind(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.mpd(\?|$)/i.test(url)) return 'dash';
  if (/(youtube\.com|youtu\.be|tiktok\.com|bilibili\.com|x\.com|twitter\.com|vimeo\.com|twitch\.tv)/i.test(url)) {
    return 'video-platform';
  }
  return 'http';
}

function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  for (let i = 1; i < 9999; i++) {
    const next = `${base} (${i})${ext}`;
    if (!fs.existsSync(next)) return next;
  }
  return `${base} (${Date.now()})${ext}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, Number(n) || a));
}

module.exports = { Manager, taskProgress };
