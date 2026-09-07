'use strict';

(function () {
  function report(url, mime) {
    if (!url) return;
    if (/\.(m3u8|mpd)(\?|$)/i.test(url) || /(mpegurl|dash\+xml)/i.test(mime || '')) {
      window.postMessage({ __sdl: true, url: String(url), mime: mime || '' }, '*');
    }
  }

  const rawFetch = window.fetch;
  if (rawFetch) {
    window.fetch = function (input, init) {
      try {
        report(typeof input === 'string' ? input : input && input.url);
      } catch { /* ignore */ }
      return rawFetch.apply(this, arguments);
    };
  }

  const rawOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { report(url); } catch { /* ignore */ }
    return rawOpen.apply(this, arguments);
  };
})();
