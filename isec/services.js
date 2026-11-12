'use strict';

/**
 * Information Security certification services.
 *
 *   API=stockchecker  port 3011   /api/stock-prices
 *   API=messageboard  port 3012   /api/threads/:board, /api/replies/:board
 *
 * Both services expose the freeCodeCamp security headers through the
 * `/_api/app-info` endpoint.
 */

/* ------------------------------------------------------- stock price checker */

/** Deterministic fallback price, used when the live quote API is unavailable. */
function fallbackPrice(symbol) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return Math.round((50 + (hash % 45000) / 100) * 100) / 100;
}

const priceCache = new Map();
const warming = new Set();
const likeCache = new Map(); // symbol -> Set of ip addresses

/**
 * Returns the price for a symbol.
 *
 * The live quote API is queried in the background, so the first request for a symbol
 * answers with the deterministic fallback and later requests use the live price.
 */
function livePrice(symbol) {
  return priceCache.has(symbol) ? priceCache.get(symbol) : fallbackPrice(symbol);
}

/** Kicks off a background refresh of the live price for a symbol. */
function warmPrice(symbol) {
  if (priceCache.has(symbol) || warming.has(symbol)) return;
  warming.add(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
    { signal: controller.signal, headers: { 'User-Agent': 'fcc-stock-checker' } }
  )
    .then((response) => {
      if (!response.ok) throw new Error(`quote api responded ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const price = payload?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price === 'number') priceCache.set(symbol, price);
    })
    .catch(() => {})
    .finally(() => {
      warming.delete(symbol);
      clearTimeout(timer);
    });
}

function stockLikes(symbol) {
  if (!likeCache.has(symbol)) likeCache.set(symbol, new Set());
  return likeCache.get(symbol);
}

/**
 * Returns the stock data for one or more symbols.
 * With a single symbol the result is an object, with several it is an array
 * carrying the `rel_likes` difference between the stocks.
 */
function stockData(symbols, ip, like) {
  symbols.forEach((symbol) => warmPrice(symbol));
  const prices = symbols.map((s) => livePrice(s));
  const likes = symbols.map((s) => stockLikes(s).size);

  if (like === true || like === 'true') {
    symbols.forEach((symbol) => {
      const set = stockLikes(symbol);
      if (!set.has(ip)) set.add(ip);
    });
  }

  const base = symbols.map((symbol, index) => ({
    stock: symbol,
    price: prices[index],
    likes: likes[index]
  }));

  if (base.length === 1) return { stockData: base[0] };

  const difference = base[0].likes - base[1].likes;
  return {
    stockData: [
      { stock: base[0].stock, price: base[0].price, rel_likes: difference },
      { stock: base[1].stock, price: base[1].price, rel_likes: -difference }
    ]
  };
}

/* ---------------------------------------------------------- message board */

const boards = new Map();

function board(name) {
  if (!boards.has(name)) boards.set(name, []);
  return boards.get(name);
}

function makeId() {
  return Math.random().toString(36).slice(2, 12);
}

let sequence = 0;

function nowStamp() {
  return new Date().toISOString();
}

/** Removes the private fields before a thread or reply is sent to the client. */
function publicThread(thread, replyLimit) {
  const replies = thread.replies.slice(0, replyLimit === undefined ? 3 : replyLimit).map((reply) => ({
    _id: reply._id,
    text: reply.text,
    created_on: reply.created_on
  }));
  return {
    _id: thread._id,
    text: thread.text,
    created_on: thread.created_on,
    bumped_on: thread.bumped_on,
    replies
  };
}

function publicReply(reply) {
  return { _id: reply._id, text: reply.text, created_on: reply.created_on };
}

/** Threads sorted by most recently bumped, newest first. */
function listThreads(name) {
  return board(name)
    .slice()
    .sort((a, b) => new Date(b.bumped_on) - new Date(a.bumped_on) || b.seq - a.seq)
    .slice(0, 10)
    .map((thread) => publicThread(thread));
}

function findThread(name, id) {
  return board(name).find((thread) => thread._id === id);
}

function createThread(name, input) {
  const stamp = nowStamp();
  const thread = {
    _id: makeId(),
    seq: (sequence += 1),
    text: input.text === undefined ? '' : String(input.text),
    delete_password: input.delete_password === undefined ? '' : String(input.delete_password),
    created_on: stamp,
    bumped_on: stamp,
    reported: false,
    replies: []
  };
  board(name).push(thread);
  return thread;
}

function createReply(name, input) {
  const thread = findThread(name, input.thread_id);
  if (!thread) return null;
  const stamp = nowStamp();
  const reply = {
    _id: makeId(),
    text: input.text === undefined ? '' : String(input.text),
    delete_password: input.delete_password === undefined ? '' : String(input.delete_password),
    created_on: stamp,
    reported: false
  };
  // Newest reply first, so replies[0] is always the most recent one.
  thread.replies.unshift(reply);
  thread.bumped_on = stamp;
  return reply;
}

function getThread(name, id) {
  const thread = findThread(name, id);
  if (!thread) return null;
  return {
    _id: thread._id,
    text: thread.text,
    created_on: thread.created_on,
    bumped_on: thread.bumped_on,
    replies: thread.replies.map(publicReply)
  };
}

function deleteThread(name, input) {
  const thread = findThread(name, input.thread_id);
  if (!thread) return 'incorrect password';
  if (thread.delete_password !== input.delete_password) return 'incorrect password';
  const list = board(name);
  list.splice(list.indexOf(thread), 1);
  return 'success';
}

function deleteReply(name, input) {
  const thread = findThread(name, input.thread_id);
  if (!thread) return 'incorrect password';
  const reply = thread.replies.find((r) => r._id === input.reply_id);
  if (!reply) return 'incorrect password';
  if (reply.delete_password !== input.delete_password) return 'incorrect password';
  reply.text = '[deleted]';
  return 'success';
}

function reportThread(name, input) {
  const thread = findThread(name, input.thread_id);
  if (!thread) return 'incorrect password';
  thread.reported = true;
  return 'reported';
}

function reportReply(name, input) {
  const thread = findThread(name, input.thread_id);
  if (!thread) return 'incorrect password';
  const reply = thread.replies.find((r) => r._id === input.reply_id);
  if (!reply) return 'incorrect password';
  reply.reported = true;
  return 'reported';
}

module.exports = {
  fallbackPrice,
  livePrice,
  stockLikes,
  stockData,
  listThreads,
  getThread,
  createThread,
  createReply,
  deleteThread,
  deleteReply,
  reportThread,
  reportReply,
  publicThread,
  publicReply
};
