'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

function which(name, extra) {
  if (extra && fs.existsSync(extra)) return extra;
  const envPath = process.env.PATH || '';
  const exts = [''].concat((process.env.PATHEXT || '.EXE').split(';'));
  for (const dir of envPath.split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      if (fs.existsSync(full)) return full;
    }
  }
  return '';
}

function findFfmpeg(configured) {
  return which('ffmpeg', configured);
}

function bundledYtdlp(userData) {
  return path.join(userData, 'bin', 'yt-dlp.exe');
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.downloading';
    const file = fs.createWriteStream(tmp);
    const go = (u, hops) => {
      https.get(u, { headers: { 'User-Agent': 'SDL-Fast' } }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) {
          res.resume();
          go(res.headers.location, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`下载 yt-dlp 失败 HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(tmp, dest);
          resolve(dest);
        }));
      }).on('error', reject);
    };
    go(url, 0);
  });
}

async function ensureYtdlp(userData, configured) {
  const existing = which('yt-dlp', configured) || (fs.existsSync(bundledYtdlp(userData)) ? bundledYtdlp(userData) : '');
  if (existing) return existing;
  return downloadFile(YTDLP_URL, bundledYtdlp(userData));
}

function runJson(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.slice(-500) || `yt-dlp 退出 ${code}`));
        return;
      }
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('yt-dlp 输出无法解析')); }
    });
  });
}

async function probeVideo(bin, url, headers) {
  const args = ['-J', '--no-warnings', '--no-playlist', url];
  if (headers && headers.Referer) args.unshift('--add-header', `Referer:${headers.Referer}`);
  return runJson(bin, args);
}

function pickFormat(info, ffmpegOk) {
  const formats = info.formats || [];
  if (!formats.length) return { format: 'b', label: '默认' };
  if (ffmpegOk) return { format: 'bv*+ba/b', label: '最佳音视频' };
  const progressive = formats
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.ext !== 'mhtml')
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
  if (progressive[0]) {
    return {
      format: progressive[0].format_id,
      label: `${progressive[0].height || '?'}p ${progressive[0].ext}`,
    };
  }
  return { format: 'b', label: '默认' };
}

function downloadVideo(bin, url, destDir, filename, format, headers, ffmpegPath, onLine) {
  return new Promise((resolve, reject) => {
    const outTpl = path.join(destDir, filename.replace(/\.[^.]+$/, '') + '.%(ext)s');
    const args = [
      '-f', format,
      '--no-warnings',
      '--no-playlist',
      '-o', outTpl,
      '--newline',
      url,
    ];
    if (ffmpegPath) args.unshift('--ffmpeg-location', path.dirname(ffmpegPath));
    if (headers && headers.Referer) args.unshift('--add-header', `Referer:${headers.Referer}`);
    const p = spawn(bin, args, { windowsHide: true });
    let err = '';
    let lastFile = '';
    p.stdout.on('data', (d) => {
      const text = d.toString();
      onLine && onLine(text);
      const m = /Destination:\s+(.+)/.exec(text);
      if (m) lastFile = m[1].trim();
    });
    p.stderr.on('data', (d) => {
      const text = d.toString();
      err += text;
      onLine && onLine(text);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(err.slice(-500) || `yt-dlp 退出 ${code}`));
      else resolve(lastFile);
    });
  });
}

module.exports = {
  ensureYtdlp,
  findFfmpeg,
  probeVideo,
  pickFormat,
  downloadVideo,
};
