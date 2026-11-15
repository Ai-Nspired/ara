/**
 * ARA's loop. One pass, one row, one verdict.
 *
 *   1. something arrives
 *   2. she decides what it is, from a fixed menu — with a catch-all for "none of these"
 *   3. the row is written: what was asked, what was decided, correct = null
 *   4. he says whether it got his intent and preference right — that is the only
 *      value that comes from outside, and it is what the loop learns from
 *   5. progress() counts the rows, which is the whole of "is she getting it right"
 *
 * D1 holds the rows. KV holds the interaction body with a short metadata summary
 * beside it, so the history reads without fetching bodies.
 *
 * Nothing here passes expirationTtl. Records do not expire; a record written with
 * a cache lifetime can never be read back or promoted.
 */

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

// Paid decider. One question, one pass, about $0.01 per million input tokens.
// Never a `:free` slug: the price of free is that they get to look at the data.
export const DECIDER = 'perplexity/pplx-decider-flash-v1.2';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL DEFAULT (datetime('now')),
  domain        TEXT,
  asked         TEXT NOT NULL,
  decided       TEXT,
  correct       INTEGER,
  corrected_to  TEXT
)`,
  `CREATE INDEX IF NOT EXISTS decisions_domain_at ON decisions (domain, at)`,
];

/**
 * The menu. Each entry is a definition of a case, not a category name, because a
 * definition can be checked against what was actually said. `none` is a real
 * option — the catch-all — so a miss is recorded as a miss instead of being
 * quietly rounded to the nearest thing.
 */
export const MOVES = {
  card: 'The ask names something this workspace already does with a card: an audit, a merge, a distill, a fetch, a search. If it could be done by clicking something that already exists, it is this.',
  template: 'The ask is to lay material out in the HTML template — styling, structure, or sending a finished document over.',
  document: 'The message carries a document or a block of HTML whose text is the payload. The ask is to correct it, restyle it, or place it.',
  microsite: 'A word with a three- or four-digit code attached, or a reference to a page he has placed somewhere. It is an address, not a question.',
  question: 'A question that expects an answer, with no artifact to build and no card to run.',
  none: 'None of the above. The ask is not addressed by anything on this menu — say so and ask him what he means.',
};

export const INTENT_QUESTION = 'Which of these is he asking for?';

const META_LIMIT = 1024;
const KEY = 'int:';

const clip = (value, n) => {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '\u2026' : s;
};

export const interactionKey = (domain, at) => `${KEY}${domain || 'none'}:${at}`;

/** Small enough that KV will take it, and it shrinks rather than throwing. */
export function metadataFor(entry) {
  const build = (chars, withResult) => {
    const meta = {
      at: entry.at,
      domain: entry.domain || 'none',
      asked: clip(entry.asked, chars),
      decided: clip(entry.decided, 120),
      correct: entry.correct == null ? null : Number(entry.correct),
    };
    if (withResult && entry.result != null) meta.result = clip(entry.result, 80);
    return meta;
  };
  for (const [chars, withResult] of [[240, true], [120, true], [120, false], [48, false]]) {
    const meta = build(chars, withResult);
    if (JSON.stringify(meta).length <= META_LIMIT) return meta;
  }
  return build(48, false);
}

const rowId = (result) => {
  const id = result && (result.meta?.last_row_id ?? result.lastInsertRowid ?? result.last_row_id);
  return id == null ? null : Number(id);
};

/**
 * One decisions pass. Returns the move, the distribution, and what it cost.
 * A refusal is not an answer: it comes back as `refused`, never as `none`.
 */
export async function ask(env, text, options = {}) {
  if (!text) throw new Error('ask needs what was asked');
  const fetchImpl = options.fetchImpl || fetch;
  const model = options.model || DECIDER;
  const moves = options.moves || MOVES;

  if (!env || !env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not bound');

  const response = await fetchImpl(DECISIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      state: String(text),
      questions: {
        intent: {
          type: 'choice',
          instructions: INTENT_QUESTION,
          criteria: moves,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`decisions_${response.status}: ${String(detail).slice(0, 300)}`);
    error.code = `decisions_${response.status}`;
    throw error;
  }

  const data = await response.json();
  const answer = (data && data.answers && data.answers.intent) || null;

  if (!answer || answer.type === 'refusal') {
    return { move: null, refused: true, probabilities: null, confidence: null, cost: data?.usage?.cost ?? null, model: data?.model || model };
  }

  return {
    move: answer.choice ?? null,
    refused: false,
    probabilities: answer.probabilities || null,
    confidence: answer.confidence ?? null,
    cost: data?.usage?.cost ?? null,
    model: data?.model || model,
  };
}

export function createLoop(env, options = {}) {
  const clock = options.clock || (() => new Date());
  const db = env && env.DB ? env.DB : null;
  const kv = env && env.KV ? env.KV : null;

  async function ensure() {
    if (!db) return false;
    for (const statement of SCHEMA) await db.prepare(statement).run();
    return true;
  }

  /** Ask, then write the row. The row is written by the workflow, never by her. */
  async function arrive(text, { domain = null, ...askOptions } = {}) {
    const decided = await ask(env, text, askOptions);
    const at = clock().toISOString();
    const key = interactionKey(domain, at);

    let id = null;
    if (db) {
      const result = await db
        .prepare('INSERT INTO decisions (at, domain, asked, decided, correct, corrected_to) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(at, domain, String(text), decided.move, null, null)
        .run();
      id = rowId(result);
    }

    if (kv) {
      const body = {
        at, domain, asked: text, decided: decided.move,
        refused: decided.refused, confidence: decided.confidence,
        probabilities: decided.probabilities, cost: decided.cost, model: decided.model,
        correct: null, id,
      };
      // No expirationTtl: this is a record.
      await kv.put(key, JSON.stringify(body), { metadata: metadataFor(body) });
    }

    return { id, key, at, domain, ...decided };
  }

  /** His verdict. The only value in the row that does not come from her. */
  async function feedback({ id, correct, correctedTo = null, result = null } = {}) {
    if (correct == null) throw new Error('feedback needs correct: true or false');
    if (id == null) throw new Error('feedback needs the row id');
    const value = correct ? 1 : 0;
    let row = null;

    if (db) {
      await db
        .prepare('UPDATE decisions SET correct = ?, corrected_to = ? WHERE id = ?')
        .bind(value, correctedTo == null ? null : String(correctedTo), Number(id))
        .run();
      row = await db.prepare('SELECT * FROM decisions WHERE id = ?').bind(Number(id)).first();
    }

    const key = row ? interactionKey(row.domain, row.at) : null;
    if (kv && key) {
      const raw = await kv.get(key);
      if (raw) {
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        body.correct = value;
        body.correctedTo = correctedTo ?? body.correctedTo ?? null;
        if (result != null) body.result = result;
        await kv.put(key, JSON.stringify(body), { metadata: metadataFor(body) });
      }
    }

    return { id: Number(id), correct: !!correct, correctedTo, key };
  }

  /** Is she getting it right? Counted from the rows, nothing else. */
  async function progress(domain = null) {
    if (!db) return { correct: 0, wrong: 0, pending: 0, verdicts: 0, rate: null };
    const sql = `SELECT SUM(correct = 1) AS ok, SUM(correct = 0) AS bad, SUM(correct IS NULL) AS open, COUNT(*) AS total
      FROM decisions ${domain ? 'WHERE domain = ?' : ''}`;
    const statement = domain ? db.prepare(sql).bind(domain) : db.prepare(sql);
    const row = (await statement.first()) || {};
    const ok = Number(row.ok || 0);
    const bad = Number(row.bad || 0);
    const verdicts = ok + bad;
    return {
      correct: ok,
      wrong: bad,
      pending: Number(row.open || 0),
      verdicts,
      // What he judged right, over everything he has judged.
      rate: verdicts ? Number((ok / verdicts).toFixed(4)) : null,
    };
  }

  async function recent({ domain = null, limit = 20 } = {}) {
    if (!db) return [];
    const take = Math.max(1, Math.min(500, Number(limit) || 20));
    const statement = domain
      ? db.prepare('SELECT * FROM decisions WHERE domain = ? ORDER BY at DESC, id DESC LIMIT ?').bind(domain, take)
      : db.prepare('SELECT * FROM decisions ORDER BY at DESC, id DESC LIMIT ?').bind(take);
    const out = await statement.all();
    return out?.results || out || [];
  }

  async function detail(key) {
    if (!kv || !key) return null;
    const raw = await kv.get(key);
    if (raw == null) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }

  return { ensure, arrive, feedback, progress, recent, detail };
}
