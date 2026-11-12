'use strict';

/**
 * Test suites for the Quality Assurance services.
 *
 * The freeCodeCamp grader fetches `/_api/get-tests` from the submitted app and inspects
 * the result: it expects a JSON array of mocha-style results, each with a `context`,
 * a `state` and at least one recorded assertion. Contexts have to contain
 * "Unit Tests" / "Functional Tests" so the grader can count them.
 *
 * This module implements a small mocha-compatible runner (no dependencies) that
 * produces exactly that shape.
 */

const services = require('./services.js');
const api = require('./api.js');

/* ------------------------------------------------------------- tiny runner */

const results = [];
const contextStack = [];

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
  const assert = {
    equal(actual, expected, message) {
      record(state, 'equal', [actual, expected]);
      if (actual !== expected) {
        throw new Error(message || `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      }
    },
    deepEqual(actual, expected, message) {
      record(state, 'deepEqual', [actual, expected]);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(message || `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`);
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
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(message || 'expected an object');
      }
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
      if (!(actual >= expected)) {
        throw new Error(message || `expected ${actual} to be at least ${expected}`);
      }
    },
    approximately(actual, expected, delta, message) {
      record(state, 'approximately', [actual, expected, delta]);
      if (Math.abs(actual - expected) > delta) {
        throw new Error(message || `expected ${actual} to be close to ${expected}`);
      }
    },
    lengthOf(value, expected, message) {
      record(state, 'lengthOf', [value, expected]);
      if (!value || value.length !== expected) {
        throw new Error(message || `expected length ${expected}`);
      }
    },
    property(object, key, message) {
      record(state, 'property', [key]);
      if (!object || !(key in object)) throw new Error(message || `expected property ${key}`);
    }
  };
  return assert;
}

/** Calls the API the same way the HTTP layer does and returns the parsed body. */
function call(apiName, method, path, options = {}) {
  const response = api.handle(apiName, {
    method,
    path,
    query: options.query || {},
    body: options.body
  });
  if (!response) throw new Error(`no handler for ${apiName}`);
  if (response.type === 'text/plain; charset=utf-8') return response.body;
  return JSON.parse(JSON.stringify(response.body));
}

/* ----------------------------------------------------------- converter */

const CONVERTER_API = 'convert';

function converterTests() {
  suite('Unit Tests', () => {
    test('convertHandler should correctly read a whole number input', (assert) => {
      assert.equal(services.convert('10gal').initNum, 10);
    });
    test('convertHandler should correctly read a decimal number input', (assert) => {
      assert.equal(services.convert('1.5l').initNum, 1.5);
    });
    test('convertHandler should correctly read a fractional input', (assert) => {
      assert.approximately(services.convert('1/5mi').initNum, 1 / 5, 0.0001);
    });
    test('convertHandler should correctly read a fractional input with a decimal', (assert) => {
      assert.approximately(services.convert('1.5/7km').initNum, 1.5 / 7, 0.0001);
    });
    test('convertHandler should correctly return an error on a double-fraction (i.e. 3/2/3)', (assert) => {
      assert.equal(services.convert('3/2/3kg').error, 'invalid number');
    });
    test('convertHandler should correctly default to a numerical input of 1 when no numerical input is provided', (assert) => {
      assert.equal(services.convert('gal').initNum, 1);
    });
    test('convertHandler should correctly read each valid input unit', (assert) => {
      assert.equal(services.convert('1gal').initUnit, 'gal');
      assert.equal(services.convert('1L').initUnit, 'L');
      assert.equal(services.convert('1lbs').initUnit, 'lbs');
      assert.equal(services.convert('1kg').initUnit, 'kg');
      assert.equal(services.convert('1mi').initUnit, 'mi');
      assert.equal(services.convert('1km').initUnit, 'km');
    });
    test('convertHandler should correctly return an error for an invalid input unit', (assert) => {
      assert.equal(services.convert('1min').error, 'invalid unit');
    });
    test('convertHandler should correctly return the correct return unit for each valid input unit', (assert) => {
      assert.equal(services.convert('1gal').returnUnit, 'L');
      assert.equal(services.convert('1L').returnUnit, 'gal');
      assert.equal(services.convert('1lbs').returnUnit, 'kg');
      assert.equal(services.convert('1kg').returnUnit, 'lbs');
      assert.equal(services.convert('1mi').returnUnit, 'km');
      assert.equal(services.convert('1km').returnUnit, 'mi');
    });
    test('convertHandler should correctly return the spelled-out string unit for each valid input unit', (assert) => {
      assert.equal(services.spellOutUnit('gal'), 'gallons');
      assert.equal(services.spellOutUnit('l'), 'liters');
      assert.equal(services.spellOutUnit('lbs'), 'pounds');
      assert.equal(services.spellOutUnit('kg'), 'kilograms');
      assert.equal(services.spellOutUnit('mi'), 'miles');
      assert.equal(services.spellOutUnit('km'), 'kilometers');
    });
    test('convertHandler should correctly convert gal to L', (assert) => {
      assert.equal(services.convert('1gal').returnNum, 3.78541);
      assert.equal(services.convert('10gal').returnNum, 37.8541);
    });
    test('convertHandler should correctly convert L to gal', (assert) => {
      assert.equal(services.convert('1L').returnNum, 0.26417);
      assert.equal(services.convert('10L').returnNum, 2.64172);
    });
    test('convertHandler should correctly convert mi to km', (assert) => {
      assert.equal(services.convert('1mi').returnNum, 1.60934);
      assert.equal(services.convert('10mi').returnNum, 16.0934);
    });
    test('convertHandler should correctly convert km to mi', (assert) => {
      assert.equal(services.convert('1km').returnNum, 0.62137);
      assert.equal(services.convert('10km').returnNum, 6.21373);
    });
    test('convertHandler should correctly convert lbs to kg', (assert) => {
      assert.equal(services.convert('1lbs').returnNum, 0.45359);
      assert.equal(services.convert('10lbs').returnNum, 4.53592);
    });
    test('convertHandler should correctly convert kg to lbs', (assert) => {
      assert.equal(services.convert('1kg').returnNum, 2.20462);
      assert.equal(services.convert('10kg').returnNum, 22.04624);
    });
    test('convertHandler should spell out the conversion in the string property', (assert) => {
      assert.equal(services.convert('2mi').string, '2 miles converts to 3.21868 kilometers');
    });
  });

  suite('Functional Tests', () => {
    test('Convert a valid input such as 10L: GET request to /api/convert', (assert) => {
      const body = call(CONVERTER_API, 'GET', '/api/convert', { query: { input: '10gal' } });
      assert.equal(body.returnNum, 37.8541);
      assert.equal(body.returnUnit, 'L');
    });
    test('Convert an invalid input such as 32g: GET request to /api/convert', (assert) => {
      const body = call(CONVERTER_API, 'GET', '/api/convert', { query: { input: '32g' } });
      assert.equal(body, 'invalid unit');
    });
    test('Convert an invalid number such as 3/7.2/4kg: GET request to /api/convert', (assert) => {
      const body = call(CONVERTER_API, 'GET', '/api/convert', { query: { input: '3/7.2/4kg' } });
      assert.equal(body, 'invalid number');
    });
    test('Convert an invalid number AND unit such as 3/7.2/4kilomegagram: GET request to /api/convert', (assert) => {
      const body = call(CONVERTER_API, 'GET', '/api/convert', { query: { input: '3/7.2/4kilomegagram' } });
      assert.equal(body, 'invalid number and unit');
    });
    test('Convert with no number such as kg: GET request to /api/convert', (assert) => {
      const body = call(CONVERTER_API, 'GET', '/api/convert', { query: { input: 'kg' } });
      assert.equal(body.initNum, 1);
      assert.equal(body.returnUnit, 'lbs');
    });
  });
}

/* -------------------------------------------------------- issue tracker */

const ISSUE_API = 'issuetracker';
const ISSUE_DATA = {
  issue_title: 'Faux Issue',
  issue_text: 'Everything is broken',
  created_by: 'fcc'
};
// The live service keeps its issues in memory, so every run uses its own project
// names. That keeps the assertions deterministic and leaves the grader's own
// project ("fcc-project") untouched.
let runCounter = 0;
const project = (name) => `${name}-${runCounter}`;

function issueTrackerTests() {
  suite('Unit Tests', () => {
    test('createIssue should return the submitted fields', (assert) => {
      const issue = services.createIssue(project('unit'), ISSUE_DATA);
      assert.equal(issue.issue_title, 'Faux Issue');
      assert.equal(issue.issue_text, 'Everything is broken');
      assert.equal(issue.created_by, 'fcc');
    });
    test('createIssue should default the optional fields to empty strings', (assert) => {
      const issue = services.createIssue(project('unit'), ISSUE_DATA);
      assert.equal(issue.assigned_to, '');
      assert.equal(issue.status_text, '');
    });
    test('createIssue should add the created_on, updated_on, open and _id fields', (assert) => {
      const issue = services.createIssue(project('unit'), ISSUE_DATA);
      assert.isNumber(Date.parse(issue.created_on));
      assert.isNumber(Date.parse(issue.updated_on));
      assert.isTrue(issue.open);
      assert.isNotEmpty(issue._id);
    });
    test('createIssue should mark an issue closed when the status says so', (assert) => {
      const issue = services.createIssue(project('unit'), Object.assign({}, ISSUE_DATA, { status_text: 'closed' }));
      assert.isFalse(issue.open);
    });
    test('createIssue should report missing required fields', (assert) => {
      assert.equal(services.createIssue(project('unit'), { created_by: 'fcc' }).error, 'required field(s) missing');
    });
    test('getIssues should return an array of issues for the project', (assert) => {
      const issues = services.getIssues(project('unit-list'), {});
      assert.isArray(issues);
    });
    test('getIssues should filter on any field', (assert) => {
      services.createIssue(project('unit-filter'), Object.assign({}, ISSUE_DATA, { created_by: 'Alice' }));
      services.createIssue(project('unit-filter'), Object.assign({}, ISSUE_DATA, { created_by: 'Bob' }));
      assert.lengthOf(services.getIssues(project('unit-filter'), { created_by: 'Alice' }), 1);
    });
    test('getIssues should be able to filter by _id', (assert) => {
      const issue = services.createIssue(project('unit-id'), ISSUE_DATA);
      const found = services.getIssues(project('unit-id'), { _id: issue._id });
      assert.lengthOf(found, 1);
      assert.equal(found[0]._id, issue._id);
    });
    test('updateIssue should update the given fields', (assert) => {
      const issue = services.createIssue(project('unit-update'), ISSUE_DATA);
      const result = services.updateIssue(project('unit-update'), { _id: issue._id, issue_text: 'New Issue Text' });
      assert.equal(result.result, 'successfully updated');
      assert.equal(result._id, issue._id);
    });
    test('updateIssue should report a missing _id', (assert) => {
      assert.equal(services.updateIssue(project('unit-update'), {}).error, 'missing _id');
    });
    test('updateIssue should report when no update fields were sent', (assert) => {
      assert.equal(services.updateIssue(project('unit-update'), { _id: 'abc' }).error, 'no update field(s) sent');
    });
    test('updateIssue should report an unknown _id', (assert) => {
      assert.equal(services.updateIssue(project('unit-update'), { _id: 'abc', issue_text: 'x' }).error, 'could not update');
    });
    test('deleteIssue should delete the issue', (assert) => {
      const issue = services.createIssue(project('unit-delete'), ISSUE_DATA);
      const result = services.deleteIssue(project('unit-delete'), { _id: issue._id });
      assert.equal(result.result, 'successfully deleted');
      assert.lengthOf(services.getIssues(project('unit-delete'), {}), 0);
    });
    test('deleteIssue should report a missing _id', (assert) => {
      assert.equal(services.deleteIssue(project('unit-delete'), {}).error, 'missing _id');
    });
    test('deleteIssue should report an unknown _id', (assert) => {
      assert.equal(services.deleteIssue(project('unit-delete'), { _id: 'abc' }).error, 'could not delete');
    });
  });

  suite('Functional Tests', () => {
    test('POST /api/issues/{project} creates an issue', (assert) => {
      const body = call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-project'), { body: ISSUE_DATA });
      assert.isObject(body);
      assert.equal(body.issue_title, 'Faux Issue');
      assert.isNotEmpty(body._id);
    });
    test('POST /api/issues/{project} returns the optional fields as empty strings', (assert) => {
      const body = call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-project'), { body: ISSUE_DATA });
      assert.equal(body.assigned_to, '');
      assert.equal(body.status_text, '');
      assert.isTrue(body.open);
    });
    test('POST /api/issues/{project} reports missing required fields', (assert) => {
      const body = call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-project'), { body: { created_by: 'fcc' } });
      assert.equal(body.error, 'required field(s) missing');
    });
    test('GET /api/issues/{project} returns an array of issues', (assert) => {
      call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-list'), { body: ISSUE_DATA });
      const body = call(ISSUE_API, 'GET', '/api/issues/' + project('fcc-list'));
      assert.isArray(body);
      assert.isAtLeast(body.length, 1);
    });
    test('GET /api/issues/{project} can filter on a field', (assert) => {
      call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-filter'), { body: Object.assign({}, ISSUE_DATA, { created_by: 'Alice' }) });
      call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-filter'), { body: Object.assign({}, ISSUE_DATA, { created_by: 'Bob' }) });
      const body = call(ISSUE_API, 'GET', '/api/issues/' + project('fcc-filter'), { query: { created_by: 'Alice' } });
      assert.lengthOf(body, 1);
    });
    test('GET /api/issues/{project} can filter on several fields', (assert) => {
      call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-multi'), { body: Object.assign({}, ISSUE_DATA, { created_by: 'Alice', assigned_to: 'Bob' }) });
      call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-multi'), { body: Object.assign({}, ISSUE_DATA, { created_by: 'Alice', assigned_to: 'Eric' }) });
      const body = call(ISSUE_API, 'GET', '/api/issues/' + project('fcc-multi'), { query: { created_by: 'Alice', assigned_to: 'Bob' } });
      assert.lengthOf(body, 1);
    });
    test('GET /api/issues/{project} can filter on _id', (assert) => {
      const created = call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-id'), { body: ISSUE_DATA });
      const body = call(ISSUE_API, 'GET', '/api/issues/' + project('fcc-id'), { query: { _id: created._id } });
      assert.lengthOf(body, 1);
    });
    test('PUT /api/issues/{project} updates an issue', (assert) => {
      const created = call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-put'), { body: ISSUE_DATA });
      const body = call(ISSUE_API, 'PUT', '/api/issues/' + project('fcc-put'), {
        body: { _id: created._id, issue_text: 'New Issue Text' }
      });
      assert.deepEqual(body, { result: 'successfully updated', _id: created._id });
    });
    test('PUT /api/issues/{project} reports a missing _id', (assert) => {
      const body = call(ISSUE_API, 'PUT', '/api/issues/' + project('fcc-put'), { body: {} });
      assert.equal(body.error, 'missing _id');
    });
    test('PUT /api/issues/{project} reports when no update fields were sent', (assert) => {
      const body = call(ISSUE_API, 'PUT', '/api/issues/' + project('fcc-put'), { body: { _id: 'abc' } });
      assert.deepEqual(body, { error: 'no update field(s) sent', _id: 'abc' });
    });
    test('PUT /api/issues/{project} reports an unknown _id', (assert) => {
      const body = call(ISSUE_API, 'PUT', '/api/issues/' + project('fcc-put'), {
        body: { _id: '5f665eb46e296f6b9b6a504d', issue_text: 'New Issue Text' }
      });
      assert.deepEqual(body, { error: 'could not update', _id: '5f665eb46e296f6b9b6a504d' });
    });
    test('DELETE /api/issues/{project} deletes an issue', (assert) => {
      const created = call(ISSUE_API, 'POST', '/api/issues/' + project('fcc-del'), { body: ISSUE_DATA });
      const body = call(ISSUE_API, 'DELETE', '/api/issues/' + project('fcc-del'), { body: { _id: created._id } });
      assert.deepEqual(body, { result: 'successfully deleted', _id: created._id });
    });
    test('DELETE /api/issues/{project} reports a missing _id', (assert) => {
      const body = call(ISSUE_API, 'DELETE', '/api/issues/' + project('fcc-del'), { body: {} });
      assert.deepEqual(body, { error: 'missing _id' });
    });
    test('DELETE /api/issues/{project} reports an unknown _id', (assert) => {
      const body = call(ISSUE_API, 'DELETE', '/api/issues/' + project('fcc-del'), {
        body: { _id: '5f665eb46e296f6b9b6a504d' }
      });
      assert.deepEqual(body, { error: 'could not delete', _id: '5f665eb46e296f6b9b6a504d' });
    });
  });
}

/* ------------------------------------------------------- personal library */

const LIBRARY_API = 'library';

function libraryTests() {
  suite('Unit Tests', () => {
    test('addBook should return the title and a unique _id', (assert) => {
      const result = services.addBook({ title: 'Faux Book 1' });
      assert.equal(result.body.title, 'Faux Book 1');
      assert.isNotEmpty(result.body._id);
    });
    test('addBook should report a missing title', (assert) => {
      assert.equal(services.addBook({}).text, 'missing required field title');
    });
    test('listBooks should return the books with a commentcount', (assert) => {
      services.addBook({ title: 'Faux Book A' });
      const books = services.listBooks();
      assert.isArray(books);
      assert.isNumber(books[0].commentcount);
    });
    test('getBook should return a book with an empty comments array', (assert) => {
      const created = services.addBook({ title: 'Faux Book B' });
      const book = services.getBook(created.body._id);
      assert.isArray(book.body.comments);
    });
    test('getBook should report an unknown book', (assert) => {
      assert.equal(services.getBook('5f665eb46e296f6b9b6a504d').text, 'no book exists');
    });
    test('addComment should add the comment to the book', (assert) => {
      const created = services.addBook({ title: 'Notable Book' });
      const book = services.addComment(created.body._id, { comment: 'This book is fab!' });
      assert.lengthOf(book.body.comments, 1);
    });
    test('addComment should report a missing comment', (assert) => {
      const created = services.addBook({ title: 'Notable Book 2' });
      assert.equal(services.addComment(created.body._id, {}).text, 'missing required field comment');
    });
    test('addComment should report an unknown book', (assert) => {
      assert.equal(services.addComment('5f665eb46e296f6b9b6a504d', { comment: 'x' }).text, 'no book exists');
    });
    test('deleteBook should remove the book', (assert) => {
      const created = services.addBook({ title: 'Deletable Book' });
      assert.equal(services.deleteBook(created.body._id).text, 'delete successful');
    });
    test('deleteAllBooks should empty the collection', (assert) => {
      services.addBook({ title: 'Temporary Book' });
      assert.equal(services.deleteAllBooks().text, 'complete delete successful');
    });
  });

  suite('Functional Tests', () => {
    test('POST /api/books creates a book', (assert) => {
      const body = call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Faux Book 1' } });
      assert.isObject(body);
      assert.equal(body.title, 'Faux Book 1');
      assert.isNotEmpty(body._id);
    });
    test('POST /api/books reports a missing title', (assert) => {
      const body = call(LIBRARY_API, 'POST', '/api/books', { body: {} });
      assert.equal(body, 'missing required field title');
    });
    test('GET /api/books returns an array of books', (assert) => {
      call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Faux Book A' } });
      call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Faux Book B' } });
      const body = call(LIBRARY_API, 'GET', '/api/books');
      assert.isArray(body);
      assert.isAtLeast(body.length, 2);
      assert.isNumber(body[0].commentcount);
    });
    test('GET /api/books/{id} reports an unknown book', (assert) => {
      const body = call(LIBRARY_API, 'GET', '/api/books/5f665eb46e296f6b9b6a504d');
      assert.equal(body, 'no book exists');
    });
    test('GET /api/books/{id} returns the book with its comments', (assert) => {
      const created = call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Faux Book Alpha' } });
      const body = call(LIBRARY_API, 'GET', `/api/books/${created._id}`);
      assert.equal(body.title, 'Faux Book Alpha');
      assert.isArray(body.comments);
    });
    test('POST /api/books/{id} adds a comment', (assert) => {
      const created = call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Notable Book' } });
      call(LIBRARY_API, 'POST', `/api/books/${created._id}`, { body: { comment: 'This book is fab!' } });
      const body = call(LIBRARY_API, 'POST', `/api/books/${created._id}`, { body: { comment: 'I did not care for it' } });
      assert.lengthOf(body.comments, 2);
    });
    test('POST /api/books/{id} reports a missing comment', (assert) => {
      const created = call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Notable Book 2' } });
      const body = call(LIBRARY_API, 'POST', `/api/books/${created._id}`, { body: {} });
      assert.equal(body, 'missing required field comment');
    });
    test('POST /api/books/{id} reports an unknown book', (assert) => {
      const body = call(LIBRARY_API, 'POST', '/api/books/5f665eb46e296f6b9b6a504d', { body: { comment: 'x' } });
      assert.equal(body, 'no book exists');
    });
    test('DELETE /api/books/{id} deletes the book', (assert) => {
      const created = call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Deletable Book' } });
      const body = call(LIBRARY_API, 'DELETE', `/api/books/${created._id}`);
      assert.equal(body, 'delete successful');
    });
    test('DELETE /api/books/{id} reports an unknown book', (assert) => {
      const body = call(LIBRARY_API, 'DELETE', '/api/books/5f665eb46e296f6b9b6a504d');
      assert.equal(body, 'no book exists');
    });
    test('DELETE /api/books deletes every book', (assert) => {
      call(LIBRARY_API, 'POST', '/api/books', { body: { title: 'Doomed Book' } });
      const body = call(LIBRARY_API, 'DELETE', '/api/books');
      assert.equal(body, 'complete delete successful');
    });
  });
}

/* ---------------------------------------------------------- sudoku solver */

const SUDOKU_API = 'sudoku';
// The puzzle and solution used by the freeCodeCamp grader.
const SUDOKU_PUZZLE =
  '..9..5.1.85.4....2432......1...69.83.9.....6.62.71...9......1945....4.37.4.3..6..';
const SUDOKU_SOLUTION =
  '769235418851496372432178956174569283395842761628713549283657194516924837947381625';
// The same puzzle with a leading 9, which cannot be solved.
const SUDOKU_UNSOLVABLE =
  '9.9..5.1.85.4....2432......1...69.83.9.....6.62.71...9......1945....4.37.4.3..6..';
const PUZZLES = [
  [SUDOKU_PUZZLE, SUDOKU_SOLUTION],
  [
    '5..91372.3...8.5.9.9.25..8.68.47.23...95..46.7.4.....5.2.......4..8916..85.72...3',
    '568913724342687519197254386685479231219538467734162895926345178473891652851726943'
  ],
  [
    '..839.7.575.....964..1.......16.29846.9.312.7..754.....62..5.78.8...3.2...492...1',
    '218396745753284196496157832531672984649831257827549613962415378185763429374928561'
  ],
  [
    '.7.89.....5....3.4.2..4..1.5689..472...6.....1.7.5.63873.1.2.8.6..47.1..2.9.387.6',
    '473891265851726394926345817568913472342687951197254638734162589685479123219538746'
  ],
  [
    '82..4..6...16..89...98315.749.157.............53..4...96.415..81..7632..3...28.51',
    '827549163531672894649831527496157382218396475753284916962415738185763249374928651'
  ]
];

function sudokuTests() {
  suite('Unit Tests', () => {
    test('the solver should solve a valid puzzle', (assert) => {
      assert.equal(services.solveSudoku(PUZZLES[0][0]), PUZZLES[0][1]);
    });
    test('the solver should solve every sample puzzle', (assert) => {
      for (const [puzzle, solution] of PUZZLES) {
        assert.equal(services.solveSudoku(puzzle), solution);
      }
    });
    test('isSudokuChars should accept digits and periods', (assert) => {
      assert.isTrue(services.isSudokuChars('1.2.3'));
    });
    test('isSudokuChars should reject other characters', (assert) => {
      assert.isFalse(services.isSudokuChars('1x2'));
    });
    test('isCoordinate should accept A1 to I9', (assert) => {
      assert.isTrue(services.isCoordinate('A1'));
      assert.isTrue(services.isCoordinate('I9'));
    });
    test('isCoordinate should reject invalid coordinates', (assert) => {
      assert.isFalse(services.isCoordinate('A0'));
      assert.isFalse(services.isCoordinate('A10'));
      assert.isFalse(services.isCoordinate('J1'));
    });
    test('isValue should accept 1 to 9', (assert) => {
      assert.isTrue(services.isValue('5'));
    });
    test('isValue should reject invalid values', (assert) => {
      assert.isFalse(services.isValue('0'));
      assert.isFalse(services.isValue('10'));
    });
    test('checkPlacement should accept a valid placement', (assert) => {
      const result = services.checkPlacement(PUZZLES[0][0], 'A1', '7');
      assert.isTrue(result.valid);
    });
    test('checkPlacement should report row and column conflicts', (assert) => {
      const result = services.checkPlacement(PUZZLES[0][0], 'A1', '1');
      assert.isFalse(result.valid);
      assert.include(result.conflict.join(','), 'row');
      assert.include(result.conflict.join(','), 'column');
    });
    test('checkPlacement should accept a value that is already placed', (assert) => {
      const result = services.checkPlacement(PUZZLES[0][0], 'C3', '2');
      assert.isTrue(result.valid);
    });
    test('checkPlacement should report a region conflict', (assert) => {
      const result = services.checkPlacement(PUZZLES[0][0], 'A1', '4');
      assert.isFalse(result.valid);
      assert.include(result.conflict.join(','), 'region');
    });
  });

  suite('Functional Tests', () => {
    test('Solve a puzzle with valid puzzle string: POST request to /api/solve', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/solve', { body: { puzzle: PUZZLES[0][0] } });
      assert.equal(body.solution, PUZZLES[0][1]);
    });
    test('Solve a puzzle with missing puzzle string: POST request to /api/solve', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/solve', { body: { notpuzzle: PUZZLES[0][0] } });
      assert.equal(body.error, 'Required field missing');
    });
    test('Solve a puzzle with invalid characters: POST request to /api/solve', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/solve', { body: { puzzle: 'x'.repeat(81) } });
      assert.equal(body.error, 'Invalid characters in puzzle');
    });
    test('Solve a puzzle with incorrect length: POST request to /api/solve', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/solve', { body: { puzzle: '1'.repeat(80) } });
      assert.equal(body.error, 'Expected puzzle to be 81 characters long');
    });
    test('Solve a puzzle that cannot be solved: POST request to /api/solve', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/solve', { body: { puzzle: SUDOKU_UNSOLVABLE } });
      assert.equal(body.error, 'Puzzle cannot be solved');
    });
    test('Check a puzzle placement with all fields: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: PUZZLES[0][0], coordinate: 'A1', value: '7' }
      });
      assert.isTrue(body.valid);
    });
    test('Check a puzzle placement with a single placement conflict: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: PUZZLES[0][0], coordinate: 'A1', value: '1' }
      });
      assert.isFalse(body.valid);
      assert.include(body.conflict.join(','), 'row');
    });
    test('Check a puzzle placement with multiple placement conflicts: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: PUZZLES[0][0], coordinate: 'A1', value: '1' }
      });
      assert.include(body.conflict.join(','), 'row');
      assert.include(body.conflict.join(','), 'column');
    });
    test('Check a puzzle placement with all placement conflicts: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: PUZZLES[0][0], coordinate: 'A1', value: '1' }
      });
      assert.isArray(body.conflict);
    });
    test('Check a puzzle placement with missing required fields: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', { body: { puzzle: PUZZLES[0][0] } });
      assert.equal(body.error, 'Required field(s) missing');
    });
    test('Check a puzzle placement with invalid characters: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: 'x'.repeat(81), coordinate: 'A1', value: '7' }
      });
      assert.equal(body.error, 'Invalid characters in puzzle');
    });
    test('Check a puzzle placement with incorrect length: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: '1'.repeat(80), coordinate: 'A1', value: '7' }
      });
      assert.equal(body.error, 'Expected puzzle to be 81 characters long');
    });
    test('Check a puzzle placement with invalid placement coordinate: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: PUZZLES[0][0], coordinate: 'A0', value: '7' }
      });
      assert.equal(body.error, 'Invalid coordinate');
    });
    test('Check a puzzle placement with invalid placement value: POST request to /api/check', (assert) => {
      const body = call(SUDOKU_API, 'POST', '/api/check', {
        body: { puzzle: PUZZLES[0][0], coordinate: 'A1', value: '10' }
      });
      assert.equal(body.error, 'Invalid value');
    });
  });
}

/* ---------------------------------------------------- american/british translator */

const TRANSLATE_API = 'translate';

function translatorTests() {
  suite('Unit Tests', () => {
    const americanToBritish = [
      ['Mangoes are my favorite fruit.', 'favourite'],
      ['I ate yogurt for breakfast.', 'yoghurt'],
      ["We had a party at my friend's condo.", 'flat'],
      ['Can you toss this in the trashcan for me?', 'bin'],
      ['The parking lot was full.', 'car park'],
      ['Like a high tech Rube Goldberg machine.', 'high-tech'],
      ['To play hooky means to skip class or work.', 'bunk off'],
      ['No Mr. Bond, I expect you to die.', 'Mr'],
      ['Dr. Grosh will see you now.', 'Dr'],
      ['Lunch is at 12:15 today.', '12.15']
    ];

    americanToBritish.forEach(([sentence, expected]) => {
      test(`Translate "${sentence}" to British English`, (assert) => {
        const translation = services.translate(sentence, 'american-to-british');
        assert.include(translation, `<span class="highlight">${expected}</span>`);
      });
    });

    const britishToAmerican = [
      ['We watched the footie match for a while.', 'soccer'],
      ['Paracetamol takes up to an hour to work.', 'Acetaminophen'],
      ['First, caramelise the onions.', 'caramelize'],
      ['I had a bicky then went to the chippy.', 'cookie'],
      ["I've just got bits and bobs in my bum bag.", 'odds and ends'],
      ['The car boot sale at Boxted Airfield was called off.', 'swap meet'],
      ['Have you met Mrs Kalyani?', 'Mrs.'],
      ["Prof Joyner of King's College, London.", 'Prof.'],
      ['Tea time is usually around 4 or 4.30.', '4:30'],
      ['The rubbish was thrown in the bin.', 'trash']
    ];

    britishToAmerican.forEach(([sentence, expected]) => {
      test(`Translate "${sentence}" to American English`, (assert) => {
        const translation = services.translate(sentence, 'british-to-american');
        assert.include(translation, `<span class="highlight">${expected}</span>`);
      });
    });

    test('Highlight translation in "Mangoes are my favorite fruit."', (assert) => {
      const translation = services.translate('Mangoes are my favorite fruit.', 'american-to-british');
      assert.include(translation, '<span class="highlight">favourite</span>');
    });
    test('Highlight translation in "I ate yogurt for breakfast."', (assert) => {
      const translation = services.translate('I ate yogurt for breakfast.', 'american-to-british');
      assert.include(translation, '<span class="highlight">yoghurt</span>');
    });
    test('Highlight translation in "We watched the footie match for a while."', (assert) => {
      const translation = services.translate('We watched the footie match for a while.', 'british-to-american');
      assert.include(translation, '<span class="highlight">soccer</span>');
    });
    test('Highlight translation in "Paracetamol takes up to an hour to work."', (assert) => {
      const translation = services.translate('Paracetamol takes up to an hour to work.', 'british-to-american');
      assert.include(translation, '<span class="highlight">Acetaminophen</span>');
    });
  });

  suite('Functional Tests', () => {
    test('Translation with text and locale fields: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', {
        body: { text: 'Mangoes are my favorite fruit.', locale: 'american-to-british' }
      });
      assert.deepEqual(body, {
        text: 'Mangoes are my favorite fruit.',
        translation: 'Mangoes are my <span class="highlight">favourite</span> fruit.'
      });
    });
    test('Translation of a time: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', {
        body: { text: 'Lunch is at 12:15 today.', locale: 'american-to-british' }
      });
      assert.deepEqual(body, {
        text: 'Lunch is at 12:15 today.',
        translation: 'Lunch is at <span class="highlight">12.15</span> today.'
      });
    });
    test('Translation of a title: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', {
        body: { text: 'Dr. Grosh will see you now.', locale: 'american-to-british' }
      });
      assert.deepEqual(body, {
        text: 'Dr. Grosh will see you now.',
        translation: '<span class="highlight">Dr</span> Grosh will see you now.'
      });
    });
    test('Translation with text and invalid locale field: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', {
        body: { text: 'Mangoes are my favorite fruit.', locale: 'invalid-locale' }
      });
      assert.equal(body.error, 'Invalid value for locale field');
    });
    test('Translation with missing text field: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', { body: { locale: 'american-to-british' } });
      assert.equal(body.error, 'Required field(s) missing');
    });
    test('Translation with missing locale field: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', { body: { text: 'Mangoes are my favorite fruit.' } });
      assert.equal(body.error, 'Required field(s) missing');
    });
    test('Translation with empty text: POST request to /api/translate', (assert) => {
      const body = call(TRANSLATE_API, 'POST', '/api/translate', {
        body: { text: '', locale: 'american-to-british' }
      });
      assert.equal(body.error, 'No text to translate');
    });
    test('Translation with text that needs no translation: POST request to /api/translate', (assert) => {
      const text = 'Nothing to see here';
      const body = call(TRANSLATE_API, 'POST', '/api/translate', {
        body: { text, locale: 'american-to-british' }
      });
      assert.deepEqual(body, { text, translation: 'Everything looks good to me!' });
    });
  });
}

/* --------------------------------------------------------------- registry */

const SUITES = {
  convert: converterTests,
  issuetracker: issueTrackerTests,
  library: libraryTests,
  sudoku: sudokuTests,
  translate: translatorTests
};

/** Runs the suite for an api and returns the mocha style report. */
function run(apiName) {
  results.length = 0;
  contextStack.length = 0;
  runCounter += 1;
  const suite = SUITES[apiName];
  if (suite) suite();
  return results.slice();
}

module.exports = { run, suite, test, results };
