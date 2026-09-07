'use strict';

const $ = (id) => document.getElementById(id);
let state = { tasks: [], count: 0, speed: 0 };
let selected = new Set();
let lastSelected = '';
let filter = 'all';
let category = '';
let settings = {};

function fmtSize(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n) || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (i ? v.toFixed(v >= 10 ? 1 : 2) : String(v)) + ' ' + u[i];
}

function fmtSpeed(n) {
  return fmtSize(n) + '/s';
}

function statusText(t) {
  if (t.status === 'downloading') return '下载中';
  if (t.status === 'merging') return '合并中';
  if (t.status === 'queued') return '排队';
  if (t.status === 'paused') return '已暂停';
  if (t.status === 'completed') return '已完成';
  if (t.status === 'error') return t.error || '失败';
  return t.status;
}

function statusClass(s) {
  if (s === 'downloading' || s === 'merging' || s === 'queued') return 'st-down';
  if (s === 'completed') return 'st-done';
  if (s === 'error') return 'st-err';
  if (s === 'paused') return 'st-pause';
  return '';
}

function visibleTasks() {
  return state.tasks.filter((t) => {
    if (filter === 'downloading' && !['downloading', 'queued', 'merging', 'paused'].includes(t.status)) return false;
    if (filter === 'completed' && t.status !== 'completed') return false;
    if (category && t.category !== category) return false;
    return true;
  });
}

function render() {
  const list = visibleTasks();
  const rows = $('rows');
  rows.innerHTML = '';
  $('empty').classList.toggle('hidden', list.length > 0);
  for (const t of list) {
    const el = document.createElement('div');
    el.className = 'row' + (selected.has(t.id) ? ' selected' : '');
    el.dataset.id = t.id;
    el.innerHTML = `
      <div>
        <div class="fn" title="${escapeHtml(t.filename)}">${escapeHtml(t.filename)}</div>
        <div class="sub" title="${escapeHtml(t.url)}">${escapeHtml(t.url)}</div>
      </div>
      <div>${t.size ? fmtSize(t.size) : (t.downloaded ? fmtSize(t.downloaded) : '—')}</div>
      <div class="${statusClass(t.status)}">${escapeHtml(statusText(t))}</div>
      <div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, t.progress || 0))}%"></i></div>
      </div>
      <div>${t.status === 'downloading' ? fmtSpeed(t.speed) : '—'}</div>
      <div>${t.eta || '—'}</div>`;
    el.addEventListener('mousedown', (e) => onRowClick(e, t.id, list));
    el.addEventListener('dblclick', () => {
      if (t.status === 'completed') window.sdl.openFile(t.id);
    });
    rows.appendChild(el);
  }
  $('statCount').textContent = `${state.count} 个任务`;
  $('statSpeed').textContent = `总速度: ${fmtSpeed(state.speed)}`;
  syncToolbar();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function onRowClick(e, id, list) {
  if (e.shiftKey && lastSelected) {
    const ids = list.map((t) => t.id);
    const a = ids.indexOf(lastSelected);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      selected = new Set(ids.slice(lo, hi + 1));
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    lastSelected = id;
  } else {
    selected = new Set([id]);
    lastSelected = id;
  }
  render();
}

function selectedTasks() {
  return state.tasks.filter((t) => selected.has(t.id));
}

function syncToolbar() {
  const items = selectedTasks();
  const one = items.length === 1;
  const any = items.length > 0;
  $('btnResume').disabled = !items.some((t) => t.status === 'paused' || t.status === 'error' || t.status === 'queued');
  $('btnPause').disabled = !items.some((t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'merging');
  $('btnDelete').disabled = !any;
  $('btnOpen').disabled = !one || items[0].status !== 'completed';
  $('btnFolder').disabled = !one;
}

function applyState(data) {
  state = data;
  const ids = new Set(data.tasks.map((t) => t.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  render();
}

function closeModal() {
  $('modal').classList.add('hidden');
  $('dialogBox').innerHTML = '';
}

function openModal(html) {
  $('dialogBox').innerHTML = html;
  $('modal').classList.remove('hidden');
}

function dialogAdd(preset) {
  const item = preset || {};
  openModal(`
    <div class="dlg-h">添加下载</div>
    <div class="dlg-b">
      <label class="f">URL</label>
      <input id="fUrl" type="text" value="${escapeHtml(item.url || '')}" placeholder="https://">
      <label class="f">文件名</label>
      <input id="fName" type="text" value="${escapeHtml(item.filename || '')}">
      <label class="f">保存目录</label>
      <div class="row2">
        <input id="fDir" type="text" value="${escapeHtml(settings.downloadDir || '')}">
        <button class="btn" id="fPick">浏览</button>
      </div>
      <label class="f">线程数（1-64）</label>
      <input id="fConn" type="number" min="1" max="64" value="${item.connections || settings.connections || 16}">
    </div>
    <div class="dlg-f">
      <button class="btn" id="fCancel">取消</button>
      <button class="btn primary" id="fOk">开始下载</button>
    </div>`);
  $('fPick').onclick = async () => {
    const dir = await window.sdl.pickFolder();
    if (dir) $('fDir').value = dir;
  };
  $('fCancel').onclick = closeModal;
  $('fOk').onclick = async () => {
    const url = $('fUrl').value.trim();
    if (!url) return;
    await window.sdl.add({
      url,
      filename: $('fName').value.trim(),
      dir: $('fDir').value.trim(),
      connections: Number($('fConn').value) || 16,
      kind: item.kind || '',
      mime: item.mime || '',
      size: item.size || 0,
      headers: item.headers || {},
    });
    closeModal();
  };
  setTimeout(() => $('fUrl').focus(), 0);
}

function dialogCapture(items) {
  if (settings.autoStartCapture && items.length === 1) {
    window.sdl.add(items[0]);
    return;
  }
  const rows = items.map((it, i) => `
    <label class="capture-item">
      <input type="checkbox" data-i="${i}" checked>
      <b>${escapeHtml(it.filename || it.url)}</b>
      <div class="u">${escapeHtml(it.url)}</div>
    </label>`).join('');
  openModal(`
    <div class="dlg-h">浏览器嗅探到 ${items.length} 个资源</div>
    <div class="dlg-b">${rows}
      <label class="f">保存目录</label>
      <div class="row2">
        <input id="fDir" type="text" value="${escapeHtml(settings.downloadDir || '')}">
        <button class="btn" id="fPick">浏览</button>
      </div>
    </div>
    <div class="dlg-f">
      <button class="btn" id="fCancel">取消</button>
      <button class="btn primary" id="fOk">下载所选</button>
    </div>`);
  $('fPick').onclick = async () => {
    const dir = await window.sdl.pickFolder();
    if (dir) $('fDir').value = dir;
  };
  $('fCancel').onclick = closeModal;
  $('fOk').onclick = async () => {
    const dir = $('fDir').value.trim();
    const boxes = [...document.querySelectorAll('.capture-item input:checked')];
    for (const box of boxes) {
      const it = items[Number(box.dataset.i)];
      await window.sdl.add(Object.assign({}, it, { dir }));
    }
    closeModal();
  };
}

function dialogSettings() {
  openModal(`
    <div class="dlg-h">设置</div>
    <div class="dlg-b">
      <label class="f">默认保存目录</label>
      <div class="row2">
        <input id="sDir" type="text" value="${escapeHtml(settings.downloadDir || '')}">
        <button class="btn" id="sPick">浏览</button>
      </div>
      <label class="f">默认线程数</label>
      <input id="sConn" type="number" min="1" max="64" value="${settings.connections || 16}">
      <label class="f">同时进行的任务数</label>
      <input id="sMax" type="number" min="1" max="16" value="${settings.maxActive || 3}">
      <label class="f">HuggingFace Token（可选）</label>
      <input id="sHf" type="password" value="${escapeHtml(settings.hfToken || '')}" placeholder="hf_...">
      <label class="f" style="display:flex;align-items:center;gap:8px;margin-top:12px">
        <input id="sAuto" type="checkbox" ${settings.autoStartCapture ? 'checked' : ''}>
        插件发来的单个任务自动开始
      </label>
    </div>
    <div class="dlg-f">
      <button class="btn" id="fCancel">取消</button>
      <button class="btn primary" id="fOk">保存</button>
    </div>`);
  $('sPick').onclick = async () => {
    const dir = await window.sdl.pickFolder();
    if (dir) $('sDir').value = dir;
  };
  $('fCancel').onclick = closeModal;
  $('fOk').onclick = async () => {
    settings = await window.sdl.setSettings({
      downloadDir: $('sDir').value.trim(),
      connections: Number($('sConn').value) || 16,
      maxActive: Number($('sMax').value) || 3,
      hfToken: $('sHf').value.trim(),
      autoStartCapture: $('sAuto').checked,
    });
    closeModal();
  };
}

async function dialogHelp() {
  const info = await window.sdl.appInfo();
  openModal(`
    <div class="dlg-h">浏览器嗅探插件</div>
    <div class="dlg-b help">
      <p>1. 保持本程序运行（本地端口 <code>${info.port}</code>）。</p>
      <p>2. 打开 Chrome / Edge 的扩展管理页，开启「开发者模式」。</p>
      <p>3. 选择「加载已解压的扩展程序」，指向：</p>
      <p><code>${escapeHtml(info.extensionDir)}</code></p>
      <p>4. 浏览网页时，插件会嗅探视频、音频和文件；鼠标移到视频上可一键发送到 SDL Fast。点击下载链接也可被接管。</p>
    </div>
    <div class="dlg-f"><button class="btn primary" id="fOk">知道了</button></div>`);
  $('fOk').onclick = closeModal;
}

function dialogAbout() {
  openModal(`
    <div class="dlg-h">关于 SDL Fast</div>
    <div class="dlg-b help">
      <p>SDL Fast 高速多线程下载器。最多 64 线程分段下载，支持断点续传、HLS 流、浏览器嗅探，以及 YouTube / B站 / X 等在线视频（需 yt-dlp）。</p>
      <p>本程序无广告、无激活限制。</p>
    </div>
    <div class="dlg-f"><button class="btn primary" id="fOk">关闭</button></div>`);
  $('fOk').onclick = closeModal;
}

async function removeSelected() {
  const items = selectedTasks();
  if (!items.length) return;
  const ok = confirm(`删除 ${items.length} 个任务？`);
  if (!ok) return;
  const delFile = confirm('是否同时删除已下载的文件？\n选“取消”只从列表移除。');
  for (const t of items) await window.sdl.remove(t.id, delFile);
  selected.clear();
}

function bind() {
  $('btnAdd').onclick = () => dialogAdd();
  $('btnResume').onclick = () => selectedTasks().forEach((t) => window.sdl.resume(t.id));
  $('btnPause').onclick = () => selectedTasks().forEach((t) => window.sdl.pause(t.id));
  $('btnPauseAll').onclick = () => window.sdl.pauseAll();
  $('btnDelete').onclick = removeSelected;
  $('btnOpen').onclick = () => { const t = selectedTasks()[0]; if (t) window.sdl.openFile(t.id); };
  $('btnFolder').onclick = () => { const t = selectedTasks()[0]; if (t) window.sdl.openFolder(t.id); };
  $('btnSniff').onclick = dialogHelp;

  document.querySelectorAll('.nav').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filter = btn.dataset.filter || 'all';
      category = btn.dataset.cat || '';
      render();
    };
  });

  $('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete') removeSelected();
    if (e.key === 'Escape') closeModal();
  });

  window.sdl.onTasks(applyState);
  window.sdl.onCapture((items) => {
    if (items.length === 1) dialogAdd(items[0]);
    else dialogCapture(items);
  });
  window.sdl.onUi((name, data) => {
    if (name === 'add') dialogAdd();
    if (name === 'resume') selectedTasks().forEach((t) => window.sdl.resume(t.id));
    if (name === 'pause') selectedTasks().forEach((t) => window.sdl.pause(t.id));
    if (name === 'delete') removeSelected();
    if (name === 'open') { const t = selectedTasks()[0]; if (t) window.sdl.openFile(t.id); }
    if (name === 'folder') { const t = selectedTasks()[0]; if (t) window.sdl.openFolder(t.id); }
    if (name === 'settings') dialogSettings();
    if (name === 'help') dialogHelp();
    if (name === 'about') dialogAbout();
    if (name === 'filter') {
      filter = data || 'all';
      category = '';
      document.querySelectorAll('.nav').forEach((b) => {
        b.classList.toggle('active', b.dataset.filter === filter);
      });
      render();
    }
  });
}

(async function init() {
  bind();
  settings = await window.sdl.getSettings();
  applyState(await window.sdl.list());
})();
