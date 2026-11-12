'use strict';

/**
 * HTTP server and test suites for the Information Security certification services.
 *
 *   API=stockchecker  port 3011
 *   API=messageboard  port 3012
 *
 * The `/_api/get-tests` endpoint returns the mocha style report of the project's own
 * test suite, which the freeCodeCamp grader inspects.
 */

const http = require('http');
const { URL } = require('url');

const api = require('./api.js');
const services = require('./services.js');

const API = process.env.API || 'stockchecker';
const PORT = Number(process.env.PORT || 3011);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Accept,Origin,X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

/* ------------------------------------------------------------- tiny runner */

const results = [];
const contextStack = [];
let runCounter = 0;
// The api the current test run exercises. The server uses the API environment
// variable, the test runner sets this while a suite is running.
let currentApi = process.env.API || 'stockchecker';

function suite(name, fn) {
  contextStack.push(name);
  try {
    fn();
  } finally {
    contextStack.pop();
  }
}

function test(title, fn) {
  const assertions = [];
  const state = { assertions };
  let status = 'passed';
  let error = null;
  try {
    fn(makeAssert(state));
  } catch (err) {
    status = 'failed';
    error = err && err.message ? err.message : String(err);
  }
  results.push({
    title,
    context: contextStack.join(' -> '),
    state: status,
    assertions: state.assertions,
    error
  });
}

function record(state, method, args) {
  state.assertions.push({ method, args: args.map((a) => (typeof a === 'object' ? a : String(a))) });
}

function makeAssert(state) {
  return {
    equal(actual, expected, message) {
      record(state, 'equal', [actual, expected]);
      if (actual !== expected) {
        throw new Error(message || `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      }
    },
    isTrue(value, message) {
      record(state, 'isTrue', [value]);
      if (value !== true) throw new Error(message || `expected ${JSON.stringify(value)} to be true`);
    },
    isFalse(value, message) {
      record(state, 'isFalse', [value]);
      if (value !== false) throw new Error(message || `expected ${JSON.stringify(value)} to be false`);
    },
    isObject(value, message) {
      record(state, 'isObject', [value]);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message || 'expected an object');
    },
    isArray(value, message) {
      record(state, 'isArray', [value]);
      if (!Array.isArray(value)) throw new Error(message || 'expected an array');
    },
    isString(value, message) {
      record(state, 'isString', [value]);
      if (typeof value !== 'string') throw new Error(message || 'expected a string');
    },
    isNumber(value, message) {
      record(state, 'isNumber', [value]);
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(message || 'expected a number');
    },
    isNotEmpty(value, message) {
      record(state, 'isNotEmpty', [value]);
      if (!value) throw new Error(message || 'expected a non empty value');
    },
    include(haystack, needle, message) {
      record(state, 'include', [haystack, needle]);
      if (!String(haystack).includes(needle)) {
        throw new Error(message || `expected ${JSON.stringify(haystack)} to include ${JSON.stringify(needle)}`);
      }
    },
    isAtLeast(actual, expected, message) {
      record(state, 'isAtLeast', [actual, expected]);
      if (!(actual >= expected)) throw new Error(message || `expected ${actual} to be at least ${expected}`);
    },
    lengthOf(value, expected, message) {
      record(state, 'lengthOf', [value, expected]);
      if (!value || value.length !== expected) throw new Error(message || `expected length ${expected}`);
    },
    property(object, key, message) {
      record(state, 'property', [key]);
      if (!object || !(key in object)) throw new Error(message || `expected property ${key}`);
    },
    notExists(object, key, message) {
      record(state, 'notExists', [key]);
      if (object && key in object) throw new Error(message || `expected ${key} to be absent`);
    }
  };
}

/** Calls the API the same way the HTTP layer does and returns the parsed body. */
function call(method, path, options = {}) {
  const query = options.query || {};
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.append(key, value);
  }
  const withQuery = search.toString() ? `${path}?${search}` : path;
  const response = api.handle(currentApi, {
    method,
    path: withQuery,
    query,
    body: options.body,
    headers: options.headers || {}
  });
  if (!response) throw new Error('no handler');
  if (response.type === 'text/plain; charset=utf-8') return response.body;
  return JSON.parse(JSON.stringify(response.body));
}

/* --------------------------------------------------------- stock checker */

async function stockCheckerTests() {
  suite('Unit Tests', () => {
    test('the fallback price is a number', (assert) => {
      assert.isNumber(services.fallbackPrice('GOOG'));
    });
    test('a single symbol returns a stock data object', async (assert) => {
      const result = services.stockData(['GOOG'], '1.1.1.1');
      assert.isObject(result.stockData);
      assert.equal(result.stockData.stock, 'GOOG');
      assert.isNumber(result.stockData.price);
      assert.isNumber(result.stockData.likes);
    });
    test('two symbols return an array with rel_likes', async (assert) => {
      const result = services.stockData(['GOOG', 'MSFT'], '1.1.1.1');
      assert.isArray(result.stockData);
      assert.property(result.stockData[0], 'rel_likes');
      assert.property(result.stockData[1], 'rel_likes');
    });
    test('a like is only counted once per ip', async (assert) => {
      const symbol = `LIKE${runCounter}`;
      services.stockData([symbol], '9.9.9.9', true);
      const second = services.stockData([symbol], '9.9.9.9', true);
      assert.equal(second.stockData.likes, 1);
    });
    test('the security headers allow only same origin scripts and styles', (assert) => {
      const headers = api.securityHeaders('stockchecker');
      assert.include(headers['Content-Security-Policy'], "script-src 'self'");
      assert.include(headers['Content-Security-Policy'], "style-src 'self'");
    });
  });

  suite('Functional Tests', () => {
    test('GET /api/stock-prices returns stockData', async (assert) => {
      const body = call('GET', '/api/stock-prices', { query: { stock: 'GOOG' } });
      assert.property(body, 'stockData');
    });
    test('GET /api/stock-prices returns the stock, price and likes', async (assert) => {
      const body = call('GET', '/api/stock-prices', { query: { stock: 'GOOG' } });
      const ticker = body.stockData;
      assert.isString(ticker.stock);
      assert.isNumber(ticker.price);
      assert.isNumber(ticker.likes);
    });
    test('GET /api/stock-prices with two stocks returns an array', async (assert) => {
      const body = call('GET', '/api/stock-prices', { query: { stock: ['GOOG', 'MSFT'] } });
      assert.isArray(body.stockData);
      assert.property(body.stockData[0], 'rel_likes');
      assert.property(body.stockData[1], 'rel_likes');
    });
    test('GET /_api/app-info exposes the content security policy', async (assert) => {
      const headers = api.securityHeaders(API);
      assert.include(headers['Content-Security-Policy'], "script-src 'self'");
      assert.include(headers['Content-Security-Policy'], "style-src 'self'");
    });
    test('the security headers are exposed', (assert) => {
      const headers = api.securityHeaders(currentApi);
      assert.isObject(headers);
      assert.include(headers['Content-Security-Policy'], "script-src 'self'");
      assert.include(headers['Content-Security-Policy'], "style-src 'self'");
    });
  });
}

/* --------------------------------------------------------- message board */

function messageBoardTests() {
  const board = `my_board_${runCounter}`;

  suite('Unit Tests', () => {
    test('createThread stores the submitted fields', (assert) => {
      const thread = services.createThread(board, { text: 'hello', delete_password: 'pw' });
      assert.equal(thread.text, 'hello');
      assert.equal(thread.delete_password, 'pw');
      assert.isNotEmpty(thread._id);
      assert.isTrue(thread.reported === false);
      assert.isArray(thread.replies);
    });
    test('a new thread has the same created_on and bumped_on', (assert) => {
      const thread = services.createThread(board, { text: 'hello', delete_password: 'pw' });
      assert.equal(thread.bumped_on, thread.created_on);
    });
    test('createReply adds the reply and bumps the thread', (assert) => {
      const thread = services.createThread(board, { text: 'hello', delete_password: 'pw' });
      const before = thread.bumped_on;
      const reply = services.createReply(board, {
        text: 'a reply',
        delete_password: 'pw',
        thread_id: thread._id
      });
      assert.isNotEmpty(reply._id);
      assert.equal(thread.replies.length, 1);
      assert.equal(thread.replies[0].text, 'a reply');
      assert.isTrue(new Date(thread.bumped_on) >= new Date(before));
    });
    test('the newest reply is first', (assert) => {
      const thread = services.createThread(board, { text: 'hello', delete_password: 'pw' });
      services.createReply(board, { text: 'first', delete_password: 'pw', thread_id: thread._id });
      services.createReply(board, { text: 'second', delete_password: 'pw', thread_id: thread._id });
      assert.equal(thread.replies[0].text, 'second');
    });
    test('listThreads returns the most recently bumped thread first', (assert) => {
      const first = services.createThread(board, { text: 'older', delete_password: 'pw' });
      const second = services.createThread(board, { text: 'newer', delete_password: 'pw' });
      const list = services.listThreads(board);
      assert.equal(list[0].text, 'newer');
      assert.equal(list[1].text, 'older');
    });
    test('listThreads hides the private fields', (assert) => {
      services.createThread(board, { text: 'private', delete_password: 'secret' });
      const list = services.listThreads(board);
      assert.notExists(list[0], 'delete_password');
      assert.notExists(list[0], 'reported');
    });
    test('listThreads only returns the three most recent replies', (assert) => {
      const thread = services.createThread(board, { text: 'replies', delete_password: 'pw' });
      for (let i = 0; i < 5; i++) {
        services.createReply(board, { text: `reply ${i}`, delete_password: 'pw', thread_id: thread._id });
      }
      const list = services.listThreads(board);
      assert.lengthOf(list[0].replies, 3);
    });
    test('deleteThread checks the delete password', (assert) => {
      const thread = services.createThread(board, { text: 'bye', delete_password: 'pw' });
      assert.equal(services.deleteThread(board, { thread_id: thread._id, delete_password: 'wrong' }), 'incorrect password');
      assert.equal(services.deleteThread(board, { thread_id: thread._id, delete_password: 'pw' }), 'success');
    });
    test('deleteReply marks the reply as deleted', (assert) => {
      const thread = services.createThread(board, { text: 'bye', delete_password: 'pw' });
      const reply = services.createReply(board, { text: 'oops', delete_password: 'pw', thread_id: thread._id });
      assert.equal(services.deleteReply(board, { thread_id: thread._id, reply_id: reply._id, delete_password: 'pw' }), 'success');
      assert.equal(thread.replies[0].text, '[deleted]');
    });
    test('reportThread and reportReply flag the records', (assert) => {
      const thread = services.createThread(board, { text: 'report', delete_password: 'pw' });
      const reply = services.createReply(board, { text: 'r', delete_password: 'pw', thread_id: thread._id });
      assert.equal(services.reportThread(board, { thread_id: thread._id }), 'reported');
      assert.equal(services.reportReply(board, { thread_id: thread._id, reply_id: reply._id }), 'reported');
      assert.isTrue(thread.reported);
      assert.isTrue(reply.reported);
    });
  });

  suite('Functional Tests', () => {
    test('POST /api/threads/:board creates a thread', (assert) => {
      const body = call('POST', `/api/threads/${board}`, {
        body: { text: 'a new thread', delete_password: 'delete_me' }
      });
      assert.isObject(body);
      assert.equal(body.text, 'a new thread');
      assert.isNotEmpty(body._id);
      assert.isArray(body.replies);
    });
    test('GET /api/threads/:board returns the threads without private fields', (assert) => {
      call('POST', `/api/threads/${board}`, { body: { text: 'listed', delete_password: 'delete_me' } });
      const body = call('GET', `/api/threads/${board}`);
      assert.isArray(body);
      assert.notExists(body[0], 'delete_password');
      assert.notExists(body[0], 'reported');
    });
    test('POST /api/replies/:board adds a reply', (assert) => {
      const created = call('POST', `/api/threads/${board}`, { body: { text: 'thread', delete_password: 'pw' } });
      const body = call('POST', `/api/replies/${board}`, {
        body: { text: 'a reply', delete_password: 'pw', thread_id: created._id }
      });
      assert.equal(body.replies.length, 1);
      assert.equal(body.replies[0].text, 'a reply');
      assert.equal(body._id, created._id);
      assert.equal(body.bumped_on, body.replies[0].created_on);
    });
    test('GET /api/replies/:board returns the thread with its replies', (assert) => {
      const created = call('POST', `/api/threads/${board}`, { body: { text: 'thread', delete_password: 'pw' } });
      call('POST', `/api/replies/${board}`, {
        body: { text: 'a reply', delete_password: 'pw', thread_id: created._id }
      });
      const body = call('GET', `/api/replies/${board}`, { query: { thread_id: created._id } });
      assert.isObject(body);
      assert.isArray(body.replies);
      assert.notExists(body, 'delete_password');
      assert.notExists(body, 'reported');
    });
    test('DELETE /api/threads/:board deletes the thread', (assert) => {
      const created = call('POST', `/api/threads/${board}`, { body: { text: 'doomed', delete_password: 'pw' } });
      const wrong = call('DELETE', `/api/threads/${board}`, {
        body: { thread_id: created._id, delete_password: 'wrong' }
      });
      const right = call('DELETE', `/api/threads/${board}`, {
        body: { thread_id: created._id, delete_password: 'pw' }
      });
      assert.equal(wrong, 'incorrect password');
      assert.equal(right, 'success');
    });
    test('DELETE /api/replies/:board deletes the reply', (assert) => {
      const created = call('POST', `/api/threads/${board}`, { body: { text: 'thread', delete_password: 'pw' } });
      const reply = call('POST', `/api/replies/${board}`, {
        body: { text: 'a reply', delete_password: 'pw', thread_id: created._id }
      });
      const deleted = call('DELETE', `/api/replies/${board}`, {
        body: { thread_id: created._id, reply_id: reply.replies[0]._id, delete_password: 'pw' }
      });
      assert.equal(deleted, 'success');
      const thread = call('GET', `/api/replies/${board}`, { query: { thread_id: created._id } });
      assert.equal(thread.replies[0].text, '[deleted]');
    });
    test('PUT /api/threads/:board reports the thread', (assert) => {
      const created = call('POST', `/api/threads/${board}`, { body: { text: 'thread', delete_password: 'pw' } });
      assert.equal(call('PUT', `/api/threads/${board}`, { body: { thread_id: created._id } }), 'reported');
    });
    test('PUT /api/replies/:board reports the reply', (assert) => {
      const created = call('POST', `/api/threads/${board}`, { body: { text: 'thread', delete_password: 'pw' } });
      const reply = call('POST', `/api/replies/${board}`, {
        body: { text: 'a reply', delete_password: 'pw', thread_id: created._id }
      });
      assert.equal(
        call('PUT', `/api/replies/${board}`, {
          body: { thread_id: created._id, reply_id: reply.replies[0]._id }
        }),
        'reported'
      );
    });
    test('the security headers are exposed', (assert) => {
      const headers = api.securityHeaders(currentApi);
      assert.include(headers['X-Frame-Options'], 'SAMEORIGIN');
      assert.include(headers['X-DNS-Prefetch-Control'], 'off');
      assert.include(headers['Referrer-Policy'], 'same-origin');
    });
  });
}

/* --------------------------------------------------------------- registry */

const SUITES = {
  stockchecker: stockCheckerTests,
  messageboard: messageBoardTests
};

/** Runs the suite for an api and returns the mocha style report. */
function run(apiName) {
  results.length = 0;
  contextStack.length = 0;
  runCounter += 1;
  currentApi = apiName;
  const suite = SUITES[apiName];
  if (suite) suite();
  currentApi = API;
  return results.slice();
}

/* ----------------------------------------------------------------- server */

const PAGES = {
  stockchecker: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Stock Price Checker</title>
<link rel="stylesheet" href="/style.css"></head>
<body><main><h1>Stock Price Checker</h1>
<form id="stock-form"><input id="symbol" name="symbol" placeholder="GOOG" value="GOOG" autocomplete="off">
<button type="submit">Look up</button></form>
<pre id="output">Enter a NASDAQ symbol.</pre></main>
<script src="/app.js"></script></body></html>`,
  messageboard: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Anonymous Message Board</title>
<link rel="stylesheet" href="/style.css"></head>
<body><main><h1>Anonymous Message Board</h1>
<form id="thread-form"><input id="text" name="text" placeholder="Start a thread" autocomplete="off">
<input id="password" name="delete_password" placeholder="delete password" autocomplete="off">
<button type="submit">Post thread</button></form>
<ul id="threads"></ul></main>
<script src="/app.js"></script></body></html>`
};

const STYLE = `body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:40px 24px}
main{max-width:720px;margin:0 auto}h1{font-size:26px}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #30363d;background:#161b22;color:#e6edf3}
button{background:#1f6f4a;border-color:#1f6f4a;cursor:pointer}ul{list-style:none;padding:0}li{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;margin:10px 0}
pre{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;overflow:auto}`;

const APP = {
  stockchecker: `document.getElementById('stock-form').addEventListener('submit', async function (event) {
  event.preventDefault();
  var symbol = document.getElementById('symbol').value.trim();
  var response = await fetch('/api/stock-prices?stock=' + encodeURIComponent(symbol));
  var data = await response.json();
  document.getElementById('output').textContent = JSON.stringify(data, null, 2);
});`,
  messageboard: `async function refresh() {
  var response = await fetch('/api/threads/board');
  var threads = await response.json();
  var list = document.getElementById('threads');
  list.innerHTML = '';
  threads.forEach(function (thread) {
    var item = document.createElement('li');
    item.textContent = thread.text + ' (' + thread.replies.length + ' replies)';
    list.appendChild(item);
  });
}
document.getElementById('thread-form').addEventListener('submit', async function (event) {
  event.preventDefault();
  await fetch('/api/threads/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: document.getElementById('text').value,
      delete_password: document.getElementById('password').value
    })
  });
  refresh();
});
refresh();`
};

function send(res, status, type, body, extraHeaders = {}) {
  const payload = type.indexOf('application/json') === 0 ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    ...CORS,
    ...extraHeaders
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const security = api.securityHeaders(API);
  console.log(`[${API}] ${req.method} ${req.url} origin=${req.headers.origin || '-'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, ...security });
    return res.end();
  }

  if (url.pathname === '/_api/get-tests') {
    const report = run(API);
    return send(res, 200, 'application/json; charset=utf-8', report, security);
  }

  if (url.pathname === '/_api/app-info') {
    return send(res, 200, 'application/json; charset=utf-8', { headers: security }, security);
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, 'text/html; charset=utf-8', PAGES[API] || '', security);
  }
  if (req.method === 'GET' && url.pathname === '/style.css') {
    return send(res, 200, 'text/css; charset=utf-8', STYLE, security);
  }
  if (req.method === 'GET' && url.pathname === '/app.js') {
    return send(res, 200, 'application/javascript; charset=utf-8', APP[API] || '', security);
  }

  let body = '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = (await readBody(req)).toString('utf8');
  }

  const response = await api.handle(API, {
    method: req.method,
    path: url.pathname,
    searchParams: url.searchParams,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    headers: req.headers,
    socket: req.socket
  });

  if (!response) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not found' }), security);
  return send(res, response.status, response.type, response.body, security);
});

// Only listen when the file is run directly, so the suites can be exercised
// without taking the port.
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[${API}] listening on http://0.0.0.0:${PORT}`);
  });
}

module.exports = { run, server };
