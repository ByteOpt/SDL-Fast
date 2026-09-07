'use strict';

function fmtSize(b) {
  if (b == null) return '未知大小';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
}

const COLORS = { hls: '#e91e63', dash: '#9c27b0', 'video-platform': '#d32f2f', http: '#2f7be0' };
const listEl = document.getElementById('list');
const selection = new Map();
let resources = [];
let tabId = null;

function draw() {
  listEl.innerHTML = '';
  if (!resources.length) {
    listEl.innerHTML = '<div class="empty">当前页面暂未嗅探到资源。<br>播放视频或点击下载链接后再看。</div>';
    return;
  }
  for (const r of resources) {
    const div = document.createElement('div');
    div.className = 'item';
    const color = COLORS[r.kind] || '#2f7be0';
    const hint = r.kind === 'video-platform' ? '<div class="hint">整页视频：由客户端解析清晰度</div>' : '';
    div.innerHTML = `
      <input type="checkbox" data-url="${encodeURIComponent(r.url)}" ${selection.get(r.url) ? 'checked' : ''}>
      <div class="meta">
        <div class="fn" title="${r.filename}">${r.filename}</div>
        <div class="sub">${fmtSize(r.size)} · ${r.url}</div>
        ${hint}
      </div>
      <span class="tag" style="background:${color}22;color:${color}">${r.tag || '文件'}</span>`;
    listEl.appendChild(div);
  }
  listEl.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.onchange = () => selection.set(decodeURIComponent(cb.dataset.url), cb.checked);
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  let last = '';
  const load = () => chrome.runtime.sendMessage({ type: 'getResources', tabId }, (resp) => {
    const next = (resp && resp.resources) || [];
    const sig = next.map((r) => r.url).join('|');
    if (sig === last) return;
    last = sig;
    for (const r of next) if (!selection.has(r.url)) selection.set(r.url, true);
    const present = new Set(next.map((r) => r.url));
    for (const k of [...selection.keys()]) if (!present.has(k)) selection.delete(k);
    resources = next;
    draw();
  });
  load();
  setInterval(load, 1500);

  document.getElementById('send').onclick = () => {
    const items = resources.filter((r) => selection.get(r.url));
    if (!items.length) return;
    chrome.runtime.sendMessage({ type: 'send', items }, () => window.close());
  };
  document.getElementById('selAll').onclick = () => {
    const all = resources.length > 0 && resources.every((r) => selection.get(r.url));
    for (const r of resources) selection.set(r.url, !all);
    draw();
  };
  document.getElementById('clear').onclick = () => {
    chrome.runtime.sendMessage({ type: 'clear', tabId }, () => {
      resources = [];
      selection.clear();
      last = '';
      draw();
    });
  };

  const labels = {
    video: '视频', audio: '音频', archive: '压缩包', program: '程序',
    document: '文档', model: '大模型', other: '种子',
  };
  const catsEl = document.getElementById('cats');
  for (const [id, name] of Object.entries(labels)) {
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" data-cat="${id}">${name}`;
    catsEl.appendChild(lab);
  }
  const tk = document.getElementById('takeover');
  const customEl = document.getElementById('customExt');
  const minSizeEl = document.getElementById('minSize');
  function save() {
    const categories = {};
    catsEl.querySelectorAll('input[data-cat]').forEach((cb) => { categories[cb.dataset.cat] = cb.checked; });
    chrome.storage.local.set({
      takeover: tk.checked,
      categories,
      customExt: customEl.value.split(/[,，\s]+/).map((s) => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean),
      minSize: Math.max(0, parseInt(minSizeEl.value, 10) || 0),
    }, () => {
      document.getElementById('saved').textContent = '已保存';
      setTimeout(() => { document.getElementById('saved').textContent = ''; }, 1000);
    });
  }
  chrome.storage.local.get(['takeover', 'categories', 'customExt', 'minSize'], (r) => {
    tk.checked = typeof r.takeover === 'boolean' ? r.takeover : true;
    const cats = Object.assign({ video: true, audio: true, archive: true, program: true, document: true, model: true, other: true }, r.categories || {});
    catsEl.querySelectorAll('input[data-cat]').forEach((cb) => { cb.checked = !!cats[cb.dataset.cat]; });
    customEl.value = Array.isArray(r.customExt) ? r.customExt.join(', ') : '';
    minSizeEl.value = typeof r.minSize === 'number' ? r.minSize : 0;
  });
  document.getElementById('gear').onclick = () => document.getElementById('settings').classList.toggle('open');
  tk.onchange = save;
  catsEl.addEventListener('change', save);
  customEl.onchange = save;
  minSizeEl.onchange = save;
}
init();
