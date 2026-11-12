/**
 * freeCodeCamp "Back End Development and APIs" microservices.
 *
 * One dependency-free Node HTTP server that can run any of the five certification
 * microservices, selected with the API environment variable:
 *
 *   API=timestamp        port 3001   /api/:date
 *   API=headers          port 3002   /api/whoami
 *   API=shorturl         port 3003   /api/shorturl
 *   API=exercises        port 3004   /api/users
 *   API=filemetadata     port 3005   /api/fileanalyse
 *
 * Everything is implemented with the Node standard library only, so the service can be
 * run with `node server.js` on any machine that has Node installed.
 */
'use strict';

const http = require('http');
const { URL } = require('url');

const API = process.env.API || 'timestamp';
const PORT = Number(process.env.PORT || 3001);

/* ------------------------------------------------------------------ helpers */

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body)
    ? body
    : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parses an application/x-www-form-urlencoded body into a plain object. */
function parseForm(text) {
  const out = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const key = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
    const val = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    out[key] = val;
  }
  return out;
}

/**
 * Minimal multipart/form-data reader.
 * Returns { fields, files } where files[0] = { name, filename, type, size, data }.
 */
function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  const boundary = (match[1] || match[2]).trim();
  const delimiter = Buffer.from('--' + boundary);
  const parts = [];
  let index = buffer.indexOf(delimiter);
  while (index !== -1) {
    const next = buffer.indexOf(delimiter, index + delimiter.length);
    if (next === -1) break;
    parts.push(buffer.slice(index + delimiter.length, next));
    index = next;
  }

  const fields = {};
  const files = [];
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    let body = part.slice(headerEnd + 4);
    // Strip the trailing CRLF that precedes the next boundary.
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
    if (body.slice(0, 2).toString() === '\r\n') body = body.slice(2);

    const disposition = /content-disposition:[^\r\n]*/i.exec(headerText);
    const nameMatch = disposition ? /name="([^"]*)"/i.exec(disposition[0]) : null;
    const fileMatch = disposition ? /filename="([^"]*)"/i.exec(disposition[0]) : null;
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);

    if (!nameMatch) continue;
    if (fileMatch) {
      files.push({
        field: nameMatch[1],
        filename: fileMatch[1],
        type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
        size: body.length,
        data: body
      });
    } else {
      fields[nameMatch[1]] = body.toString('utf8');
    }
  }
  return { fields, files };
}

/* ------------------------------------------------------- api: timestamp */

function timestampApi(req, res, url) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });

  const raw = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  let date;
  if (raw === '') {
    date = new Date();
  } else if (/^\d+$/.test(raw)) {
    date = new Date(Number(raw));
  } else {
    date = new Date(decodeURIComponent(raw));
  }

  if (isNaN(date.getTime())) return send(res, 200, { error: 'Invalid Date' });

  return send(res, 200, { unix: date.getTime(), utc: date.toUTCString() });
}

/* --------------------------------------------------------- api: headers */

function headersApi(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });

  const forwarded = req.headers['x-forwarded-for'];
  const ipaddress = forwarded
    ? String(forwarded).split(',')[0].trim()
    : (req.socket.remoteAddress || '').replace(/^::ffff:/, '');

  const acceptLanguage = req.headers['accept-language'];
  const language = acceptLanguage
    ? String(acceptLanguage).split(',')[0].trim()
    : 'en';

  const software = req.headers['user-agent'] || '';

  return send(res, 200, { ipaddress, language, software });
}

/* ------------------------------------------------------- api: shorturl */

const shortUrlStore = new Map();
let shortUrlCounter = 1;

function isValidUrl(value) {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(String(value || '').trim());
}

async function shortUrlApi(req, res, url) {
  const match = /^\/api\/shorturl(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) return send(res, 404, { error: 'not found' });

  const slug = match[1];

  if (req.method === 'POST') {
    const body = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    let target;
    if (contentType.includes('application/json')) {
      try { target = (JSON.parse(body.toString('utf8')) || {}).url; } catch { target = undefined; }
      if (target === undefined) target = (JSON.parse('{}') || {}).url;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = parseForm(body.toString('utf8'));
      target = form.url !== undefined ? form.url : form.original_url;
    } else {
      const form = parseForm(body.toString('utf8'));
      target = form.url !== undefined ? form.url : form.original_url;
    }

    if (!isValidUrl(target)) return send(res, 200, { error: 'invalid url' });

    const original = String(target).trim();
    const id = shortUrlCounter++;
    shortUrlStore.set(String(id), original);
    return send(res, 200, { original_url: original, short_url: id });
  }

  if (req.method === 'GET') {
    if (slug === undefined) return send(res, 200, { error: 'invalid url' });
    const original = shortUrlStore.get(String(slug));
    if (!original) return send(res, 404, { error: 'not found' });
    res.writeHead(302, { Location: original, 'Cache-Control': 'no-store' });
    return res.end();
  }

  return send(res, 405, { error: 'Method Not Allowed' });
}

/* ----------------------------------------------------- api: exercises */

const users = new Map();

function makeId() {
  return Math.random().toString(36).slice(2, 12);
}

function publicUser(user) {
  return { username: user.username, _id: user._id };
}

async function exercisesApi(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '');

  // /api/users
  if (path === '/api/users') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const form = parseForm(body.toString('utf8'));
      const username = form.username;
      if (!username) return send(res, 400, { error: 'username is required' });
      const user = { username, _id: makeId(), log: [] };
      users.set(user._id, user);
      return send(res, 200, publicUser(user));
    }
    if (req.method === 'GET') {
      return send(res, 200, Array.from(users.values()).map(publicUser));
    }
    return send(res, 405, { error: 'Method Not Allowed' });
  }

  // /api/users/:_id/exercises
  const exerciseMatch = /^\/api\/users\/([^/]+)\/exercises$/.exec(path);
  if (exerciseMatch) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' });
    const user = users.get(exerciseMatch[1]);
    if (!user) return send(res, 404, { error: 'user not found' });
    const body = await readBody(req);
    const form = parseForm(body.toString('utf8'));
    const entry = {
      description: String(form.description || ''),
      duration: Number(form.duration),
      date: form.date ? String(form.date) : new Date().toDateString()
    };
    user.log.push(entry);
    return send(res, 200, { ...publicUser(user), ...entry });
  }

  // /api/users/:_id/logs
  const logsMatch = /^\/api\/users\/([^/]+)\/logs$/.exec(path);
  if (logsMatch) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });
    const user = users.get(logsMatch[1]);
    if (!user) return send(res, 404, { error: 'user not found' });

    let log = user.log.slice();
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = url.searchParams.get('limit');

    if (from) {
      const fromTime = new Date(from).getTime();
      log = log.filter((e) => new Date(e.date).getTime() >= fromTime);
    }
    if (to) {
      const toTime = new Date(to).getTime();
      log = log.filter((e) => new Date(e.date).getTime() <= toTime);
    }
    if (limit !== null && limit !== undefined && limit !== '') {
      log = log.slice(0, Number(limit));
    }

    return send(res, 200, { ...publicUser(user), count: log.length, log });
  }

  return send(res, 404, { error: 'not found' });
}

/* --------------------------------------------------- api: filemetadata */

async function fileMetadataApi(req, res, url) {
  if (url.pathname.replace(/\/+$/, '') !== '/api/fileanalyse') {
    return send(res, 404, { error: 'not found' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' });

  const body = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  const parsed = parseMultipart(body, contentType);
  if (!parsed) return send(res, 400, { error: 'expected multipart/form-data' });

  const file = parsed.files.find((f) => f.field === 'upfile') || parsed.files[0];
  if (!file) return send(res, 400, { error: 'no file uploaded' });

  return send(res, 200, {
    name: file.filename,
    type: file.type,
    size: file.size
  });
}

/* ------------------------------------------------------------- landing */

const LANDING = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>freeCodeCamp Back End APIs</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:48px 24px}
.wrap{max-width:760px;margin:0 auto}h1{font-size:28px;margin:0 0 8px}p{color:#8b949e;line-height:1.6}
code{color:#79c0ff}li{margin:6px 0;color:#c9d1d9}</style></head>
<body><div class="wrap"><h1>Back End Development and APIs</h1>
<p>Dependency-free Node.js microservices for the freeCodeCamp certification. No frameworks, no build step.</p>
<ul><li><code>GET /api/:date</code> &mdash; timestamp microservice</li>
<li><code>GET /api/whoami</code> &mdash; request header parser</li>
<li><code>POST /api/shorturl</code> &mdash; URL shortener</li>
<li><code>GET|POST /api/users</code> &mdash; exercise tracker</li>
<li><code>POST /api/fileanalyse</code> &mdash; file metadata microservice</li></ul>
</div></body></html>`;

/* -------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(LANDING);
  }

  try {
    if (API === 'timestamp') return await timestampApi(req, res, url);
    if (API === 'headers') return await headersApi(req, res, url);
    if (API === 'shorturl') return await shortUrlApi(req, res, url);
    if (API === 'exercises') return await exercisesApi(req, res, url);
    if (API === 'filemetadata') return await fileMetadataApi(req, res, url);
    return send(res, 404, { error: 'unknown api' });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${API}] listening on http://0.0.0.0:${PORT}`);
});
