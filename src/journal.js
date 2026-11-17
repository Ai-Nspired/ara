/**
 * The journal: what was asked, what was decided, whether that was correct.
 *
 * D1 holds the rows. KV holds the interaction body with a small metadata
 * summary beside it, so the history can be scanned without reading bodies, and
 * so notes can sit in the same namespace as the legacy memory and be rewritten
 * by hand.
 *
 * ONE RULE: cache expires, records do not. Nothing in this file passes
 * expirationTtl. A record written with a cache lifetime cannot be promoted
 * later, because promotion is a read of something that is already gone.
 */

const META_LIMIT = 1024; // KV rejects metadata larger than this
const NOTE_PREFIX = 'note:';
const INT_PREFIX = 'int:';

const clip = (value, n) => {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '\u2026' : s;
};

export const interactionKey = (domain, at) => `${INT_PREFIX}${domain || 'none'}:${at}`;
export const noteKey = (domain, slug) => `${NOTE_PREFIX}${domain || 'none'}:${slug}`;

/** The schema, in the order it must be applied. ara/schema.sql mirrors this. */
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

/** Metadata must stay small, so it shrinks rather than fails. */
export function metadataFor(entry) {
  const build = (askedChars, withResult) => {
    const meta = {
      at: entry.at,
      domain: entry.domain || 'none',
      asked: clip(entry.asked, askedChars),
      decided: clip(entry.decided, 120),
      correct: entry.correct == null ? null : Number(entry.correct),
    };
    if (withResult && entry.result != null) meta.result = clip(entry.result, 80);
    return meta;
  };
  const attempts = [
    [240, true],
    [120, true],
    [120, false],
    [48, false],
  ];
  let last = build(48, false);
  for (const [chars, withResult] of attempts) {
    last = build(chars, withResult);
    if (JSON.stringify(last).length <= META_LIMIT) return last;
  }
  return { at: last.at, domain: last.domain, decided: last.decided, correct: last.correct };
}

function rowOf(result) {
  const id = result && (result.meta?.last_row_id ?? result.lastInsertRowid ?? result.last_row_id);
  return id == null ? null : Number(id);
}

export function createJournal(env, options = {}) {
  const clock = options.clock || (() => new Date());
  const db = env && env.DB ? env.DB : null;
  const kv = env && env.KV ? env.KV : null;

  async function ensure() {
    if (!db) return false;
    for (const statement of SCHEMA) await db.prepare(statement).run();
    return true;
  }

  /**
   * One interaction: what was asked, what was decided, and — when it is known —
   * whether that was correct. Writes the row, then the body and its metadata.
   */
  async function record(entry = {}) {
    if (!entry.asked) throw new Error('record needs what was asked');
    const domain = entry.domain ? String(entry.domain) : null;
    const at = (entry.at ? new Date(entry.at) : clock()).toISOString();

    let id = null;
    if (db) {
      const result = await db
        .prepare('INSERT INTO decisions (at, domain, asked, decided, correct, corrected_to) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(at, domain, String(entry.asked), entry.decided == null ? null : String(entry.decided), entry.correct == null ? null : Number(entry.correct), entry.correctedTo == null ? null : String(entry.correctedTo))
        .run();
      id = rowOf(result);
    }

    const key = interactionKey(domain, at);
    if (kv) {
      const body = {
        at,
        domain,
        asked: entry.asked,
        decided: entry.decided ?? null,
        answer: entry.answer ?? null,
        result: entry.result ?? null,
        correct: entry.correct == null ? null : Number(entry.correct),
        correctedTo: entry.correctedTo ?? null,
        id,
      };
      // No expirationTtl: this is a record, not a cache entry.
      await kv.put(key, JSON.stringify(body), { metadata: metadataFor(body) });
    }

    return { id, key, at, domain };
  }

  /** His verdict: the only value in the row that comes from outside her. */
  async function judge({ id, key, correct, correctedTo = null, result = null } = {}) {
    if (correct == null) throw new Error('judge needs correct: true or false');
    const value = correct ? 1 : 0;
    let row = null;

    if (db && id != null) {
      await db
        .prepare('UPDATE decisions SET correct = ?, corrected_to = ? WHERE id = ?')
        .bind(value, correctedTo == null ? null : String(correctedTo), Number(id))
        .run();
      row = await db.prepare('SELECT * FROM decisions WHERE id = ?').bind(Number(id)).first();
    }

    const at = key ? String(key).slice(INT_PREFIX.length).split(':').slice(1).join(':') : row?.at;
    const target = key || (row ? interactionKey(row.domain, row.at) : null);
    if (kv && target) {
      const raw = await kv.get(target);
      if (raw) {
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        body.correct = value;
        body.correctedTo = correctedTo ?? body.correctedTo ?? null;
        if (result != null) body.result = result;
        await kv.put(target, JSON.stringify(body), { metadata: metadataFor(body) });
      }
    }

    return { id: id == null ? null : Number(id), key: target, correct: !!correct, at };
  }

  /** Rows, newest first. */
  async function recent({ domain = null, limit = 20 } = {}) {
    if (!db) return [];
    const take = Math.max(1, Math.min(500, Number(limit) || 20));
    const statement = domain
      ? db.prepare('SELECT * FROM decisions WHERE domain = ? ORDER BY at DESC, id DESC LIMIT ?').bind(domain, take)
      : db.prepare('SELECT * FROM decisions ORDER BY at DESC, id DESC LIMIT ?').bind(take);
    const out = await statement.all();
    return out?.results || out || [];
  }

  /** How often her decisions held up, from the rows themselves. */
  async function agreement(domain = null) {
    if (!db) return { correct: 0, wrong: 0, pending: 0, verdicts: 0, rate: null };
    const sql = `SELECT
        SUM(correct = 1) AS ok,
        SUM(correct = 0) AS not_ok,
        SUM(correct IS NULL) AS pending,
        COUNT(*) AS total
      FROM decisions ${domain ? 'WHERE domain = ?' : ''}`;
    const statement = domain ? db.prepare(sql).bind(domain) : db.prepare(sql);
    const row = (await statement.first()) || {};
    const ok = Number(row.ok || 0);
    const notOk = Number(row.not_ok || 0);
    const verdicts = ok + notOk;
    return {
      correct: ok,
      wrong: notOk,
      pending: Number(row.pending || 0),
      verdicts,
      rate: verdicts ? Number((ok / verdicts).toFixed(4)) : null,
    };
  }

  /** A note, in the same namespace as the legacy memory, and none the wiser for time. */
  async function note({ domain = null, slug, text = '', metadata = null } = {}) {
    if (!kv) throw new Error('note needs KV');
    if (!slug) throw new Error('note needs a slug');
    const key = noteKey(domain, slug);
    const meta = metadata || { at: clock().toISOString(), domain: domain || 'none', note: clip(text, 160) };
    await kv.put(key, String(text), { metadata: meta });
    return { key, metadata: meta };
  }

  /** The notes, with their metadata, without reading every body. */
  async function notes({ domain = null } = {}) {
    if (!kv) return [];
    const prefix = domain ? noteKey(domain, '') : NOTE_PREFIX;
    const listed = await kv.list({ prefix });
    return (listed?.keys || []).map((k) => ({ key: k.name, metadata: k.metadata || null }));
  }

  async function interaction(key) {
    if (!kv || !key) return null;
    const raw = await kv.get(key);
    if (raw == null) return null;
    if (String(key).startsWith(NOTE_PREFIX)) return raw;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }

  return { ensure, record, judge, recent, agreement, note, notes, interaction };
}
