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
  outcome       TEXT,
  idiom         TEXT
)`,
  `CREATE INDEX IF NOT EXISTS decisions_domain_at ON decisions (domain, at)`,
  // Added after the table existed; fails harmlessly on a table that has it.
  `ALTER TABLE decisions ADD COLUMN outcome TEXT`,
  `ALTER TABLE decisions ADD COLUMN idiom TEXT`,
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
    store: 'truth',
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
    store: 'search',
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
          instructions: (surface ? surface.question : INTENT_QUESTION) + ' ' + IDIOM_RULE,
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
// The shape of an ask, which is what his idiom is made of: a bare code is a
// lookup, a question is a question, a verb first is an instruction. Consensus is
// counted per shape, so a pattern learned on one ask carries to the next one of
// the same shape.
const VERBS = new Set([
  'make', 'change', 'add', 'remove', 'delete', 'split', 'merge', 'fix', 'set', 'turn',
  'show', 'give', 'write', 'read', 'open', 'close', 'bump', 'restyle', 'tidy', 'carry',
  'keep', 'use', 'send', 'take', 'put', 'move', 'copy', 'list', 'find', 'search', 'check',
]);

const IDIOM_NAMES = {
  code: 'a bare code',
  reference: 'a reference',
  question: 'a question',
  instruction: 'an instruction',
  short: 'a short phrase',
  statement: 'a statement',
  empty: 'nothing',
};

export function idiomOf(text) {
  const raw = String(text || '').trim();
  const low = raw.toLowerCase();
  if (!raw) return { kind: 'empty', name: IDIOM_NAMES.empty };
  if (/^https?:\/\//i.test(raw) || /^\/[^\s]*$/.test(raw)) return { kind: 'reference', name: IDIOM_NAMES.reference };
  if (raw.split(/\s+/).length === 1 && /^[a-z]{1,8}[-_]?\d{2,}$/i.test(raw)) return { kind: 'code', name: IDIOM_NAMES.code };
  if (/\?$/.test(raw) || /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|would|will)\b/i.test(low)) {
    return { kind: 'question', name: IDIOM_NAMES.question };
  }
  const first = low.split(/\s+/)[0].replace(/[^a-z]/g, '');
  if (VERBS.has(first)) return { kind: 'instruction', name: IDIOM_NAMES.instruction };
  if (raw.length <= 24 && raw.split(/\s+/).length <= 2) return { kind: 'short', name: IDIOM_NAMES.short };
  return { kind: 'statement', name: IDIOM_NAMES.statement };
}

/** His logic, as her criteria: stated beats pattern, pattern beats guessing. */
const IDIOM_RULE =
  'If he states what he wants, that is the answer. If asks of this shape have gone one way before, that is where this one goes. If it is new and not clear, choose none.';

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
  async function review(domain, ask = null, idiom = null, store = null) {
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
    // Her own consensus: what she has repeatedly chosen in this surface. Not a
    // score and not advice — the thing she has already done, so she can carry it
    // through instead of deciding each ask from nothing.
    let tally = [];
    try {
      const counted = domain
        ? db.prepare('SELECT decided, COUNT(*) AS n FROM decisions WHERE decided IS NOT NULL AND domain = ? GROUP BY decided ORDER BY n DESC').bind(domain)
        : db.prepare('SELECT decided, COUNT(*) AS n FROM decisions WHERE decided IS NOT NULL GROUP BY decided ORDER BY n DESC');
      const out = await counted.all();
      tally = out?.results || out || [];
    } catch {
      tally = [];
    }

    // Consensus by shape: what has happened to asks of this kind before.
    let shapeRows = [];
    try {
      const recent = domain
        ? db.prepare('SELECT asked, decided, correct, outcome FROM decisions WHERE domain = ? ORDER BY at DESC, id DESC LIMIT 80').bind(domain)
        : db.prepare('SELECT asked, decided, correct, outcome FROM decisions ORDER BY at DESC, id DESC LIMIT 80');
      const out = await recent.all();
      const all = out?.results || out || [];
      if (idiom) shapeRows = all.filter((row) => row && row.decided && idiomOf(row.asked).kind === idiom.kind);
    } catch {
      shapeRows = [];
    }

    const per = {};
    for (const row of shapeRows) {
      const slot = (per[row.decided] = per[row.decided] || { n: 0, right: 0, wrong: 0, stored: 0 });
      slot.n += 1;
      if (row.correct != null && Number(row.correct) === 1) slot.right += 1;
      if (row.correct != null && Number(row.correct) === 0) slot.wrong += 1;
      if (row.outcome && String(row.outcome).includes('"stored"')) slot.stored += 1;
    }

    const ranked = Object.entries(per).sort((a, b) => (b[1].right - b[1].wrong) - (a[1].right - a[1].wrong) || b[1].n - a[1].n);
    let lead = ranked[0] ? { move: ranked[0][0], ...ranked[0][1], shape: idiom ? idiom.name : null } : null;

    // A shape whose asks came back from the store is a lookup, not an unknown:
    // "ask him" is the wrong answer for something that has already been answered.
    const storedHere = shapeRows.filter((row) => row.outcome && String(row.outcome).includes('"stored"')).length;
    if (store && storedHere && lead && lead.move === 'none') {
      lead = { ...(per[store] || { n: 0, right: 0, wrong: 0, stored: 0 }), move: store, shape: idiom ? idiom.name : null };
    }

    const storeLine =
      store && storedHere
        ? `The run returned a stored answer for ${storedHere} of these asks: this shape is a lookup, and ${store} is the move that reads the store.\n`
        : '';

    const shapeLine = ranked.length
      ? `Asks like this (${idiom ? idiom.name : 'this shape'}) before, ${shapeRows.length} of them: ` +
        ranked
          .map(([move, slot]) => {
            const bits = [];
            if (slot.stored) bits.push(`the run returned a stored answer ${slot.stored}`);
            if (slot.right) bits.push(`he wanted it ${slot.right}`);
            if (slot.wrong) bits.push(`he did not want it ${slot.wrong}`);
            return `${move} ${slot.n}${bits.length ? ' (' + bits.join(', ') + ')' : ''}`;
          })
          .join('; ') +
        '.\n'
      : '';

    const seen = tally
      .filter((row) => row && row.decided)
      .map((row) => `${row.decided} ${row.n}`)
      .join(', ');

    if (!rows.length) {
      return { text: seen ? `She has chosen here before: ${seen}.` : '', count: 0 };
    }

    const lines = rows
      .filter((row) => row && row.asked)
      .map((row) => {
        const asked = clip(row.asked, 140);
        const parts = [`she chose ${row.decided}`];
        const happened = describeOutcome(row);
        if (happened) parts.push(happened);
        // A row he has not judged is not a rejection: Number(null) is 0.
        if (row.correct != null && Number(row.correct) === 1) parts.push('he said that was what he wanted');
        else if (row.correct != null && Number(row.correct) === 0) parts.push('he said that was not what he wanted');
        return `- "${asked}" → ${parts.join('; ')}`;
      });

    // The identical ask, if it has come up: a pattern of one repeated is still a
    // pattern, and it is the one she most needs to carry.
    const same = ask ? rows.filter((row) => String(row.asked) === String(ask)) : [];
    const carried = same.length
      ? `${same.length === 1 ? 'Once' : same.length + ' times'} before, this exact ask: ` +
        same
          .slice(0, 4)
          .map((row) => {
            const did = describeOutcome(row);
            const said = row.correct != null ? (Number(row.correct) === 1 ? ', which he wanted' : ', which he did not') : '';
            return `${row.decided}${said}${did ? ' (' + did + ')' : ''}`;
          })
          .join('; ') +
        '.\n\n'
      : '';

    return {
      text:
        carried +
        shapeLine +
        storeLine +
        (seen ? `\nShe has chosen here before: ${seen}.\n\n` : '') +
        (lines.length ? 'What happened on the asks he has reacted to, and where the run showed the result:\n' + lines.join('\n') : '') +
        '\nDo not choose again a move he has already rejected for the same ask.',
      count: lines.length + shapeRows.length,
      consensus: lead,
    };
  }

  /** Ask, then write the row. */
  async function arrive(text, { domain = null, ...askOptions } = {}) {
    // She reviews everything he has judged before she decides again.
    const idiom = idiomOf(text);
    const looked = await review(domain, text, idiom, (SURFACES[askOptions.surface] || {}).store || null);
    const decided = await ask(env, text, { ...askOptions, review: looked.text });
    const at = clock().toISOString();
    const key = interactionKey(domain, at);

    let id = null;
    if (db) {
      const result = await db
        .prepare('INSERT INTO decisions (at, domain, asked, decided, correct, corrected_to, idiom) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(at, domain, String(text), decided.move, null, null, idiom.kind)
        .run();
      id = rowId(result);
    }

    if (kv) {
      const body = {
        at, domain, asked: text, decided: decided.move, route: decided.route,
        refused: decided.refused, confidence: decided.confidence, routeConfidence: decided.routeConfidence,
        probabilities: decided.probabilities, routes: decided.routes,
        cost: decided.cost, model: decided.model, correct: null, id,
        reviewed: looked.count, idiom: idiom.kind, consensus: looked.consensus || null,
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
      idiom: idiom.kind,
      consensus: looked.consensus || null,
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

  return { ensure, arrive, outcome, feedback, progress, recent, detail, review };
}
