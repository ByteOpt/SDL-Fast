'use strict';

const ENDPOINT = 'http://127.0.0.1:18761';
const PLATFORM = /(youtube\.com|youtu\.be|tiktok\.com|bilibili\.com|x\.com|twitter\.com|vimeo\.com|twitch\.tv|facebook\.com|instagram\.com|reddit\.com|dailymotion\.com)$/i;
const FILE_EXT = /\.(mp4|mkv|avi|mov|webm|flv|mp3|flac|wav|aac|m4a|ogg|zip|rar|7z|tar|gz|exe|msi|dmg|apk|pdf|docx?|xlsx?|pptx?|gguf|safetensors|iso)(\?|$)/i;
const STREAM_RE = /(\.m3u8|\.mpd)(\?|$)/i;
const MIN_MEDIA = 200 * 1024;

const byTab = new Map();
const tabMeta = new Map();

const CATEGORY_EXT = {
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'ts', 'm3u8', 'mpd'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'iso'],
  program: ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'],
  model: ['gguf', 'safetensors', 'bin', 'ckpt', 'pt', 'onnx'],
  other: ['torrent'],
};

const DEFAULTS = {
  takeover: true,
  categories: { video: true, audio: true, archive: true, program: true, document: true, model: true, other: true },
  customExt: [],
  minSize: 0,
};

let settings = structuredClone(DEFAULTS);

function pageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  } catch {
    return url || '';
  }
}

function isPlatform(url) {
  try {
    const u = new URL(url);
    if (!PLATFORM.test(u.hostname)) return false;
    const p = u.pathname;
    if (/youtube\.com$/i.test(u.hostname)) return /\/watch|\/shorts\//.test(p) || u.searchParams.has('v');
    if (/youtu\.be$/i.test(u.hostname)) return p.length > 1;
    if (/tiktok\.com$/i.test(u.hostname)) return /\/video\/|\/@/.test(p);
    if (/(twitter|x)\.com$/i.test(u.hostname)) return /\/status\//.test(p);
    if (/bilibili\.com$/i.test(u.hostname)) return /\/video\//.test(p);
    if (/reddit\.com$/i.test(u.hostname)) return /\/comments\//.test(p);
    return p.length > 1;
  } catch {
    return false;
  }
}

function guessName(url, ext) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname.split('/').pop() || '');
    if (!name || !name.includes('.')) name = (name || u.hostname.replace(/^www\./, '')) + (ext ? '.' + ext : '');
    return name || 'download';
  } catch {
    return 'download';
  }
}

function classify(mime, url) {
  const u = url.toLowerCase();
  if (/mpegurl/i.test(mime) || /\.m3u8/.test(u)) return { kind: 'hls', tag: '视频流(HLS)' };
  if (/dash\+xml/i.test(mime) || /\.mpd/.test(u)) return { kind: 'dash', tag: '视频流(DASH)' };
  if (/^video\//i.test(mime) || /\.(mp4|mkv|webm|flv|mov|avi)/.test(u)) return { kind: 'http', tag: '视频' };
  if (/^audio\//i.test(mime) || /\.(mp3|flac|m4a|aac|wav|ogg)/.test(u)) return { kind: 'http', tag: '音频' };
  if (/\.(zip|rar|7z|tar|gz|iso)/.test(u)) return { kind: 'http', tag: '压缩包' };
  if (/\.(exe|msi|dmg|apk)/.test(u)) return { kind: 'http', tag: '程序' };
  if (/\.(gguf|safetensors)/.test(u)) return { kind: 'http', tag: '大模型' };
  if (/\.(pdf|docx?|xlsx?|pptx?)/.test(u)) return { kind: 'http', tag: '文档' };
  return { kind: 'http', tag: '文件' };
}

function addRes(tabId, res) {
  if (tabId < 0) return;
  if (!byTab.has(tabId)) byTab.set(tabId, new Map());
  const map = byTab.get(tabId);
  const key = res.url.split('#')[0];
  if (!res.ownerPage) {
    const info = tabMeta.get(tabId);
    res.ownerPage = pageKey((info && info.pageUrl) || res.url);
  }
  if (map.has(key)) {
    const prev = map.get(key);
    if (res.size && !prev.size) prev.size = res.size;
    return;
  }
  map.set(key, res);
  badge(tabId);
}

function prune(tabId, url) {
  const map = byTab.get(tabId);
  if (!map) return;
  const cur = pageKey(url);
  for (const [k, r] of map) {
    if ((r.ownerPage || pageKey(r.url)) !== cur) map.delete(k);
  }
  badge(tabId);
}

function badge(tabId) {
  const n = byTab.get(tabId)?.size || 0;
  chrome.action.setBadgeBackgroundColor({ color: '#2f7be0' });
  const p = chrome.action.setBadgeText({ tabId, text: n ? String(Math.min(n, 99)) : '' });
  if (p && p.catch) p.catch(() => {});
}

function cleanTitle(title, url) {
  let t = (title || '').replace(/^\(\d+\+?\)\s*/, '').trim();
  t = t.replace(/\s*[|\-–—]\s*(X|Twitter|YouTube|Reddit|TikTok|哔哩哔哩).*$/i, '').trim();
  if (t) return t.slice(0, 80);
  try {
    const u = new URL(url);
    return u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop() || 'video';
  } catch {
    return 'video';
  }
}

function syncTab(tabId, url, title) {
  if (!url) return;
  const prev = tabMeta.get(tabId);
  const vp = isPlatform(url);
  tabMeta.set(tabId, { title: title || (prev && prev.title), pageUrl: url, isVideoPlatform: vp });
  prune(tabId, url);
  if (vp) {
    addRes(tabId, {
      url,
      filename: cleanTitle(title || (prev && prev.title), url).replace(/[\\/:*?"<>|]+/g, ' ') + '.mp4',
      mime: 'video/*',
      size: null,
      kind: 'video-platform',
      tag: '在线视频',
      referer: url,
      ownerPage: pageKey(url),
    });
  }
}

chrome.webRequest.onHeadersReceived.addListener((details) => {
  if (details.type === 'main_frame') return;
  const info = tabMeta.get(details.tabId);
  if (info && info.isVideoPlatform) return;
  const url = details.url;
  let mime = '', size = null, disp = '';
  for (const h of details.responseHeaders || []) {
    const n = h.name.toLowerCase();
    if (n === 'content-type') mime = h.value || '';
    else if (n === 'content-length') size = parseInt(h.value, 10);
    else if (n === 'content-disposition') disp = h.value || '';
  }
  const stream = /mpegurl|dash\+xml/i.test(mime) || STREAM_RE.test(url);
  const media = /^(video|audio)\//i.test(mime);
  const attach = /attachment/i.test(disp);
  const known = FILE_EXT.test(url);
  if (!(stream || media || attach || known)) return;
  if (/\.(ts|m4s)(\?|$)/i.test(url) && !attach) return;
  if (/videoplayback|googlevideo\.com/i.test(url) && !attach) return;
  if (/[?&](range|sq|rn|itag)=/i.test(url) && !attach) return;
  if (media && !stream && !attach && size != null && size < MIN_MEDIA) return;
  const cls = classify(mime, url);
  let filename = guessName(url, cls.kind === 'hls' || cls.kind === 'dash' ? 'mp4' : '');
  const m = /filename\*?=(?:UTF-8'')?"?([^;"]+)"?/i.exec(disp);
  if (m) {
    try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; }
  }
  addRes(details.tabId, {
    url,
    filename,
    mime,
    size: Number.isFinite(size) ? size : null,
    kind: cls.kind,
    tag: cls.tag,
    referer: (info && info.pageUrl) || details.initiator || '',
  });
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

chrome.tabs.onUpdated.addListener((tabId, ch, tab) => {
  if (!tab) return;
  if (ch.url || ch.title || ch.status === 'complete') syncTab(tabId, ch.url || tab.url, tab.title);
});
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) { byTab.delete(d.tabId); badge(d.tabId); }
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0) return;
  chrome.tabs.get(d.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    syncTab(d.tabId, d.url || tab.url, tab.title);
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  byTab.delete(tabId);
  tabMeta.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab ? sender.tab.id : (msg.tabId ?? -1);
  if (msg.type === 'spaNavigate' && tabId >= 0 && msg.url) {
    syncTab(tabId, msg.url, msg.title);
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'titleUpdate' && tabId >= 0 && msg.url) {
    const info = tabMeta.get(tabId);
    if (info && pageKey(info.pageUrl) === pageKey(msg.url)) info.title = msg.title;
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'domMedia' && Array.isArray(msg.items)) {
    const info = tabMeta.get(tabId);
    if (info && info.isVideoPlatform) { reply({ ok: true }); return true; }
    for (const it of msg.items) {
      if (!it.url || it.url.startsWith('blob:') || it.url.startsWith('data:')) continue;
      const cls = classify(it.mime || '', it.url);
      addRes(tabId, {
        url: it.url,
        filename: guessName(it.url, 'mp4'),
        mime: it.mime || '',
        size: null,
        kind: cls.kind,
        tag: cls.tag,
        referer: it.pageUrl || '',
      });
    }
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'getResources') {
    chrome.tabs.get(msg.tabId, (tab) => {
      const live = (!chrome.runtime.lastError && tab && tab.url) || null;
      if (live) {
        const info = tabMeta.get(msg.tabId);
        if (!info || pageKey(info.pageUrl) !== pageKey(live)) syncTab(msg.tabId, live, tab.title);
        else prune(msg.tabId, live);
      }
      reply({
        resources: byTab.has(msg.tabId) ? [...byTab.get(msg.tabId).values()] : [],
        info: tabMeta.get(msg.tabId) || {},
      });
    });
    return true;
  }
  if (msg.type === 'send') {
    reply({ ok: true });
    postCapture(msg.items);
    return false;
  }
  if (msg.type === 'clear') { byTab.delete(msg.tabId); badge(msg.tabId); reply({ ok: true }); return true; }
});

function extOf(item) {
  const src = (item.filename || item.finalUrl || item.url || '').split(/[?#]/)[0];
  const m = /\.([a-z0-9]{1,12})$/i.exec(src);
  return m ? m[1].toLowerCase() : '';
}

function activeExt() {
  const set = new Set();
  for (const [cat, on] of Object.entries(settings.categories || {})) {
    if (on) for (const e of CATEGORY_EXT[cat] || []) set.add(e);
  }
  for (const e of settings.customExt || []) {
    const clean = String(e).trim().replace(/^\./, '').toLowerCase();
    if (clean) set.add(clean);
  }
  return set;
}

function shouldTakeover(item) {
  if (!settings.takeover) return false;
  const url = item.url || item.finalUrl || '';
  if (!/^https?:/i.test(url)) return false;
  if (item.byExtensionId) return false;
  if (settings.minSize > 0 && item.fileSize > 0 && item.fileSize < settings.minSize * 1024 * 1024) return false;
  const mime = (item.mime || '').toLowerCase();
  if (settings.categories.video && mime.startsWith('video/')) return true;
  if (settings.categories.audio && mime.startsWith('audio/')) return true;
  const ext = extOf(item);
  return ext ? activeExt().has(ext) : false;
}

function applyStored(r) {
  if (!r || typeof r !== 'object') return;
  if (typeof r.takeover === 'boolean') settings.takeover = r.takeover;
  if (r.categories) settings.categories = Object.assign({}, DEFAULTS.categories, r.categories);
  if (Array.isArray(r.customExt)) settings.customExt = r.customExt;
  if (typeof r.minSize === 'number') settings.minSize = r.minSize;
}

chrome.storage.local.get(['takeover', 'categories', 'customExt', 'minSize'], applyStored);
chrome.storage.onChanged.addListener((ch) => {
  const patch = {};
  for (const k of ['takeover', 'categories', 'customExt', 'minSize']) {
    if (ch[k]) patch[k] = ch[k].newValue;
  }
  applyStored(patch);
});

if (chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item) => {
    try {
      if (!shouldTakeover(item)) return;
      let fname = item.filename ? item.filename.split(/[\\/]/).pop() : '';
      if (!fname) fname = guessName(item.finalUrl || item.url);
      chrome.downloads.cancel(item.id, () => chrome.downloads.erase({ id: item.id }, () => {}));
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        postCapture([{
          url: item.finalUrl || item.url,
          filename: fname || 'download',
          mime: item.mime,
          size: item.fileSize > 0 ? item.fileSize : null,
          referer: (tabs[0] && tabs[0].url) || item.referrer || '',
        }]);
      });
    } catch {
      /* keep browser download */
    }
  });
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'sdl-link', title: '使用 SDL Fast 下载此链接', contexts: ['link', 'video', 'audio', 'image'] });
    chrome.contextMenus.create({ id: 'sdl-page', title: '使用 SDL Fast 下载此页视频', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'sdl-all', title: '嗅探本页全部资源到 SDL Fast', contexts: ['page', 'action'] });
  });
}
chrome.runtime.onInstalled.addListener(createMenus);
createMenus();
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sdl-link') {
    const url = info.linkUrl || info.srcUrl;
    if (url) postCapture([{ url, filename: guessName(url), referer: tab?.url || '' }]);
  } else if (info.menuItemId === 'sdl-page' && tab?.url) {
    postCapture([{ url: tab.url, filename: cleanTitle(tab.title, tab.url) + '.mp4', kind: 'video-platform', referer: tab.url }]);
  } else if (info.menuItemId === 'sdl-all') {
    const map = byTab.get(tab.id);
    if (map && map.size) postCapture([...map.values()]);
    else notify('未发现资源', '当前页面还没有嗅探到可下载资源。');
  }
});

async function postJson(path, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 1200);
  try {
    const res = await fetch('http://127.0.0.1:18761' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      keepalive: true,
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function warmClient() {
  postJson('/health', null, 600).catch(() => {});
}

async function postCapture(items) {
  const payload = items.map((it) => ({
    url: it.url,
    filename: it.filename,
    kind: it.kind,
    mime: it.mime,
    size: it.size,
    headers: it.referer ? { Referer: it.referer } : it.headers,
  }));
  const body = payload.length === 1 ? payload[0] : { items: payload };
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await postJson('/capture', body, 1500);
      if (!res || !res.ok) throw new Error('bad status');
      notify('已发送到 SDL Fast', payload.length === 1 ? payload[0].filename : payload.length + ' 个资源');
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  notify('发送失败', '请先启动 SDL Fast 客户端（端口 18761）。');
  return lastErr;
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/48.png', title, message });
}

warmClient();
chrome.runtime.onStartup.addListener(warmClient);
chrome.alarms.create('sdl-ping', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sdl-ping') warmClient();
});
