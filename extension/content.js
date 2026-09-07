'use strict';

(function () {
  const seen = new Set();

  function report(items) {
    if (!items.length) return;
    try { chrome.runtime.sendMessage({ type: 'domMedia', items }); } catch { /* ignore */ }
  }

  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch { /* ignore */ }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || !ev.data.__sdl) return;
    const u = ev.data.url;
    if (!u || seen.has(u)) return;
    seen.add(u);
    report([{ url: u, mime: ev.data.mime || '', pageUrl: location.href }]);
  });

  function scan() {
    const items = [];
    document.querySelectorAll('video, audio').forEach((el) => {
      const urls = [el.src, el.currentSrc].filter(Boolean);
      el.querySelectorAll('source').forEach((s) => { if (s.src) urls.push(s.src); });
      for (const u of urls) {
        if (!u || seen.has(u)) continue;
        seen.add(u);
        items.push({ url: u, mime: el.getAttribute('type') || '', pageUrl: location.href });
      }
    });
    report(items);
  }

  let lastHref = location.href;
  function onRoute() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    seen.clear();
    try { chrome.runtime.sendMessage({ type: 'spaNavigate', url: location.href, title: document.title }); } catch { /* ignore */ }
    setTimeout(scan, 800);
  }
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    if (typeof orig === 'function') {
      history[fn] = function () {
        const r = orig.apply(this, arguments);
        setTimeout(onRoute, 0);
        return r;
      };
    }
  }
  window.addEventListener('popstate', () => setTimeout(onRoute, 0));
  setInterval(onRoute, 800);

  const titleEl = document.querySelector('title');
  if (titleEl) {
    let last = document.title;
    new MutationObserver(() => {
      if (document.title === last) return;
      last = document.title;
      try { chrome.runtime.sendMessage({ type: 'titleUpdate', url: location.href, title: document.title }); } catch { /* ignore */ }
    }).observe(titleEl, { childList: true });
  }

  if (window.top === window.self) {
    let overlay = null;
    let target = null;
    let hideTimer = null;
    let videos = [];

    function usable(v) {
      if (!(v instanceof HTMLVideoElement)) return false;
      const r = v.getBoundingClientRect();
      return r.width >= 120 && r.height >= 80;
    }

    function ensureOverlay() {
      if (overlay) return overlay;
      const el = document.createElement('div');
      el.innerHTML = '<button type="button"><span>下载该视频</span></button>';
      Object.assign(el.style, { position: 'fixed', zIndex: '2147483647', display: 'none' });
      const btn = el.querySelector('button');
      Object.assign(btn.style, {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '7px 12px', border: 'none', borderRadius: '8px',
        background: 'linear-gradient(135deg,#2f7be0,#1e5fc0)', color: '#fff',
        font: '600 13px/1 Microsoft YaHei,system-ui,sans-serif', cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,.35)',
      });
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendVideo(target);
        btn.querySelector('span').textContent = '已发送';
        setTimeout(() => { btn.querySelector('span').textContent = '下载该视频'; }, 1600);
      };
      el.onmouseenter = () => clearTimeout(hideTimer);
      el.onmouseleave = () => { hideTimer = setTimeout(() => { el.style.display = 'none'; }, 500); };
      document.documentElement.appendChild(el);
      overlay = el;
      return el;
    }

    function place(video) {
      const el = ensureOverlay();
      const r = video.getBoundingClientRect();
      el.style.display = 'block';
      el.style.top = Math.max(6, r.top + 10) + 'px';
      const w = el.offsetWidth || 130;
      el.style.left = Math.min(window.innerWidth - w - 6, r.right - w - 10) + 'px';
    }

    function resolvePost(video) {
      if (/\/(watch|status\/|video\/|shorts\/|reel\/)/.test(location.pathname)) return location.href;
      const art = video && video.closest && video.closest('article');
      const a = art && art.querySelector('a[href*="/status/"] time')
        ? art.querySelector('a[href*="/status/"] time').closest('a')
        : (video && video.closest && video.closest('ytd-rich-item-renderer, ytd-video-renderer') || video.parentElement);
      const link = a && a.querySelector
        ? a.querySelector('a[href*="/watch"], a[href*="/status/"], a[href*="/video/"]')
        : null;
      const href = (link && link.getAttribute('href')) || (a && a.getAttribute && a.getAttribute('href'));
      if (href) return href.startsWith('http') ? href : location.origin + href;
      return location.href;
    }

    function sendVideo(video) {
      const host = location.hostname;
      const platform = /(youtube|youtu\.be|x\.com|twitter|tiktok|bilibili|vimeo|twitch|instagram|facebook|reddit)/i.test(host);
      let payload;
      if (platform) {
        payload = { url: resolvePost(video), kind: 'video-platform', filename: (document.title || 'video') + '.mp4' };
      } else {
        const src = (video && (video.currentSrc || video.src)) || '';
        payload = (!src || src.startsWith('blob:'))
          ? { url: resolvePost(video), kind: 'video-platform', filename: (document.title || 'video') + '.mp4' }
          : { url: src };
      }
      try { chrome.runtime.sendMessage({ type: 'send', items: [payload] }); } catch { /* ignore */ }
    }

    function videoAt(x, y) {
      let best = null, area = 0;
      for (const v of videos) {
        const r = v.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width * r.height > area) {
          area = r.width * r.height;
          best = v;
        }
      }
      return best;
    }

    document.addEventListener('mousemove', (e) => {
      videos = [...document.querySelectorAll('video')].filter(usable);
      const v = videoAt(e.clientX, e.clientY);
      if (v) {
        target = v;
        place(v);
      } else if (overlay && overlay.style.display !== 'none') {
        const o = overlay.getBoundingClientRect();
        const on = e.clientX >= o.left && e.clientX <= o.right && e.clientY >= o.top && e.clientY <= o.bottom;
        if (!on) hideTimer = setTimeout(() => { overlay.style.display = 'none'; }, 400);
      }
    }, true);
  }

  const obs = new MutationObserver(() => {
    clearTimeout(obs._t);
    obs._t = setTimeout(scan, 600);
  });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(scan, 800);
  setInterval(scan, 5000);
})();
