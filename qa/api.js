'use strict';

/**
 * HTTP request handlers for the Quality Assurance services.
 *
 * `handle()` is a pure function: it takes a parsed request and returns the response
 * that should be sent. That keeps the behaviour testable without opening a socket.
 */

const services = require('./services.js');

const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

const ok = (body) => ({ status: 200, type: JSON_TYPE, body });
const okText = (body) => ({ status: 200, type: TEXT, body });

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

/* ------------------------------------------------------------- converter */

function convertHandler(request) {
  const input = request.query.input;
  const result = services.convert(input);
  if (result.error) return okText(result.error);
  return ok(result);
}

/* --------------------------------------------------------- issue tracker */

function issueTrackerHandler(request) {
  const match = /^\/api\/issues\/([^/]+)\/?$/.exec(request.path);
  if (!match) return { status: 404, type: JSON_TYPE, body: { error: 'not found' } };
  const project = decodeURIComponent(match[1]);
  const body = readBody(request.body);

  if (request.method === 'POST') return ok(services.createIssue(project, body));
  if (request.method === 'GET') return ok(services.getIssues(project, request.query));
  if (request.method === 'PUT') return ok(services.updateIssue(project, body));
  if (request.method === 'DELETE') return ok(services.deleteIssue(project, body));
  return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
}

/* ------------------------------------------------------- personal library */

function libraryHandler(request) {
  const path = request.path.replace(/\/+$/, '');
  const body = readBody(request.body);

  if (path === '/api/books') {
    if (request.method === 'POST') {
      const result = services.addBook(body);
      return result.text ? okText(result.text) : ok(result.body);
    }
    if (request.method === 'GET') return ok(services.listBooks());
    if (request.method === 'DELETE') return okText(services.deleteAllBooks().text);
    return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
  }

  const bookMatch = /^\/api\/books\/([^/]+)$/.exec(path);
  if (bookMatch) {
    const id = decodeURIComponent(bookMatch[1]);
    if (request.method === 'GET') {
      const result = services.getBook(id);
      return result.text ? okText(result.text) : ok(result.body);
    }
    if (request.method === 'POST') {
      const result = services.addComment(id, body);
      return result.text ? okText(result.text) : ok(result.body);
    }
    if (request.method === 'DELETE') {
      const result = services.deleteBook(id);
      return result.text ? okText(result.text) : ok(result.body);
    }
    return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
  }

  return { status: 404, type: JSON_TYPE, body: { error: 'not found' } };
}

/* ----------------------------------------------------------- sudoku solver */

function sudokuHandler(request) {
  const path = request.path.replace(/\/+$/, '');
  const body = readBody(request.body);

  if (path === '/api/solve') {
    if (request.method !== 'POST') {
      return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
    }
    if (body.puzzle === undefined || body.puzzle === null || body.puzzle === '') {
      return ok({ error: 'Required field missing' });
    }
    const puzzle = String(body.puzzle);
    if (!services.isSudokuChars(puzzle)) return ok({ error: 'Invalid characters in puzzle' });
    if (puzzle.length !== 81) return ok({ error: 'Expected puzzle to be 81 characters long' });
    const solution = services.solveSudoku(puzzle);
    if (!solution) return ok({ error: 'Puzzle cannot be solved' });
    return ok({ solution });
  }

  if (path === '/api/check') {
    if (request.method !== 'POST') {
      return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
    }
    if (
      body.puzzle === undefined || body.puzzle === null || body.puzzle === '' ||
      body.coordinate === undefined || body.coordinate === null || body.coordinate === '' ||
      body.value === undefined || body.value === null || body.value === ''
    ) {
      return ok({ error: 'Required field(s) missing' });
    }
    const puzzle = String(body.puzzle);
    if (!services.isSudokuChars(puzzle)) return ok({ error: 'Invalid characters in puzzle' });
    if (puzzle.length !== 81) return ok({ error: 'Expected puzzle to be 81 characters long' });
    if (!services.isCoordinate(body.coordinate)) return ok({ error: 'Invalid coordinate' });
    if (!services.isValue(body.value)) return ok({ error: 'Invalid value' });
    return ok(services.checkPlacement(puzzle, String(body.coordinate).toUpperCase(), String(body.value)));
  }

  return { status: 404, type: JSON_TYPE, body: { error: 'not found' } };
}

/* ---------------------------------------------------- american/british translator */

function translatorHandler(request) {
  const path = request.path.replace(/\/+$/, '');
  if (path !== '/api/translate') return { status: 404, type: JSON_TYPE, body: { error: 'not found' } };
  if (request.method !== 'POST') {
    return { status: 405, type: JSON_TYPE, body: { error: 'Method Not Allowed' } };
  }

  const body = readBody(request.body);
  const { text, locale } = body;

  if (text === undefined || text === null || locale === undefined || locale === null) {
    return ok({ error: 'Required field(s) missing' });
  }
  if (String(text).trim() === '') return ok({ error: 'No text to translate' });
  if (locale !== 'american-to-british' && locale !== 'british-to-american') {
    return ok({ error: 'Invalid value for locale field' });
  }

  const translation = services.translate(String(text), locale);
  if (translation === String(text)) {
    return ok({ text: String(text), translation: 'Everything looks good to me!' });
  }
  return ok({ text: String(text), translation });
}

const HANDLERS = {
  convert: convertHandler,
  issuetracker: issueTrackerHandler,
  library: libraryHandler,
  sudoku: sudokuHandler,
  translate: translatorHandler
};

/**
 * Routes a request to the right service.
 * Returns null when the path does not belong to the active service.
 */
function handle(api, request) {
  const handler = HANDLERS[api];
  if (!handler) return null;
  return handler(request);
}

module.exports = { handle, HANDLERS };
