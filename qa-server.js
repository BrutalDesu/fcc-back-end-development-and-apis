/**
 * freeCodeCamp "Quality Assurance" certification microservices.
 *
 * Dependency-free Node HTTP servers for the five QA projects, selected with the API
 * environment variable:
 *
 *   API=convert      port 3006   /api/convert
 *   API=issuetracker port 3007   /api/issues/:project
 *   API=library      port 3008   /api/books
 *   API=sudoku       port 3009   /api/solve, /api/check
 *   API=translate    port 3010   /api/translate
 */
'use strict';

const http = require('http');
const { URL } = require('url');

const API = process.env.API || 'convert';
const PORT = Number(process.env.PORT || 3006);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Accept,Origin,X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS
  });
  res.end(JSON.stringify(body));
}

/** Sends a bare string body (the QA spec asks for plain strings in several cases). */
function text(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS
  });
  res.end(String(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseForm(body) {
  const out = {};
  for (const pair of body.toString('utf8').split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const key = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
    const val = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    out[key] = val;
  }
  return out;
}

/** Reads a request as form data or JSON, whichever the client sent. */
async function readParams(req, url) {
  const out = {};
  for (const [k, v] of url.searchParams.entries()) out[k] = v;
  const type = req.headers['content-type'] || '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await readBody(req);
    if (type.includes('application/json')) {
      try {
        const parsed = JSON.parse(body.toString('utf8') || '{}');
        for (const [k, v] of Object.entries(parsed || {})) out[k] = v;
      } catch { /* ignore malformed json */ }
    } else if (body.length) {
      for (const [k, v] of Object.entries(parseForm(body))) out[k] = v;
    }
  }
  return out;
}

function makeId() {
  return Math.random().toString(36).slice(2, 12);
}

function nowStamp() {
  return new Date().toISOString();
}

/* ------------------------------------------------ api: metric-imperial */

const CONVERSIONS = {
  gal: { factor: 3.78541, other: 'l' },
  l: { factor: 1 / 3.78541, other: 'gal' },
  lbs: { factor: 0.453592, other: 'kg' },
  kg: { factor: 1 / 0.453592, other: 'lbs' },
  mi: { factor: 1.60934, other: 'km' },
  km: { factor: 1 / 1.60934, other: 'mi' }
};

function parseConvertInput(input) {
  const raw = String(input === undefined ? '' : input).trim();
  // The unit starts at the first alphabetic character.
  const unitIndex = raw.search(/[a-zA-Z]/);
  if (unitIndex === -1) return { error: 'invalid unit' };

  const numberPart = raw.slice(0, unitIndex).trim();
  const unitPart = raw.slice(unitIndex).trim().toLowerCase();

  if (!CONVERSIONS[unitPart]) return { error: 'invalid unit' };

  let initNum;
  if (numberPart === '') {
    initNum = 1;
  } else if (numberPart.indexOf('/') !== -1) {
    const pieces = numberPart.split('/');
    if (pieces.length !== 2) return { error: 'invalid number' };
    const a = Number(pieces[0]);
    const b = Number(pieces[1]);
    if (!isFinite(a) || !isFinite(b) || b === 0) return { error: 'invalid number' };
    initNum = a / b;
  } else {
    const value = Number(numberPart);
    if (!isFinite(value)) return { error: 'invalid number' };
    initNum = value;
  }

  const { factor, other } = CONVERSIONS[unitPart];
  const displayUnit = unitPart === 'l' ? 'L' : unitPart;
  const displayOther = other === 'l' ? 'L' : other;

  return {
    initNum,
    initUnit: displayUnit,
    returnNum: initNum * factor,
    returnUnit: displayOther
  };
}

async function convertApi(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });
  if (url.pathname.replace(/\/+$/, '') !== '/api/convert') return json(res, 404, { error: 'not found' });

  const input = url.searchParams.get('input');
  const result = parseConvertInput(input);
  if (result.error) return text(res, 200, result.error);
  return json(res, 200, result);
}

/* --------------------------------------------------- api: issue tracker */

const issueStore = new Map(); // project -> [issue]

const ISSUE_FIELDS = ['issue_title', 'issue_text', 'created_by', 'assigned_to', 'status_text'];

async function issueTrackerApi(req, res, url) {
  const match = /^\/api\/issues\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return json(res, 404, { error: 'not found' });
  const project = decodeURIComponent(match[1]);
  if (!issueStore.has(project)) issueStore.set(project, []);

  const params = await readParams(req, url);

  if (req.method === 'POST') {
    const missing = ['issue_title', 'issue_text', 'created_by'].filter((f) => !params[f]);
    if (missing.length) return json(res, 200, { error: 'required field(s) missing' });
    const stamp = nowStamp();
    const issue = {
      _id: makeId(),
      issue_title: params.issue_title,
      issue_text: params.issue_text,
      created_by: params.created_by,
      assigned_to: params.assigned_to || '',
      status_text: params.status_text || '',
      created_on: stamp,
      updated_on: stamp,
      open: (params.status_text || '').toLowerCase() !== 'closed'
    };
    issueStore.get(project).push(issue);
    return json(res, 200, issue);
  }

  if (req.method === 'GET') {
    const filters = {};
    for (const [k, v] of url.searchParams.entries()) filters[k] = v;
    let issues = issueStore.get(project).slice();
    const keys = Object.keys(filters);
    if (keys.length) {
      issues = issues.filter((issue) => keys.every((k) => String(issue[k]) === String(filters[k])));
    }
    return json(res, 200, issues);
  }

  if (req.method === 'PUT') {
    const id = params._id;
    if (!id) return json(res, 200, { error: 'missing _id' });
    const updates = ISSUE_FIELDS.filter((f) => params[f] !== undefined);
    if (!updates.length) return json(res, 200, { error: 'no update field(s) sent', _id: id });
    const issue = issueStore.get(project).find((i) => i._id === id);
    if (!issue) return json(res, 200, { error: 'could not update', _id: id });
    for (const field of updates) issue[field] = params[field];
    if (params.status_text !== undefined) {
      issue.open = String(params.status_text).toLowerCase() !== 'closed';
    }
    issue.updated_on = nowStamp();
    return json(res, 200, { result: 'successfully updated', _id: id });
  }

  if (req.method === 'DELETE') {
    const id = params._id;
    if (!id) return json(res, 200, { error: 'missing _id' });
    const issues = issueStore.get(project);
    const index = issues.findIndex((i) => i._id === id);
    if (index === -1) return json(res, 200, { error: 'could not delete', _id: id });
    issues.splice(index, 1);
    return json(res, 200, { result: 'successfully deleted', _id: id });
  }

  return json(res, 405, { error: 'Method Not Allowed' });
}

/* ------------------------------------------------ api: personal library */

const library = new Map();

async function libraryApi(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const params = await readParams(req, url);

  if (path === '/api/books') {
    if (req.method === 'POST') {
      if (!params.title) return text(res, 200, 'missing required field title');
      const book = { _id: makeId(), title: params.title, comments: [] };
      library.set(book._id, book);
      return json(res, 200, { title: book.title, _id: book._id });
    }
    if (req.method === 'GET') {
      return json(res, 200, Array.from(library.values()).map((b) => ({
        title: b.title,
        _id: b._id,
        commentcount: b.comments.length
      })));
    }
    if (req.method === 'DELETE') {
      library.clear();
      return text(res, 200, 'complete delete successful');
    }
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  const bookMatch = /^\/api\/books\/([^/]+)$/.exec(path);
  if (bookMatch) {
    const id = decodeURIComponent(bookMatch[1]);
    const book = library.get(id);
    if (req.method === 'GET') {
      if (!book) return text(res, 200, 'no book exists');
      return json(res, 200, { title: book.title, _id: book._id, comments: book.comments });
    }
    if (req.method === 'POST') {
      if (!book) return text(res, 200, 'no book exists');
      if (!params.comment) return text(res, 200, 'missing required field comment');
      book.comments.push({ _id: makeId(), comment: params.comment });
      return json(res, 200, { title: book.title, _id: book._id, comments: book.comments });
    }
    if (req.method === 'DELETE') {
      if (!book) return text(res, 200, 'no book exists');
      library.delete(id);
      return text(res, 200, 'delete successful');
    }
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  return json(res, 404, { error: 'not found' });
}

/* ----------------------------------------------------- api: sudoku solver */

const EMPTY = '.';

function isValidSudokuChars(puzzle) {
  return /^[1-9.]*$/.test(puzzle);
}

function solveSudoku(puzzle) {
  const grid = puzzle.split('');
  function isSafe(index, num) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    for (let i = 0; i < 9; i++) {
      if (grid[row * 9 + i] === num) return false;
      if (grid[i * 9 + col] === num) return false;
    }
    const r = Math.floor(row / 3) * 3;
    const c = Math.floor(col / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (grid[(r + i) * 9 + (c + j)] === num) return false;
      }
    }
    return true;
  }
  function solve(index) {
    if (index === 81) return true;
    if (grid[index] !== EMPTY) return solve(index + 1);
    for (let n = 1; n <= 9; n++) {
      const value = String(n);
      if (isSafe(index, value)) {
        grid[index] = value;
        if (solve(index + 1)) return true;
        grid[index] = EMPTY;
      }
    }
    return false;
  }
  return solve(0) ? grid.join('') : null;
}

function checkSudoku(puzzle, coordinate, value) {
  const index = (coordinate.charCodeAt(0) - 65) * 9 + (Number(coordinate.slice(1)) - 1);
  const conflict = [];
  const row = Math.floor(index / 9);
  const col = index % 9;
  for (let i = 0; i < 9; i++) {
    const other = puzzle[row * 9 + i];
    if (i !== col && other === value) { conflict.push('row'); break; }
  }
  for (let i = 0; i < 9; i++) {
    const other = puzzle[i * 9 + col];
    if (i !== row && other === value) { conflict.push('column'); break; }
  }
  const r = Math.floor(row / 3) * 3;
  const c = Math.floor(col / 3) * 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const other = puzzle[(r + i) * 9 + (c + j)];
      if (!(i === row - r && j === col - c) && other === value) { conflict.push('region'); break; }
    }
  }
  return { valid: conflict.length === 0, conflict: conflict.length ? conflict : undefined };
}

async function sudokuApi(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const params = await readParams(req, url);

  if (path === '/api/solve' && req.method === 'POST') {
    const puzzle = params.puzzle;
    if (puzzle === undefined || puzzle === null || puzzle === '') {
      return json(res, 200, { error: 'Required field missing' });
    }
    const value = String(puzzle);
    if (!isValidSudokuChars(value)) return json(res, 200, { error: 'Invalid characters in puzzle' });
    if (value.length !== 81) return json(res, 200, { error: 'Expected puzzle to be 81 characters long' });
    const solution = solveSudoku(value);
    if (!solution) return json(res, 200, { error: 'Puzzle cannot be solved' });
    return json(res, 200, { solution });
  }

  if (path === '/api/check' && req.method === 'POST') {
    const { puzzle, coordinate, value } = params;
    if (puzzle === undefined || puzzle === null || puzzle === '' ||
        coordinate === undefined || coordinate === null || coordinate === '' ||
        value === undefined || value === null || value === '') {
      return json(res, 200, { error: 'Required field missing' });
    }
    const p = String(puzzle);
    if (!isValidSudokuChars(p)) return json(res, 200, { error: 'Invalid characters in puzzle' });
    if (p.length !== 81) return json(res, 200, { error: 'Expected puzzle to be 81 characters long' });
    const coord = String(coordinate).toUpperCase();
    const result = checkSudoku(p, coord, String(value));
    if (result.valid) return json(res, 200, { valid: true });
    return json(res, 200, { valid: false, conflict: result.conflict });
  }

  return json(res, 404, { error: 'not found' });
}

/* ------------------------------------------------- api: american-british */

const TERMS = [
  ['color', 'colour'], ['colors', 'colours'], ['colored', 'coloured'],
  ['favorite', 'favourite'], ['favorites', 'favourites'],
  ['center', 'centre'], ['centers', 'centres'], ['centered', 'centred'],
  ['theater', 'theatre'], ['gray', 'grey'], ['traveling', 'travelling'],
  ['traveled', 'travelled'], ['catalog', 'catalogue'],
  ['humor', 'humour'], ['labor', 'labour'], ['neighbor', 'neighbour'],
  ['neighbors', 'neighbours'], ['organization', 'organisation'],
  ['organizations', 'organisations'], ['realize', 'realise'],
  ['apologize', 'apologise'], ['specialized', 'specialised'],
  ['defense', 'defence'], ['jewelry', 'jewellery'], ['airplane', 'aeroplane'],
  ['airplanes', 'aeroplanes'], ['garbage', 'rubbish'], ['truck', 'lorry'],
  ['trucks', 'lorries'], ['soccer', 'football'], ['elevator', 'lift'],
  ['apartment', 'flat'], ['apartments', 'flats'], ['candy', 'sweets'],
  ['cell phone', 'mobile phone'], ['vacation', 'holiday'], ['vacations', 'holidays'],
  ['math', 'maths'], ['mathematics', 'mathematics'], ['program', 'programme'],
  ['programs', 'programmes'], ['aluminum', 'aluminium'], ['tire', 'tyre'],
  ['tires', 'tyres'], ['airplane', 'aeroplane'], ['marathon', 'marathon'],
  ['subway', 'underground'], ['store', 'shop'], ['cookie', 'biscuit'],
  ['cookies', 'biscuits'], ['sweater', 'jumper'], ['pants', 'trousers'],
  ['sneakers', 'trainers'], ['trash', 'rubbish'], ['mailbox', 'postbox'],
  ['mustache', 'moustache'], ['pajamas', 'pyjamas'], ['yogurt', 'yoghurt'],
  ['airplane', 'aeroplane'], ['woman', 'woman'], ['women', 'women']
];

const TITLES = [
  ['Dr.', 'Dr'], ['Mr.', 'Mr'], ['Mrs.', 'Mrs'], ['Ms.', 'Ms'],
  ['Doctor', 'Dr'], ['Gov.', 'Governor'], ['Senator', 'Senator'],
  ['Sen.', 'Senator'], ['Pres.', 'President'], ['Capt.', 'Captain'],
  ['Lt.', 'Lieutenant'], ['Col.', 'Colonel'], ['Sgt.', 'Sergeant'],
  ['Rev.', 'Reverend'], ['Atty.', 'Attorney'], ['Gen.', 'General'],
  ['Adm.', 'Admiral'], ['Cmdr.', 'Commander'], ['Maj.', 'Major'],
  ['Hon.', 'Hon.'], ['Prof.', 'Professor'], ['Esq.', 'Esq.']
];

const REVERSE_TITLES = [
  ['Dr', 'Dr.'], ['Mr', 'Mr.'], ['Mrs', 'Mrs.'], ['Ms', 'Ms.'],
  ['Doctor', 'Dr.'], ['Governor', 'Gov.'], ['Senator', 'Sen.'],
  ['President', 'Pres.'], ['Captain', 'Capt.'], ['Lieutenant', 'Lt.'],
  ['Colonel', 'Col.'], ['Sergeant', 'Sgt.'], ['Reverend', 'Rev.'],
  ['Attorney', 'Atty.'], ['General', 'Gen.'], ['Admiral', 'Adm.'],
  ['Commander', 'Cmdr.'], ['Major', 'Maj.'], ['Professor', 'Prof.']
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrap(text) {
  return `<span class="highlight">${text}</span>`;
}

function translateText(text, locale) {
  let out = text;

  if (locale === 'american-to-british') {
    // Times: 10:30 -> 10.30
    out = out.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, m2) => wrap(`${h}.${m2}`));
    for (const [from, to] of TERMS) {
      const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi');
      out = out.replace(re, wrap(to));
    }
    for (const [from, to] of TITLES) {
      const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
      out = out.replace(re, wrap(to));
    }
  } else {
    // Times: 10.30 -> 10:30
    out = out.replace(/\b(\d{1,2})\.(\d{2})\b/g, (m, h, m2) => wrap(`${h}:${m2}`));
    for (const [american, british] of TERMS) {
      const re = new RegExp(`\\b${escapeRegExp(british)}\\b`, 'gi');
      out = out.replace(re, wrap(american));
    }
    for (const [from, to] of REVERSE_TITLES) {
      const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
      out = out.replace(re, wrap(to));
    }
  }

  return out;
}

async function translateApi(req, res, url) {
  if (url.pathname.replace(/\/+$/, '') !== '/api/translate') return json(res, 404, { error: 'not found' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

  const params = await readParams(req, url);
  const { text, locale } = params;

  if (text === undefined || text === null || locale === undefined || locale === null) {
    return json(res, 200, { error: 'Required field(s) missing' });
  }
  if (String(text).trim() === '') return json(res, 200, { error: 'No text to translate' });
  if (locale !== 'american-to-british' && locale !== 'british-to-american') {
    return json(res, 200, { error: 'Invalid value for locale field' });
  }

  const translation = translateText(String(text), locale);
  const hasChange = translation !== String(text);
  return json(res, 200, {
    text: String(text),
    translation: hasChange ? translation : 'Everything looks good to me!'
  });
}

/* --------------------------------------------------------------- server */

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>freeCodeCamp Quality Assurance</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:48px 24px}
.wrap{max-width:720px;margin:0 auto}h1{font-size:26px;margin:0 0 8px}p{color:#8b949e;line-height:1.6}
code{color:#79c0ff}li{margin:6px 0;color:#c9d1d9}</style></head>
<body><div class="wrap"><h1>Quality Assurance</h1>
<p>Dependency-free Node.js microservices for the freeCodeCamp QA certification.</p>
<ul><li><code>GET /api/convert</code> &mdash; metric / imperial converter</li>
<li><code>GET|POST|PUT|DELETE /api/issues/:project</code> &mdash; issue tracker</li>
<li><code>GET|POST|DELETE /api/books</code> &mdash; personal library</li>
<li><code>POST /api/solve</code>, <code>POST /api/check</code> &mdash; sudoku solver</li>
<li><code>POST /api/translate</code> &mdash; american / british translator</li></ul>
</div></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  console.log(`[${API}] ${req.method} ${req.url} origin=${req.headers.origin || '-'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
    return res.end(PAGE);
  }

  try {
    if (API === 'convert') return await convertApi(req, res, url);
    if (API === 'issuetracker') return await issueTrackerApi(req, res, url);
    if (API === 'library') return await libraryApi(req, res, url);
    if (API === 'sudoku') return await sudokuApi(req, res, url);
    if (API === 'translate') return await translateApi(req, res, url);
    return json(res, 404, { error: 'unknown api' });
  } catch (err) {
    return json(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${API}] listening on http://0.0.0.0:${PORT}`);
});
