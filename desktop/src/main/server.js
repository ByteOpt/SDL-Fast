'use strict';

const http = require('http');

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 2 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function cors(res, extra) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    Connection: 'keep-alive',
  }, extra || {});
  return headers;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, cors(res, { 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}

function normalizeCapture(body) {
  if (!body) return [];
  const list = Array.isArray(body.items) ? body.items : [body];
  return list.filter((it) => it && it.url).map((it) => ({
    url: it.url,
    filename: it.filename || '',
    kind: it.kind || '',
    mime: it.mime || '',
    size: it.size || 0,
    headers: it.headers || (it.referer ? { Referer: it.referer } : {}),
  }));
}

function startServer(port, onCapture) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(res));
      res.end();
      return;
    }
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && (url === '/health' || url === '/status')) {
      send(res, 200, { ok: true, name: 'SDL Fast', port });
      return;
    }
    if (req.method === 'POST' && url === '/capture') {
      try {
        const body = await readJson(req);
        const items = normalizeCapture(body);
        if (!items.length) {
          send(res, 400, { ok: false, error: 'empty' });
          return;
        }
        send(res, 200, { ok: true, count: items.length });
        setImmediate(() => onCapture(items));
      } catch (err) {
        send(res, 400, { ok: false, error: String(err.message || err) });
      }
      return;
    }
    send(res, 404, { ok: false });
  });
  server.keepAliveTimeout = 60000;
  server.headersTimeout = 65000;
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startServer, normalizeCapture };
