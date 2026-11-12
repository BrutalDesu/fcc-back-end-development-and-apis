'use strict';

/**
 * HTTP handlers for the Information Security services.
 *
 * Both services expose their security headers through `GET /_api/app-info`, which
 * returns the headers that were sent with that very response.
 */

const services = require('./services.js');

const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

/** The security headers each service must expose. */
function securityHeaders(api) {
  if (api === 'stockchecker') {
    return {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    };
  }
  return {
    'X-Frame-Options': 'SAMEORIGIN',
    'X-DNS-Prefetch-Control': 'off',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  };
}

function readBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function clientIp(request) {
  const forwarded = request.headers && request.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  const socket = request.socket || {};
  return String(socket.remoteAddress || '').replace(/^::ffff:/, '');
}

/** The query parameters of the current request. */
function searchParams(request) {
  if (request.searchParams) return request.searchParams;
  return new URL(request.path, 'http://localhost').searchParams;
}

/* --------------------------------------------------------- stock checker */

function stockCheckerHandler(request) {
  const url = new URL(request.path, 'http://localhost');
  if (url.pathname !== '/api/stock-prices') {
    return { status: 404, type: JSON_TYPE, body: { error: 'not found' } };
  }
  if (request.method !== 'GET') {
    return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
  }

  const params = searchParams(request);
  const symbols = params.getAll('stock').filter(Boolean);
  if (!symbols.length) {
    return { status: 200, type: JSON_TYPE, body: { error: 'no stock symbol supplied' } };
  }

  const like = params.get('like');
  const result = services.stockData(symbols, clientIp(request), like);
  return { status: 200, type: JSON_TYPE, body: result };
}

/* --------------------------------------------------------- message board */

function messageBoardHandler(request) {
  // The route is matched on the path without the query string.
  const route = request.path.split('?')[0];
  const threadMatch = /^\/api\/threads\/([^/]+)\/?$/.exec(route);
  const replyMatch = /^\/api\/replies\/([^/]+)\/?$/.exec(route);

  if (threadMatch) {
    const board = decodeURIComponent(threadMatch[1]);
    const body = readBody(request.body);

    if (request.method === 'POST') {
      const thread = services.createThread(board, body);
      return { status: 200, type: JSON_TYPE, body: services.publicThread(thread, 3) };
    }
    if (request.method === 'GET') {
      return { status: 200, type: JSON_TYPE, body: services.listThreads(board) };
    }
    if (request.method === 'PUT') {
      return { status: 200, type: TEXT, body: services.reportThread(board, body) };
    }
    if (request.method === 'DELETE') {
      return { status: 200, type: TEXT, body: services.deleteThread(board, body) };
    }
    return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
  }

  if (replyMatch) {
    const board = decodeURIComponent(replyMatch[1]);
    const params = searchParams(request);
    const body = readBody(request.body);

    if (request.method === 'POST') {
      const reply = services.createReply(board, body);
      if (!reply) return { status: 200, type: TEXT, body: 'incorrect password' };
      return { status: 200, type: JSON_TYPE, body: services.getThread(board, body.thread_id) };
    }
    if (request.method === 'GET') {
      const threadId = params.get('thread_id');
      const thread = services.getThread(board, threadId);
      if (!thread) return { status: 200, type: TEXT, body: 'no thread exists' };
      return { status: 200, type: JSON_TYPE, body: thread };
    }
    if (request.method === 'PUT') {
      return { status: 200, type: TEXT, body: services.reportReply(board, body) };
    }
    if (request.method === 'DELETE') {
      return { status: 200, type: TEXT, body: services.deleteReply(board, body) };
    }
    return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
  }

  return { status: 404, type: JSON_TYPE, body: { error: 'not found' } };
}

const HANDLERS = {
  stockchecker: stockCheckerHandler,
  messageboard: messageBoardHandler
};

function handle(api, request) {
  const handler = HANDLERS[api];
  if (!handler) return null;
  return handler(request);
}
module.exports = { handle, securityHeaders, HANDLERS };
