'use strict';

const CATEGORIES = {
  video: {
    label: '视频',
    exts: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'm2ts', '3gp', 'ogv', 'rmvb', 'vob'],
  },
  music: {
    label: '音乐',
    exts: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'alac', 'aiff', 'weba', 'mid'],
  },
  program: {
    label: '程序',
    exts: ['exe', 'msi', 'dmg', 'pkg', 'apk', 'deb', 'rpm', 'appimage', 'bat', 'msix'],
  },
  archive: {
    label: '压缩文件',
    exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'cab'],
  },
  document: {
    label: '文档',
    exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'mobi', 'txt', 'csv'],
  },
  model: {
    label: '大模型',
    exts: ['gguf', 'safetensors', 'bin', 'ckpt', 'pt', 'pth', 'onnx', 'h5', 'tflite'],
  },
};

function extOf(name) {
  const src = String(name || '').split(/[?#]/)[0];
  const m = /\.([a-z0-9]{1,16})$/i.exec(src);
  return m ? m[1].toLowerCase() : '';
}

function classify(filename, mime, kind) {
  if (kind === 'hls' || kind === 'dash' || kind === 'video-platform') return 'video';
  const mimeL = String(mime || '').toLowerCase();
  if (mimeL.startsWith('video/')) return 'video';
  if (mimeL.startsWith('audio/')) return 'music';
  const ext = extOf(filename);
  for (const [id, rule] of Object.entries(CATEGORIES)) {
    if (rule.exts.includes(ext)) return id;
  }
  return 'other';
}

function filenameFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname.split('/').pop() || '');
    name = name.split('?')[0];
    if (!name || name === '/') return fallback || u.hostname.replace(/^www\./, '') || 'download';
    return name;
  } catch {
    return fallback || 'download';
  }
}

function sanitizeFilename(name) {
  const cleaned = String(name || 'download').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return (cleaned || 'download').slice(0, 180);
}

function isHuggingFace(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(huggingface\.co|hf\.co|hf-mirror\.com|modelscope\.cn)$/i.test(host)
      || /cdn-lfs|cas-bridge|hf-mirror/i.test(url);
  } catch {
    return false;
  }
}

function isSignedCdn(url) {
  return /[?&](X-Amz-Signature|X-Amz-Credential|Expires|sig|Signature)=/i.test(url);
}

module.exports = {
  CATEGORIES,
  extOf,
  classify,
  filenameFromUrl,
  sanitizeFilename,
  isHuggingFace,
  isSignedCdn,
};
