'use strict';

/**
 * HTTP server for the Quality Assurance certification services.
 *
 * One process serves one service, selected with the API environment variable:
 *
 *   API=convert      port 3006   /api/convert
 *   API=issuetracker port 3007   /api/issues/:project
 *   API=library      port 3008   /api/books
 *   API=sudoku       port 3009   /api/solve, /api/check
 *   API=translate    port 3010   /api/translate
 *
 * It also exposes `GET /_api/get-tests`, which the freeCodeCamp grader calls to read
 * the mocha style report of the project's own test suite.
 */

const http = require('http');
const { URL } = require('url');

const api = require('./api.js');
const tests = require('./tests.js');

const API = process.env.API || 'convert';
const PORT = Number(process.env.PORT || 3006);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Accept,Origin,X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>freeCodeCamp Quality Assurance</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:48px 24px}
.wrap{max-width:760px;margin:0 auto}h1{font-size:26px;margin:0 0 8px}p{color:#8b949e;line-height:1.6}
code{color:#79c0ff}li{margin:6px 0;color:#c9d1d9}.box{margin-top:28px;padding:16px;background:#161b22;border:1px solid #30363d;border-radius:10px}</style></head>
<body><div class="wrap"><h1>Quality Assurance</h1>
<p>Dependency-free Node.js microservices for the freeCodeCamp QA certification.</p>
<ul><li><code>GET /api/convert</code> &mdash; metric / imperial converter</li>
<li><code>GET|POST|PUT|DELETE /api/issues/:project</code> &mdash; issue tracker</li>
<li><code>GET|POST|DELETE /api/books</code> &mdash; personal library</li>
<li><code>POST /api/solve</code>, <code>POST /api/check</code> &mdash; sudoku solver</li>
<li><code>POST /api/translate</code> &mdash; american / british translator</li>
<li><code>GET /_api/get-tests</code> &mdash; the project's own test report</li></ul>
<div class="box"><p>Active service: <code>${API}</code></p></div>
</div></body></html>`;

function send(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    ...CORS,
    ...extraHeaders
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  console.log(`[${API}] ${req.method} ${req.url} origin=${req.headers.origin || '-'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (url.pathname === '/_api/get-tests') {
    const report = tests.run(API);
    return sendJson(res, 200, report);
  }

  if (url.pathname === '/' && req.method === 'GET') {
    return send(res, 200, 'text/html; charset=utf-8', PAGE);
  }

  let body = '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = (await readBody(req)).toString('utf8');
  }

  const response = api.handle(API, {
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  if (!response) return sendJson(res, 404, { error: 'not found' });
  if (response.type === 'text/plain; charset=utf-8') {
    return send(res, response.status, response.type, response.body);
  }
  return sendJson(res, response.status, response.body);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${API}] listening on http://0.0.0.0:${PORT}`);
});
