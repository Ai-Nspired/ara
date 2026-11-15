/**
 * ARA's loop: decide, write the row, take the verdict, count it.
 *
 * The worker writes everything. The decider answers a presented question and
 * produces no text; it stores nothing. The metrics come from the rows.
 *
 * D1 holds the rows, KV holds the body with a short metadata summary beside it so
 * history reads without fetching bodies. No put passes expirationTtl.
 */

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

// Paid deciders. One question bills flash; two or more answer jointly so the
// state is charged once. No `:free` slugs here.
export const DECIDER = 'perplexity/pplx-decider-flash-v1.2';
export const JOINT_DECIDER = 'perplexity/pplx-decider-v1.2';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL DEFAULT (datetime('now')),
  domain        TEXT,
  asked         TEXT NOT NULL,
  decided       TEXT,
  correct       INTEGER,
  corrected_to  TEXT,
  outcome       TEXT
)`,
  `CREATE INDEX IF NOT EXISTS decisions_domain_at ON decisions (domain, at)`,
  // Added after the table existed; fails harmlessly on a table that has it.
  `ALTER TABLE decisions ADD COLUMN outcome TEXT`,
];


/**
 * What she is choosing between is what the surface in front of her can actually
 * do — not a generic menu. mind has its presets and its browser; cards has the
 * table and the things he does to a card. A surface with no table falls back to
 * the generic moves below.
 *
 * `none` is always a real option: if the ask is not any of these, she says so.
 */
export const SURFACES = {
  mind: {
    question: 'What is he wanting?',
    labels: {
      truth: 'Answer from the truth store',
      operator: 'Answer it',
      mnl: 'The manual form',
      doc: 'Lay it out as a document',
      micro: 'Build a microsite',
      style: 'A palette for the Stylist',
      browse: 'Read the page first',
    },
    actions: {
      truth: 'An answer from the truth store — the truth preset. A stored truth answers in place of a model.',
      operator: 'An answer in the operator voice, written now.',
      mnl: 'An answer as MNL — the manual form.',
      doc: 'Material laid out as a document, in the doc preset.',
      micro: 'A microsite, built in the micro preset.',
      style: 'A palette, not an answer — colours and type for the Stylist.',
      browse: 'Go and read a page on the web first, then answer from what it says.',
      none: 'None of these. Say so rather than guess.',
    },
  },
  cards: {
    question: 'What is he wanting?',
    labels: {
      answer: 'Answer it',
      search: 'Search the web',
      fetch: 'Read a page',
      card: 'Make a card',
      merge: 'Merge cards',
      split: 'Split a card',
      template: 'Use a template',
      style: 'Restyle a card',
      magic: 'Tidy a card',
      continue: 'Carry on with it',
    },
    actions: {
      answer: 'Answer it, written now, on a card.',
      search: 'Search the web and answer from what comes back.',
      fetch: 'Read a page he named and put it on a card.',
      card: 'Make a card from what he supplied.',
      merge: 'Combine cards already on the table into one.',
      split: 'Break one card into two or three.',
      template: 'Lay a card out in one of his saved templates.',
      style: 'Rewrite a card in the style he named — a theme, a palette, a mood.',
      magic: 'Tighten and clear up a card that already exists.',
      continue: 'Carry an existing card on to the next step.',
      none: 'None of these. Say so rather than guess.',
    },
  },
};

/** The menu: a definition per option, with `none` as a real catch-all. */
export const MOVES = {
  card: 'The ask names something this workspace already does with a card: an audit, a merge, a distill, a fetch, a search. If it could be done by clicking something that already exists, it is this.',
  template: 'The ask is to lay material out in the HTML template — styling, structure, or sending a finished document over.',
  document: 'The message carries a document or a block of HTML whose text is the payload. The ask is to correct it, restyle it, or place it.',
  microsite: 'A word with a three- or four-digit code attached, or a reference to a page he has placed somewhere. It is an address, not a question.',
  question: 'A question that expects an answer, with no artifact to build and no card to run.',
  none: 'None of the above. The ask is not addressed by anything on this menu — say so and ask him what he means.',
};

export const INTENT_QUESTION = 'Which of these is he asking for?';

/**
 * Where it goes. A separate axis from what it is: the same ask can be an audit
 * and still belong to truth.
 */
export const ROUTES = {
  truth: 'The truth store may already hold this, or it is an audit of material against stored truth.',
  generate: 'Nothing stored covers it and something has to be written, fetched or searched for.',
  card: 'The work happens in the workspace: a card runs, merges, files or lays something out.',
  answer: 'He wants the answer back and nothing else has to happen.',
};

export const ROUTE_QUESTION = 'Where does this go?';

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
      route: entry.route ? clip(entry.route, 24) : null,
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
  const routes = options.routes || ROUTES;
  const surface = SURFACES[options.surface] || null;
  const asked = options.moves || (surface ? surface.actions : MOVES);
  // Two questions are answered jointly, so the state is billed once.
  const model = options.model || JOINT_DECIDER;
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
      state: options.review ? String(text) + '\n\n' + options.review : String(text),
      questions: {
        intent: {
          type: 'choice',
          instructions: surface ? surface.question : INTENT_QUESTION,
          criteria: asked,
        },
        ...(surface ? {} : {
          route: {
            type: 'choice',
            instructions: ROUTE_QUESTION,
            criteria: routes,
          },
        }),
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
  const route = (data && data.answers && data.answers.route) || null;

  if (!answer || answer.type === 'refusal') {
    return { move: null, route: null, refused: true, probabilities: null, confidence: null, routeConfidence: null, cost: data?.usage?.cost ?? null, model: data?.model || model };
  }

  return {
    move: answer.choice ?? null,
    route: route && route.type !== 'refusal' ? route.choice ?? null : null,
    refused: false,
    probabilities: answer.probabilities || null,
    confidence: answer.confidence ?? null,
    routes: route && route.type !== 'refusal' ? route.probabilities || null : null,
    routeConfidence: route && route.type !== 'refusal' ? route.confidence ?? null : null,
    cost: data?.usage?.cost ?? null,
    model: data?.model || model,
  };
}

/** What the run produced, for a row that has been told. Evidence, not advice. */
function describeOutcome(row) {
  if (!row || !row.outcome) return '';
  let out = null;
  try {
    out = typeof row.outcome === 'string' ? JSON.parse(row.outcome) : row.outcome;
  } catch {
    return '';
  }
  if (!out) return '';
  if (out.stored) return `the run returned a stored ${out.stored} answer`;
  if (out.returned === 'generated') return 'the run wrote a new answer';
  if (out.returned) return `the run returned ${out.returned}`;
  if (out.returned === false || out.returned === 'nothing') return 'the run returned nothing';
  return '';
}

/**
 * What a decision actually produced. The product reports it after the fact; she
 * keeps it beside the row, so her own record carries both what she chose and
 * what came of it.
 */
export function createLoop(env, options = {}) {
  const clock = options.clock || (() => new Date());
  const db = env && env.DB ? env.DB : null;
  const kv = env && env.KV ? env.KV : null;

  async function ensure() {
    if (!db) return false;
    for (const statement of SCHEMA) {
      try {
        await db.prepare(statement).run();
      } catch {
        // A column that is already there, or an index that already exists.
      }
    }
    return true;
  }

  /**
   * What he has already said, in his own terms: the ask, what she gave him, and
   * whether that was what he wanted. His reaction is evidence, not an answer:
   * the correction is his to judge, and hers to work out.
   */
  async function review(domain) {
    if (!db) return { text: '', count: 0 };
    let rows = [];
    try {
      const statement = domain
        ? db.prepare(
            'SELECT asked, decided, correct, outcome FROM decisions WHERE (correct IS NOT NULL OR outcome IS NOT NULL) AND domain = ? ORDER BY at DESC, id DESC LIMIT 12',
          ).bind(domain)
        : db.prepare(
            'SELECT asked, decided, correct, outcome FROM decisions WHERE correct IS NOT NULL OR outcome IS NOT NULL ORDER BY at DESC, id DESC LIMIT 12',
          );
      const out = await statement.all();
      rows = out?.results || out || [];
    } catch {
      return { text: '', count: 0 };
    }
    if (!rows.length) return { text: '', count: 0 };

    const lines = rows
      .filter((row) => row && row.asked)
      .map((row) => {
        const asked = clip(row.asked, 140);
        const parts = [`she chose ${row.decided}`];
        const happened = describeOutcome(row);
        if (happened) parts.push(happened);
        if (Number(row.correct) === 1) parts.push('he said that was what he wanted');
        else if (Number(row.correct) === 0) parts.push('he said that was not what he wanted');
        return `- "${asked}" → ${parts.join('; ')}`;
      });

    return {
      text:
        'What he has said about these before, in his own words. Nothing here tells you what to pick:\n' +
        lines.join('\n'),
      count: lines.length,
    };
  }

  /** Ask, then write the row. */
  async function arrive(text, { domain = null, ...askOptions } = {}) {
    // She reviews everything he has judged before she decides again.
    const looked = await review(domain);
    const decided = await ask(env, text, { ...askOptions, review: looked.text });
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
        at, domain, asked: text, decided: decided.move, route: decided.route,
        refused: decided.refused, confidence: decided.confidence, routeConfidence: decided.routeConfidence,
        probabilities: decided.probabilities, routes: decided.routes,
        cost: decided.cost, model: decided.model, correct: null, id,
        reviewed: looked.count,
      };
      // No expirationTtl: this is a record.
      await kv.put(key, JSON.stringify(body), { metadata: metadataFor(body) });
    }

    // She answers; the row is what gets written. No probabilities ride out.
    // What the decider billed rides out; what it thought of him does not.
    const face = SURFACES[askOptions.surface] || null;
    return {
      id, key, at, domain,
      move: decided.move, route: decided.route, refused: decided.refused, cost: decided.cost,
      reviewed: looked.count,
      question: face ? face.question : null,
      options: face && face.labels ? Object.values(face.labels) : null,
    };
  }

  /** The product reports what the decision produced, after it produced it. */
  async function outcome({ id, returned = null, stored = null, route = null } = {}) {
    if (id == null) throw new Error('outcome needs the row id');
    const what = { returned, stored, route, at: clock().toISOString() };

    if (db) {
      await db
        .prepare('UPDATE decisions SET outcome = ? WHERE id = ?')
        .bind(JSON.stringify(what), Number(id))
        .run();
    }

    let row = null;
    if (db) row = await db.prepare('SELECT * FROM decisions WHERE id = ?').bind(Number(id)).first();
    const key = row ? interactionKey(row.domain, row.at) : null;
    if (kv && key) {
      const raw = await kv.get(key);
      if (raw) {
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        body.outcome = what;
        await kv.put(key, JSON.stringify(body), { metadata: metadataFor(body) });
      }
    }

    return { id: Number(id), outcome: what, key };
  }

  /** The verdict: 1 or 0, and what it should have been. */
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

  /** Counted from the rows. */
  async function progress(domain = null) {
    if (!db) return { correct: 0, wrong: 0, pending: 0 };
    const sql = `SELECT SUM(correct = 1) AS ok, SUM(correct = 0) AS bad, SUM(correct IS NULL) AS open, COUNT(*) AS total
      FROM decisions ${domain ? 'WHERE domain = ?' : ''}`;
    const statement = domain ? db.prepare(sql).bind(domain) : db.prepare(sql);
    const row = (await statement.first()) || {};
    // Counts only. No rate, no score.
    return {
      correct: Number(row.ok || 0),
      wrong: Number(row.bad || 0),
      pending: Number(row.open || 0),
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

  return { ensure, arrive, outcome, feedback, progress, recent, detail };
}
