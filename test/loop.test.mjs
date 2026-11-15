import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLoop, ask, DECIDER, JOINT_DECIDER, MOVES, ROUTES, metadataFor, SCHEMA } from '../src/loop.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let params = [];
      return {
        bind(...args) {
          params = args;
          return this;
        },
        async run() {
          const r = statement.run(...params);
          return { changes: r.changes, meta: { last_row_id: Number(r.lastInsertRowid) } };
        },
        async first() {
          return statement.get(...params) || null;
        },
        async all() {
          return { results: statement.all(...params) };
        },
      };
    },
  };
}

function kv() {
  const map = new Map();
  const puts = [];
  return {
    puts,
    async put(key, value, opts = {}) {
      puts.push({ key, opts });
      map.set(key, { value, metadata: opts.metadata });
    },
    async get(key) {
      return map.has(key) ? map.get(key).value : null;
    },
  };
}

/** A fetch that records the request and answers with a canned decision. */
function decider(
  answer = { type: 'choice', choice: 'card', probabilities: { card: 0.86, none: 0.09, question: 0.05 }, confidence: 0.86 },
  usage = { cost: 0.000021 },
  routeAnswer = { type: 'choice', choice: 'truth', probabilities: { truth: 0.74, generate: 0.2, card: 0.6 }, confidence: 0.74 },
) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify({ model: JOINT_DECIDER, answers: { intent: answer, route: routeAnswer }, usage }), { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

const fixed = () => new Date('2026-11-15T21:05:00.000Z');

async function build(answer, usage) {
  const store = kv();
  const env = { DB: d1(), KV: store, OPENROUTER_API_KEY: 'test-key' };
  const loop = createLoop(env, { clock: fixed });
  await loop.ensure();
  const fetchImpl = decider(answer, usage);
  return { loop, store, env, fetchImpl };
}

test('the deciders are the paid ones, never a :free slug', () => {
  assert.equal(DECIDER, 'perplexity/pplx-decider-flash-v1.2');
  assert.equal(JOINT_DECIDER, 'perplexity/pplx-decider-v1.2');
  assert.equal(DECIDER.includes(':free') || JOINT_DECIDER.includes(':free'), false);
});

test('label and route in one paid pass, with a real catch-all', async () => {
  const { loop, fetchImpl } = await build();
  await loop.arrive('make me an audit of the deed', { domain: 'legal', fetchImpl });

  const [{ url, body, headers }] = fetchImpl.calls;
  assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(body.model, JOINT_DECIDER, 'two questions are answered jointly, so the state bills once');
  assert.equal(body.model.includes(':free'), false);
  assert.deepEqual(Object.keys(body.questions), ['intent', 'route'], 'label and route, one pass');
  assert.equal(body.questions.intent.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.intent.criteria), Object.keys(MOVES));
  assert.ok(body.questions.intent.criteria.none, 'the catch-all is a real option');
  assert.deepEqual(Object.keys(body.questions.route.criteria), Object.keys(ROUTES));
  assert.equal(headers.Authorization, 'Bearer test-key');
});

test('an arrival writes the row and the body, with no TTL anywhere', async () => {
  const { loop, store, fetchImpl } = await build();
  const result = await loop.arrive('make me an audit of the deed', { domain: 'legal', fetchImpl });

  assert.equal(result.move, 'card');
  assert.equal(result.route, 'truth');
  assert.equal(result.confidence, undefined, 'no scores ride out');
  assert.equal(result.routeConfidence, undefined);
  assert.equal(result.cost, 0.000021);
  assert.ok(result.id > 0);
  assert.equal(result.key, 'int:legal:2026-11-15T21:05:00.000Z');

  const [row] = await loop.recent({ domain: 'legal' });
  assert.equal(row.asked, 'make me an audit of the deed');
  assert.equal(row.decided, 'card');
  assert.equal(row.correct, null, 'no verdict yet');

  const body = await loop.detail(result.key);
  assert.equal(body.probabilities.card, 0.86);
  assert.equal(body.route, 'truth');
  assert.equal(body.cost, 0.000021);
  assert.equal(store.puts[0].opts.metadata.route, 'truth', 'the route rides in metadata for scanning');

  for (const put of store.puts) {
    assert.equal(put.opts.expirationTtl, undefined, `${put.key} was written with a TTL`);
    assert.ok(put.opts.metadata, `${put.key} was written without metadata`);
  }
});

test('he says whether it got his intent right, and that is the whole verdict', async () => {
  const { loop, store, fetchImpl } = await build();
  const { id, key } = await loop.arrive('file the letter', { domain: 'legal', fetchImpl });

  await loop.feedback({ id, correct: false, correctedTo: 'card', result: 'wrong card' });

  const [row] = await loop.recent({ domain: 'legal' });
  assert.equal(row.correct, 0);
  assert.equal(row.corrected_to, 'card');

  const body = await loop.detail(key);
  assert.equal(body.correct, 0);
  assert.equal(body.result, 'wrong card');

  const last = store.puts.at(-1);
  assert.equal(last.opts.expirationTtl, undefined);
  assert.equal(last.opts.metadata.correct, 0);
});

test('is she learning: counted from the rows he has judged', async () => {
  const { loop, fetchImpl } = await build();
  const a = await loop.arrive('q1', { domain: 'legal', fetchImpl });
  const b = await loop.arrive('q2', { domain: 'legal', fetchImpl });
  const c = await loop.arrive('q3', { domain: 'legal', fetchImpl });
  await loop.arrive('q4', { domain: 'medical', fetchImpl });

  await loop.feedback({ id: a.id, correct: true });
  await loop.feedback({ id: b.id, correct: true });
  await loop.feedback({ id: c.id, correct: false, correctedTo: 'template' });

  const legal = await loop.progress('legal');
  assert.deepEqual(legal, { correct: 2, wrong: 1, pending: 0 }, 'counts only');

  const all = await loop.progress();
  assert.deepEqual(all, { correct: 2, wrong: 1, pending: 1 });
});

test('a refusal is not an answer — it is recorded as one, not rounded to none', async () => {
  const { loop } = await build({ type: 'refusal' });
  const result = await loop.arrive('something it will not judge', { domain: 'legal', fetchImpl: decider({ type: 'refusal' }) });
  assert.equal(result.move, null);
  assert.equal(result.refused, true);

  const [row] = await loop.recent({ domain: 'legal' });
  assert.equal(row.decided, null);
  assert.equal(row.correct, null);
});

test('the catch-all can win, and it is what gets recorded', async () => {
  const answer = { type: 'choice', choice: 'none', probabilities: { none: 0.71, card: 0.2, question: 0.09 }, confidence: 0.71 };
  const { loop } = await build(answer);
  const result = await loop.arrive('send the thing to her about the other one', { domain: 'legal', fetchImpl: decider(answer) });
  assert.equal(result.move, 'none');
});

test('metadata stays inside what KV accepts, even for a huge ask', () => {
  const meta = metadataFor({ at: '2026-11-15T21:05:00.000Z', domain: 'legal', asked: 'a'.repeat(5000), decided: 'card', result: 'b'.repeat(5000) });
  assert.ok(JSON.stringify(meta).length <= 1024);
  assert.equal(meta.decided, 'card');
});

test('a missing binding degrades instead of throwing', async () => {
  const store = kv();
  const kvOnly = createLoop({ KV: store, OPENROUTER_API_KEY: 'k' }, { clock: fixed });
  const wrote = await kvOnly.arrive('no database', { domain: 'legal', fetchImpl: decider() });
  assert.equal(wrote.id, null);
  assert.ok(await kvOnly.detail(wrote.key));
  assert.deepEqual(await kvOnly.recent(), []);
  assert.deepEqual(await kvOnly.progress(), { correct: 0, wrong: 0, pending: 0 });

  const dbOnly = createLoop({ DB: d1(), OPENROUTER_API_KEY: 'k' }, { clock: fixed });
  await dbOnly.ensure();
  const row = await dbOnly.arrive('no kv', { domain: 'legal', fetchImpl: decider() });
  assert.ok(row.id > 0);
  assert.equal((await dbOnly.recent()).length, 1);
});

test('the schema is idempotent and matches the columns the loop writes', async () => {
  const db = d1();
  for (const statement of SCHEMA) await db.prepare(statement).run();
  for (const statement of SCHEMA) await db.prepare(statement).run();
  const cols = await db.prepare('PRAGMA table_info(decisions)').all();
  const names = cols.results.map((c) => c.name);
  assert.deepEqual(names, ['id', 'at', 'domain', 'asked', 'decided', 'correct', 'corrected_to']);
});

test('the decider failing is reported, not swallowed', async () => {
  const env = { OPENROUTER_API_KEY: 'k' };
  const failing = async () => new Response('nope', { status: 502 });
  await assert.rejects(() => ask(env, 'anything', { fetchImpl: failing }), /decisions_502/);
  await assert.rejects(() => ask({}, 'anything'), /OPENROUTER_API_KEY/);
});
