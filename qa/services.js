'use strict';

/**
 * Quality Assurance certification services.
 *
 * Every service is a plain object of functions so the test suites can exercise the
 * logic directly and the HTTP layer can expose it as JSON.
 */

/* ------------------------------------------------------- metric converter */

const CONVERTER_UNITS = {
  gal: { returnUnit: 'l', factor: 3.78541, spelled: 'gallons' },
  l: { returnUnit: 'gal', factor: 1 / 3.78541, spelled: 'liters' },
  lbs: { returnUnit: 'kg', factor: 0.453592, spelled: 'pounds' },
  kg: { returnUnit: 'lbs', factor: 1 / 0.453592, spelled: 'kilograms' },
  mi: { returnUnit: 'km', factor: 1.60934, spelled: 'miles' },
  km: { returnUnit: 'mi', factor: 1 / 1.60934, spelled: 'kilometers' }
};

const round5 = (value) => Math.round(value * 1e5) / 1e5;

/** Splits "3/2/7kg" into its number and unit halves. */
function splitInput(input) {
  const raw = String(input === undefined || input === null ? '' : input).trim();
  const unitStart = raw.search(/[a-zA-Z]/);
  if (unitStart === -1) {
    return { numberPart: raw, unitPart: '', unitFound: false };
  }
  return {
    numberPart: raw.slice(0, unitStart).trim(),
    unitPart: raw.slice(unitStart).trim().toLowerCase(),
    unitFound: true
  };
}

/** Returns the numeric part of the input, or null when it is not a usable number. */
function parseNumber(text) {
  if (text === '') return 1; // no number supplied defaults to 1
  if (text.indexOf('/') !== -1) {
    const parts = text.split('/');
    if (parts.length !== 2) return null; // double fraction
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return null;
    return numerator / denominator;
  }
  const value = Number(text);
  if (!isFinite(value)) return null;
  return value;
}

/** Spells a unit out in full, e.g. "mi" -> "miles". */
function spellOutUnit(unit) {
  const entry = CONVERTER_UNITS[unit.toLowerCase()];
  return entry ? entry.spelled : unit;
}

/**
 * Converts an input such as "10gal".
 * Returns { error } for invalid input, otherwise the conversion result.
 */
function convert(input) {
  const { numberPart, unitPart, unitFound } = splitInput(input);
  const number = parseNumber(numberPart);
  const unit = CONVERTER_UNITS[unitPart];
  const unitValid = unitFound && Boolean(unit);
  const numberValid = number !== null;

  if (!unitValid && !numberValid) return { error: 'invalid number and unit' };
  if (!unitValid) return { error: 'invalid unit' };
  if (!numberValid) return { error: 'invalid number' };

  const initNum = number;
  const initUnit = unitPart === 'l' ? 'L' : unitPart;
  const returnUnit = unit.returnUnit === 'l' ? 'L' : unit.returnUnit;
  const returnNum = round5(initNum * unit.factor);
  const string = `${initNum} ${spellOutUnit(unitPart)} converts to ${returnNum} ${spellOutUnit(
    unit.returnUnit
  )}`;

  return { initNum, initUnit, returnNum, returnUnit, string };
}

/* ----------------------------------------------------------- issue tracker */

const ISSUE_FIELDS = ['issue_title', 'issue_text', 'created_by', 'assigned_to', 'status_text'];
const issueProjects = new Map();

function issueList(project) {
  if (!issueProjects.has(project)) issueProjects.set(project, []);
  return issueProjects.get(project);
}

function createIssue(project, input) {
  const missing = ['issue_title', 'issue_text', 'created_by'].filter((f) => !input[f]);
  if (missing.length) return { error: 'required field(s) missing' };

  const created = Date.now();
  const issue = {
    _id: Math.random().toString(36).slice(2, 12),
    issue_title: input.issue_title,
    issue_text: input.issue_text,
    created_by: input.created_by,
    assigned_to: input.assigned_to || '',
    status_text: input.status_text || '',
    created_on: new Date(created).toISOString(),
    updated_on: new Date(created).toISOString(),
    open: String(input.status_text || '').toLowerCase() !== 'closed'
  };
  issueList(project).push(issue);
  return issue;
}

function getIssues(project, query) {
  const filters = Object.keys(query || {});
  return issueList(project).filter((issue) =>
    filters.every((key) => String(issue[key]) === String(query[key]))
  );
}

function updateIssue(project, input) {
  if (!input._id) return { error: 'missing _id' };
  const fields = ISSUE_FIELDS.filter((f) => input[f] !== undefined);
  if (!fields.length) return { error: 'no update field(s) sent', _id: input._id };

  const issue = issueList(project).find((i) => i._id === input._id);
  if (!issue) return { error: 'could not update', _id: input._id };

  for (const field of fields) issue[field] = input[field];
  if (input.status_text !== undefined) {
    issue.open = String(input.status_text).toLowerCase() !== 'closed';
  }
  // The updated timestamp has to be strictly later than the created one.
  issue.updated_on = new Date(Math.max(Date.now(), Date.parse(issue.created_on) + 1)).toISOString();
  return { result: 'successfully updated', _id: issue._id };
}

function deleteIssue(project, input) {
  if (!input._id) return { error: 'missing _id' };
  const issues = issueList(project);
  const index = issues.findIndex((i) => i._id === input._id);
  if (index === -1) return { error: 'could not delete', _id: input._id };
  issues.splice(index, 1);
  return { result: 'successfully deleted', _id: input._id };
}

/* --------------------------------------------------------- personal library */

const library = new Map();

function addBook(input) {
  if (!input.title) return { text: 'missing required field title' };
  const book = { _id: Math.random().toString(36).slice(2, 12), title: input.title, comments: [] };
  library.set(book._id, book);
  return { body: { title: book.title, _id: book._id } };
}

function listBooks() {
  return Array.from(library.values()).map((b) => ({
    title: b.title,
    _id: b._id,
    commentcount: b.comments.length
  }));
}

function getBook(id) {
  const book = library.get(id);
  if (!book) return { text: 'no book exists' };
  return { body: { title: book.title, _id: book._id, comments: book.comments } };
}

function addComment(id, input) {
  const book = library.get(id);
  if (!book) return { text: 'no book exists' };
  if (!input.comment) return { text: 'missing required field comment' };
  book.comments.push({ _id: Math.random().toString(36).slice(2, 12), comment: input.comment });
  return { body: { title: book.title, _id: book._id, comments: book.comments } };
}

function deleteBook(id) {
  if (!library.has(id)) return { text: 'no book exists' };
  library.delete(id);
  return { text: 'delete successful' };
}

function deleteAllBooks() {
  library.clear();
  return { text: 'complete delete successful' };
}

/* ------------------------------------------------------------ sudoku solver */

const SUDOKU_EMPTY = '.';

function solveSudoku(puzzle) {
  const grid = puzzle.split('');

  function isSafe(index, num) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    for (let i = 0; i < 9; i++) {
      if (grid[row * 9 + i] === num) return false;
      if (grid[i * 9 + col] === num) return false;
    }
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (grid[(boxRow + i) * 9 + (boxCol + j)] === num) return false;
      }
    }
    return true;
  }

  function solve(index) {
    if (index === 81) return true;
    if (grid[index] !== SUDOKU_EMPTY) return solve(index + 1);
    for (let n = 1; n <= 9; n++) {
      const value = String(n);
      if (isSafe(index, value)) {
        grid[index] = value;
        if (solve(index + 1)) return true;
        grid[index] = SUDOKU_EMPTY;
      }
    }
    return false;
  }

  return solve(0) ? grid.join('') : null;
}

function checkPlacement(puzzle, coordinate, value) {
  const index = (coordinate.charCodeAt(0) - 65) * 9 + (Number(coordinate.slice(1)) - 1);
  const row = Math.floor(index / 9);
  const col = index % 9;
  const conflict = [];

  for (let i = 0; i < 9; i++) {
    if (i !== col && puzzle[row * 9 + i] === value) {
      conflict.push('row');
      break;
    }
  }
  for (let i = 0; i < 9; i++) {
    if (i !== row && puzzle[i * 9 + col] === value) {
      conflict.push('column');
      break;
    }
  }
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const inThisCell = boxRow + i === row && boxCol + j === col;
      if (!inThisCell && puzzle[(boxRow + i) * 9 + (boxCol + j)] === value) {
        conflict.push('region');
        break;
      }
    }
  }

  return conflict.length ? { valid: false, conflict } : { valid: true };
}

const isSudokuChars = (puzzle) => /^[1-9.]*$/.test(puzzle);
const isCoordinate = (coordinate) => /^[A-I][1-9]$/.test(String(coordinate));
const isValue = (value) => /^[1-9]$/.test(String(value));

/* ---------------------------------------------------------- american/british */

const americanToBritishSpelling = require('./components/american-to-british-spelling.js');
const americanToBritishTitles = require('./components/american-to-british-titles.js');
const americanOnly = require('./components/american-only.js');
const britishOnly = require('./components/british-only.js');

/** Words that only exist in one dialect and need an explicit translation. */
const EXTRA_AMERICAN_TO_BRITISH = {
  doctor: 'dr',
  'high tech': 'high-tech'
};

const EXTRA_BRITISH_TO_AMERICAN = {
  truant: 'hooky',
  'high-tech': 'high tech',
  paracetamol: 'acetaminophen'
};

function invert(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (!(value in out)) out[value] = key;
  }
  return out;
}

function buildMaps() {
  const toBritish = Object.assign({}, americanToBritishSpelling, americanOnly, EXTRA_AMERICAN_TO_BRITISH);
  const toAmerican = Object.assign(
    {},
    invert(americanToBritishSpelling),
    invert(americanOnly),
    britishOnly,
    EXTRA_BRITISH_TO_AMERICAN
  );

  // Titles are handled by their own map. Removing them from the term maps avoids
  // translating "Mrs" twice (which would produce "Mrs..").
  const titleWords = new Set(
    Object.keys(americanToBritishTitles).concat(Object.values(americanToBritishTitles))
  );
  for (const key of Object.keys(toBritish)) if (titleWords.has(key)) delete toBritish[key];
  for (const key of Object.keys(toAmerican)) if (titleWords.has(key)) delete toAmerican[key];

  return { toBritish, toAmerican };
}

const TRANSLATION_MAPS = buildMaps();

/** American title abbreviations ("Dr.") become British ("Dr"). */
const TITLE_TO_BRITISH = Object.assign({}, americanToBritishTitles);
// The keys of the American map are the abbreviations with their full stop, so the
// reverse map reuses them as they are.
const TITLE_TO_AMERICAN = {};
for (const [americanTitle, britishTitle] of Object.entries(TITLE_TO_BRITISH)) {
  TITLE_TO_AMERICAN[britishTitle] = americanTitle;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Keeps the capitalisation of the matched text, e.g. "Dr." -> "Dr". */
function matchCase(original, replacement) {
  if (!original || !replacement) return replacement;
  if (original[0] === original[0].toUpperCase() && replacement[0] === replacement[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function buildTermPattern(term) {
  const escaped = escapeRegExp(term);
  // A title such as "dr." ends with a full stop, so a trailing word boundary would
  // not match; require only that the term is not followed by another letter.
  return term.endsWith('.')
    ? `(?<![a-zA-Z])${escaped}(?![a-zA-Z])`
    : `(?<![a-zA-Z])${escaped}(?![a-zA-Z])`;
}

function applyTerms(text, map) {
  let out = text;
  const terms = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const pattern = new RegExp(buildTermPattern(term), 'gi');
    out = out.replace(pattern, (match) => `<span class="highlight">${matchCase(match, map[term])}</span>`);
  }
  return out;
}

function applyTitles(text, map) {
  let out = text;
  const terms = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const pattern = new RegExp(buildTermPattern(term), 'gi');
    out = out.replace(pattern, (match) => `<span class="highlight">${matchCase(match, map[term])}</span>`);
  }
  return out;
}

function translateTime(text, locale) {
  if (locale === 'american-to-british') {
    return text.replace(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, (m, h, m2) =>
      `<span class="highlight">${h}.${m2}</span>`
    );
  }
  return text.replace(/(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g, (m, h, m2) =>
    `<span class="highlight">${h}:${m2}</span>`
  );
}

function translate(text, locale) {
  let out = translateTime(String(text), locale);
  const terms = locale === 'american-to-british' ? TRANSLATION_MAPS.toBritish : TRANSLATION_MAPS.toAmerican;
  const titles = locale === 'american-to-british' ? TITLE_TO_BRITISH : TITLE_TO_AMERICAN;

  out = applyTerms(out, terms);
  out = applyTitles(out, titles);
  return out;
}

module.exports = {
  convert,
  round5,
  splitInput,
  parseNumber,
  spellOutUnit,
  CONVERTER_UNITS,
  createIssue,
  getIssues,
  updateIssue,
  deleteIssue,
  addBook,
  listBooks,
  getBook,
  addComment,
  deleteBook,
  deleteAllBooks,
  solveSudoku,
  checkPlacement,
  isSudokuChars,
  isCoordinate,
  isValue,
  translate,
  TRANSLATION_MAPS
};
