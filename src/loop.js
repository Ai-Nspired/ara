/**
 * ARA's loop: decide, write the row, take the verdict, count it.
 *
 * The worker writes everything. The decider answers a presented question and
 * produces no text; it stores nothing. The metrics come from the rows.
 *
 * D1 holds the rows, KV holds the body with a short metadata summary beside it so
 * history reads without fetching bodies. No put passes expirationTtl.
 */

// The deciders are reached through orproxy, which holds the OpenRouter key and
// forwards this endpoint's body and answer shape unchanged. She calls the
// provider directly nowhere, so `ara` binds no provider key of its own.
export const DECISIONS_URL = 'https://orproxy.ai-n.workers.dev/api/decide';

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
  idiom         TEXT,
  surface       TEXT
)`,
  `CREATE INDEX IF NOT EXISTS decisions_domain_at ON decisions (domain, at)`,
  // Added after the table existed; fails harmlessly on a table that has it.
  `ALTER TABLE decisions ADD COLUMN outcome TEXT`,
  `ALTER TABLE decisions ADD COLUMN idiom TEXT`,
  `ALTER TABLE decisions ADD COLUMN surface TEXT`,
  // What the decision itself cost, and how long it took. Both arrive with the
  // answer and were discarded, so there was nothing to compare one decider with
  // another on. Fails harmlessly on a table that already has them.
  `ALTER TABLE decisions ADD COLUMN model TEXT`,
  `ALTER TABLE decisions ADD COLUMN cost REAL`,
  `ALTER TABLE decisions ADD COLUMN ms INTEGER`,
  `ALTER TABLE decisions ADD COLUMN confidence REAL`,
  // What was intended, as distinct from what was decided. Explicit, implicit,
  // interpreted and confirmed stay in separate columns so an inference can
  // never quietly become a confirmed fact; `confidence` above stays the
  // decision's confidence, and these are the dimensions it must not absorb.
  // Preference confidence is not here: it accumulates per domain in Memoria.
  `ALTER TABLE decisions ADD COLUMN intent_explicit TEXT`,
  `ALTER TABLE decisions ADD COLUMN intent_implicit TEXT`,
  `ALTER TABLE decisions ADD COLUMN intent_interpreted TEXT`,
  `ALTER TABLE decisions ADD COLUMN intent_confirmed TEXT`,
  `ALTER TABLE decisions ADD COLUMN context TEXT`,
  `ALTER TABLE decisions ADD COLUMN domains TEXT`,
  `ALTER TABLE decisions ADD COLUMN intent_confidence REAL`,
  `ALTER TABLE decisions ADD COLUMN domain_confidence REAL`,
  `ALTER TABLE decisions ADD COLUMN evidence_confidence REAL`,
  // The words the surface in front of him handles itself. A surface reports each one as
  // it uses it, so this is learned from what happens rather than written into her: a
  // bare command is not a key waiting for a pair.
  `CREATE TABLE IF NOT EXISTS terms (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  term    TEXT NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'command',
  surface TEXT,
  app     TEXT,
  hits    INTEGER NOT NULL DEFAULT 1,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(term, surface)
)`,
  `CREATE INDEX IF NOT EXISTS terms_surface ON terms (surface, kind)`,
];


/** A word as it is compared: lower case, no punctuation, single spaces. */
export function termKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The commands this surface has reported. Nothing is assumed about a word not here. */
export async function knownTerms(db, surface) {
  if (!db) return [];
  try {
    const rows = await db
      .prepare("SELECT term FROM terms WHERE kind = 'command' AND (surface = ? OR surface IS NULL) ORDER BY hits DESC LIMIT 40")
      .bind(surface || null)
      .all();
    return ((rows && rows.results) || []).map((row) => row.term).filter(Boolean);
  } catch (error) {
    return [];
  }
}

/** A surface saying "this word is mine": counted, not replaced, so use is the evidence. */
export async function recordTerm(db, { term, kind = 'command', surface = null, app = null } = {}) {
  if (!db) return null;
  const key = termKey(term);
  if (!key) return null;
  try {
    await db
      .prepare("INSERT INTO terms (term, kind, surface, app, hits) VALUES (?, ?, ?, ?, 1) ON CONFLICT(term, surface) DO UPDATE SET hits = hits + 1, at = datetime('now')")
      .bind(key, kind, surface, app)
      .run();
    return key;
  } catch (error) {
    return null;
  }
}

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
    // Three things, and only three: a result produced, a preset run, or a
    // question answered. Everything he hands over is one of them.
    question: 'He has handed you this. Which is it: a result he wants produced, a preset he wants run, or something he is asking?',
    store: 'result',
    labels: {
      result: 'A result produced',
      preset: 'A preset run',
      ask: 'Something he is asking',
      unclear: 'I am not sure — ask me',
    },
    actions: {
      result: 'A result — the thing itself, produced: what the store already holds, or the artifact built. No new prose.',
      preset: 'One of his presets, run as that preset — he says which, or the client already has it selected.',
      ask: 'He is asking something, and the answer is written now.',
      unclear: 'You cannot tell which of these he is after. Say so: he is asked with these as the options, and nothing is written.',
    },
  },
  cards: {
    question: 'He has presented this. What result is he trying to get?',
    store: 'search',
    labels: {
      answer: 'An answer on a card',
      search: 'An answer from the web',
      fetch: 'The page, on a card',
      card: 'A new card',
      merge: 'One card, not several',
      split: 'Several cards, not one',
      template: 'A card in his template',
      style: 'A card in a style he named',
      magic: 'A card that is tighter',
      continue: 'A card carried on',
    },
    actions: {
      answer: 'An answer written onto a card.',
      search: 'An answer that comes from the web, searched now.',
      fetch: 'The contents of a page he named, put on a card.',
      card: 'A new card made from what he supplied.',
      merge: 'One card where there were several.',
      split: 'Several cards where there was one.',
      template: 'A card laid out in one of his saved templates.',
      style: 'A card rewritten in the style he named — a theme, a palette, a mood.',
      magic: 'A card that is tighter and clearer than the one on the table.',
      continue: 'An existing card carried on to its next step.',
      none: 'None of these results.',
    },
  },
  ambient: {
    // Pulse: the dock dropped into a page he is already reading. `ambient` is
    // its name today — the Worker, and the `surface` value it sends. `PULSE` is
    // the binding, named for the rename that is coming.
    //
    // Until that rename lands the key stays `ambient`, because that is what the
    // dock puts on the wire and what its rows already say. When the Worker
    // becomes `pulse`, accept both labels and have `review()` look for both:
    // otherwise every row written as `ambient` drops out of Pulse's own history,
    // and that history is the record confidence is read from.
    //
    // It answers in place and draws a card when the answer is a card; it has no
    // table of its own, so `none` is not one of the moves — the answer is the
    // move.
    question: 'He is in the dock, on a page he is reading. What is he asking for?',
    store: null,
    labels: {
      answer: 'An answer in the dock',
      search: 'An answer from the web',
      fetch: 'This page, read',
      card: 'A card from this page',
      unclear: 'I am not sure — ask me',
    },
    actions: {
      answer: 'An answer written in the dock from what she already knows or can reason out. No card, no search.',
      search: 'An answer that has to come from the web, searched now.',
      fetch: 'The page he is looking at, read and reported on: its contents are the answer.',
      card: 'A card drawn into the dock from what he is looking at or attached.',
      unclear: 'You cannot tell which of these he is after. Say so: he is asked with these as the options, and nothing is written.',
    },
  },
  pulse: {
    // The dial. Pulse is the interface: it says what it has and does what she decides.
    // The decision is here, and the rows stay on his side. `recordings` is a projection
    // of what is already logged on the station he is holding, not a description of it,
    // so nothing is written and no prose is spent on it.
    question: 'He is speaking to the dial. What does he want done?',
    store: null,
    labels: {
      recordings: 'What he has recorded, shown',
      answer: 'Something said back to him',
      ask: 'He has to say more',
      unclear: 'I am not sure — ask me',
    },
    actions: {
      recordings: 'Show what is already recorded on his station: the clips that exist, with their station, the time each was made and how long it ran. Nothing is summarised and nothing new is written.',
      answer: 'Something said back to him in place, from what she already knows or can work out. No card is drawn for this.',
      ask: 'The ask is too thin to act on: he is asked a question and nothing happens until he answers.',
      unclear: 'You cannot tell which of these he is after. Say so, with these as the options, and nothing is written.',
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

/**
 * The domain set of one ask, as the row records it. `origin` is the part
 * `general` alone cannot say: whether the primary came from him, from her, or
 * from the default when neither named one. `candidate` keeps what the decider
 * proposed even when it was not adopted, so a rejected classification is
 * recorded rather than dropped.
 */
export const domainSet = (primary, origin, candidate = null) => JSON.stringify({
  primary,
  origin,
  candidate: candidate || null,
  set: [primary],
});

/**
 * One card, projected from one list.
 *
 * `card.options` carries `{ value, label }`, so a client that returns a click
 * can send the value and not the sentence in front of it. `options` beside it is
 * the labels alone, for a reader that only knows how to render strings;
 * `question` and `text` are the same line it already looks for. Every one of
 * those fields is derived here, which is the point: a card whose menu lives in
 * two places is a card whose menu will disagree with itself. `[object Object]`
 * was that disagreement showing through — one path handed out objects and the
 * other handed out strings, and the client that guessed strings stringified
 * objects.
 *
 * `clarify` is only present when the card is actually asking him something, so
 * its presence keeps meaning "this needs an answer".
 */
export const cardFor = (question, options = [], { text = question, clarify = false } = {}) => {
  const list = options.map(({ value, label }) => ({ value, label }));
  const shape = {
    card: { question, text, options: list },
    question,
    text,
    options: list.map((option) => option.label),
  };
  if (clarify) shape.clarify = { text, questions: [{ id: 'want', q: question, options: list }] };
  return shape;
};

/** A surface's menu as value+label pairs. `drop` removes her own "not sure". */
export const surfaceOptions = (face, { drop = [] } = {}) =>
  Object.entries((face && face.labels) || {})
    .filter(([value]) => !drop.includes(value))
    .map(([value, label]) => ({ value, label }));

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
export async function ask(text, options = {}) {
  if (!text) throw new Error('ask needs what was asked');
  const fetchImpl = options.fetchImpl || fetch;
  const routes = options.routes || ROUTES;
  const surface = SURFACES[options.surface] || null;
  const asked = options.moves || (surface ? surface.actions : MOVES);
  // Two questions are answered jointly, so the state is billed once.
  const model = options.model || JOINT_DECIDER;

  // Images ride inside the state, exactly where the decider reads them. A caller
  // that sends none gets the string it always got, so nothing else changes.
  const images = (Array.isArray(options.images) ? options.images : [])
    .filter((url) => typeof url === 'string' && /^data:image\//.test(url))
    .slice(0, 8);
  const written = options.review ? String(text) + '\n\n' + options.review : String(text);
  const state = images.length
    ? [written, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : written;

  const started = Date.now();
  const response = await fetchImpl(DECISIONS_URL, {
    method: 'POST',
    headers: {
      // orproxy adds the upstream credential; nothing here is a secret.
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      state,
      questions: {
        intent: {
          type: 'choice',
          instructions:
            (surface ? surface.question : INTENT_QUESTION) +
            (Array.isArray(options.commands) && options.commands.length
              ? ' He uses these words as commands on this surface: ' + options.commands.join(', ') + '. A bare one of them is that command, not a key and not an unknown word.'
              : '') +
            ' ' +
            IDIOM_RULE,
          criteria: asked,
        },
        ...(options.domains && options.domains.length
          ? {
              scope: {
                type: 'choice',
                instructions: 'Which domain is he asking in?',
                // criteria is a record: the option, and what it means.
                criteria: Object.fromEntries(options.domains.map((name) => [name, name])),
              },
            }
          : {}),
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

  const ms = Date.now() - started;
  const data = await response.json();
  const answer = (data && data.answers && data.answers.intent) || null;
  const route = (data && data.answers && data.answers.route) || null;
  const scope = (data && data.answers && data.answers.scope) || null;

  if (!answer || answer.type === 'refusal') {
    return { move: null, route: null, refused: true, probabilities: null, confidence: null, routeConfidence: null, cost: data?.usage?.cost ?? null, ms, model: data?.model || model };
  }

  return {
    move: answer.choice ?? null,
    scope: scope && scope.type !== 'refusal' ? scope.choice ?? null : null,
    route: route && route.type !== 'refusal' ? route.choice ?? null : null,
    refused: false,
    probabilities: answer.probabilities || null,
    confidence: answer.confidence ?? null,
    routes: route && route.type !== 'refusal' ? route.probabilities || null : null,
    routeConfidence: route && route.type !== 'refusal' ? route.confidence ?? null : null,
    cost: data?.usage?.cost ?? null,
    ms,
    model: data?.model || model,
  };
}

/** A stored "answer" that is really a question back at him. */
function asksBackText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  // No length limit: the long ones are the worst offenders, and dno000's stored
  // text runs past three hundred characters before it gets to the question.
  if (/\?["')\]]*\s*$/.test(value)) return true;
  return /\b(what is the call|how would you like|do you want me to|please (specify|clarify)|let me know|can you clarify|clarification needed|intended action|resend|which one)\b/i.test(value);
}

/** A stored answer that was already there. One written moments ago is not that. */
function isLookup(outcome) {
  let out = null;
  try {
    out = typeof outcome === 'string' ? JSON.parse(outcome) : outcome;
  } catch {
    return false;
  }
  if (!out || !out.stored) return false;
  if (out.origin && out.origin.fresh) return false;
  return true;
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
  if (out.stored === 'master') return 'a stored master answer';
  if (out.stored === 'provisional') {
    // Written in that moment is not written by him beforehand.
    return out.origin && out.origin.fresh
      ? 'a provisional answer that had just been written on the spot, not one he wrote'
      : 'a provisional answer that was already in the store';
  }
  if (out.stored === 'candidate') {
    return out.origin && out.origin.fresh
      ? 'a candidate written on the spot, not one he wrote'
      : 'a candidate that was already in the store';
  }
  if (out.stored) return `a stored ${out.stored} answer`;
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
  code: 'a key',
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
  // Greetings and courtesies are not keys, whatever their length.
  if (/^(hi|hey|hello|yo|thanks|thank|cheers|yes|no|yep|nope|ok|okay|please|stop|help)\b/i.test(low)) {
    return { kind: 'short', name: IDIOM_NAMES.short };
  }
  if (/\?$/.test(raw) || /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|would|will)\b/i.test(low)) {
    return { kind: 'question', name: IDIOM_NAMES.question };
  }
  const words = raw.split(/\s+/);
  const first = words[0].replace(/[^a-z]/g, '');
  if (VERBS.has(first)) return { kind: 'instruction', name: IDIOM_NAMES.instruction };
  // A word, or two words and no sentence around them: that is a key looking for
  // its pair, not prose. Plain language has verbs and articles in it.
  if (words.length <= 2 && !/[.!]$/.test(raw) && !/^(a|an|the)\b/i.test(low)) {
    return { kind: 'code', name: IDIOM_NAMES.code };
  }
  if (raw.length <= 24 && words.length <= 3) return { kind: 'short', name: IDIOM_NAMES.short };
  return { kind: 'statement', name: IDIOM_NAMES.statement };
}

/** His logic, as her criteria: stated beats pattern, pattern beats guessing. */
const IDIOM_RULE =
  'If he states the result he wants, that is the answer. If asks of this shape have got one result before, that is the result here. If it is new and not clear, choose none.';

// What he actually said, clause by clause. Descriptive only: nothing here
// grants anything. A question is a communication whose objective may remain
// unresolved; a statement is not permission; an imperative is a shape, not an
// authorization to execute. VERBS and idiomOf() are signals, never proof of
// intent. Every clause is kept verbatim, including the ones that classify as
// nothing at all.
const OBJECTIVE = /\b(should be|i want|i need|the goal is|goal:|the answer is|result should)\b/i;

export function explicitIntent(text, options = {}) {
  const raw = String(text == null ? '' : text);
  const found = raw.match(/[^.?!;\n]+[.?!;]?/g) || (raw.trim() ? [raw.trim()] : []);
  const clauses = found.map((clause, index) => {
    const shown = clause.replace(/^\s+|\s+$/g, '');
    const low = shown.toLowerCase();
    const first = low.split(/\s+/)[0].replace(/[^a-z]/g, '');
    let kind = 'unclassified';
    if (/[a-z0-9]/i.test(shown)) {
      const shape = idiomOf(shown).kind;
      if (/\?$/.test(shown) || /^(what|why|how|when|where|who|which|is|are|was|were|does|do|did|can|could|should|would|will)\b/.test(low)) kind = 'question';
      else if (OBJECTIVE.test(low)) kind = 'objective';
      else if (VERBS.has(first)) kind = 'instruction';
      else if (shape === 'code' || shape === 'reference') kind = 'lookup';
      else kind = 'statement';
    }
    return { clause: index, kind, text: shown };
  });
  const supplied = [];
  if (options.card) supplied.push({ source: 'card', value: String(options.card) });
  if (options.domain) supplied.push({ source: 'domain', value: String(options.domain) });
  return JSON.stringify({ authority: 'not_evaluated', clauses, supplied });
}

// Candidates, each with the basis it came out of. A candidate is not a fact, and
// one that contradicts the explicit layer is kept rather than dropped.
export function implicitIntent({ idiom, looked, held } = {}) {
  const candidates = [];
  if (idiom) candidates.push({ reading: `the ask is ${idiom.name}`, basis: `shape of the ask (${idiom.kind})`, weight: null });
  const lead = looked && looked.consensus;
  if (lead && lead.move) {
    const right = Number(lead.right || 0);
    const wrong = Number(lead.wrong || 0);
    candidates.push({
      reading: `he will want ${lead.move}`,
      basis: `${Number(lead.n || 0)} asks of this shape before; he wanted it ${right}, did not ${wrong}`,
      weight: right + wrong ? Number((right / (right + wrong)).toFixed(4)) : null,
    });
  }
  if (held) {
    candidates.push({ reading: 'the stored pair is the result he wants', basis: `the store holds an answer at layer ${held.layer}`, weight: null });
  }
  return JSON.stringify(candidates);
}

// Her reading as the decider returned it, refusals and unclarity included, so a
// reading that ended in "I cannot tell" is not lost. What the decider said about
// its own confidence is kept here too, as a claim and nothing more: the measured
// number lives in the confidence columns, read from the record.
export function interpretedIntent(decided) {
  return JSON.stringify({
    move: decided && decided.move != null ? decided.move : null,
    scope: decided && decided.scope != null ? decided.scope : null,
    refusal: Boolean(decided && decided.refused),
    unclear: Boolean(decided && decided.move === 'unclear'),
    // What the decider said about itself, kept as a claim and never as a
    // confidence: a model's self-report is not a measurement of the operator.
    claimed: decided && decided.confidence != null ? decided.confidence : null,
  });
}

/**
 * Confidence is the relationship with the operator, read from the record.
 *
 * Explicit signals are his verdicts on asks of this shape: `right` and `wrong`.
 * Implicit signals are the pattern itself: how many asks of this shape there
 * are, and how many of them he has actually judged. Agreement is consensus with
 * her reading; coverage is how much of the pattern has been verified. Their
 * product is what rises as a preference repeats and holds — never a number the
 * decider asserted about itself.
 *
 * No pattern, or nothing judged, gives `null`: the relationship is unmeasured,
 * which is not the same as measured and wrong. The band is reported beside the
 * number so nobody reads a float as truth. Nothing here gates behaviour yet.
 */
export const PREDICT_AT = 0.3;
export const SYNERGY_AT = 0.65;

export function confidenceFrom({ looked, move = null, domain = null, origin = null } = {}) {
  const shape = (looked && looked.shape) || {};
  const slot = move ? shape[move] || null : null;
  const right = Number((slot && slot.right) || 0);
  const wrong = Number((slot && slot.wrong) || 0);
  const judged = right + wrong;
  const asks = Math.max(Number((looked && looked.shapeSeen) || 0), judged);
  const agree = judged ? Number((right / judged).toFixed(4)) : null;
  const cover = asks ? Number((judged / asks).toFixed(4)) : null;
  const value = agree == null || cover == null ? null : Number((agree * cover).toFixed(4));

  // The domain's own record: how often her choices in it were what he wanted.
  const tally = (looked && looked.domain) || {};
  const domainRight = Number(tally.ok || 0);
  const domainWrong = Number(tally.bad || 0);
  const sameDomain = Boolean(domain && tally.name && domain === tally.name);
  const domainValue = sameDomain && domainRight + domainWrong
    ? Number((domainRight / (domainRight + domainWrong)).toFixed(4))
    : null;

  return {
    confidence: value,
    band: value == null ? 'unmeasured' : value >= SYNERGY_AT ? 'synergy' : value >= PREDICT_AT ? 'predict' : 'low',
    intent_confidence: value,
    domain_confidence: domainValue,
    evidence_confidence: cover,
    basis: {
      move: move || null,
      shape: (looked && looked.consensus && looked.consensus.shape) || null,
      asks,
      right,
      wrong,
      stored: Number((slot && slot.stored) || 0),
    },
    domain_basis: { domain: domain || null, origin: origin || null, reviewed: tally.name || null, right: domainRight, wrong: domainWrong },
    evidence_basis: { judged, asks },
  };
}

// What surrounded the ask, so the record can be read later without guessing.
export function contextFor({ surface, domain, held, card, repeating } = {}) {
  return JSON.stringify({
    surface: surface || null,
    domain_named: domain || null,
    stored_pair: Boolean(held),
    card: card || null,
    repeating: Number(repeating || 0),
  });
}

// The domains are a list she keeps, not a taxonomy this file invents: every
// domain is a KV key under `domain:`, carrying its own metadata — when it was
// first seen, how often, and what she has chosen in it. Nothing here names a
// domain the owner has not put there.
export const DOMAIN_PREFIX = 'domain:';

const slug = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
  async function review(domain, ask = null, idiom = null, store = null, choices = null) {
    if (!db) return { text: '', count: 0 };
    let rows = [];
    try {
      const statement = domain
        ? db.prepare(
            'SELECT asked, decided, correct, corrected_to, outcome FROM decisions WHERE (correct IS NOT NULL OR outcome IS NOT NULL) AND (surface = ? OR (surface IS NULL AND domain = ?)) ORDER BY at DESC, id DESC LIMIT 12',
          ).bind(domain, domain)
        : db.prepare(
            'SELECT asked, decided, correct, corrected_to, outcome FROM decisions WHERE correct IS NOT NULL OR outcome IS NOT NULL ORDER BY at DESC, id DESC LIMIT 12',
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
        ? db.prepare('SELECT asked, decided, correct, outcome FROM decisions WHERE surface = ? OR (surface IS NULL AND domain = ?) ORDER BY at DESC, id DESC LIMIT 80').bind(domain, domain)
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
      if (row.outcome && isLookup(row.outcome)) slot.stored += 1;
    }

    const ranked = Object.entries(per).sort((a, b) => (b[1].right - b[1].wrong) - (a[1].right - a[1].wrong) || b[1].n - a[1].n);
    let lead = ranked[0] ? { move: ranked[0][0], ...ranked[0][1], shape: idiom ? idiom.name : null } : null;

    // A shape whose asks came back from the store is a lookup, not an unknown:
    // "ask him" is the wrong answer for something that has already been answered.
    const storedHere = shapeRows.filter((row) => row.outcome && isLookup(row.outcome)).length;
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

    // Domain-specific principles: what has held in the domain the ask belongs to.
    // The domain is his list; if the ask is not in one of them, it is general.
    let domainLine = '';
    // The domain's own record, kept rather than only spoken: it is what domain
    // confidence is read from, and it is fetched once for both uses.
    const domainTally = { name: null, ok: 0, bad: 0, n: 0 };
    const assumed = choices && choices.length ? (choices.includes(domain) ? domain : choices.includes('general') ? 'general' : choices[0]) : null;
    if (assumed) {
      domainTally.name = assumed;
      try {
        const statement = db.prepare(
          'SELECT decided, SUM(correct = 1) AS ok, SUM(correct = 0) AS bad, COUNT(*) AS n FROM decisions WHERE domain = ? AND decided IS NOT NULL GROUP BY decided ORDER BY n DESC',
        ).bind(assumed);
        const out = await statement.all();
        const inDomain = out?.results || out || [];
        for (const row of inDomain) {
          domainTally.ok += Number(row.ok || 0);
          domainTally.bad += Number(row.bad || 0);
          domainTally.n += Number(row.n || 0);
        }
        if (inDomain.length) {
          domainLine =
            `In ${assumed}, what has held: ` +
            inDomain
              .map((row) => {
                const bits = [];
                if (Number(row.ok || 0)) bits.push(`he wanted it ${row.ok}`);
                if (Number(row.bad || 0)) bits.push(`he did not want it ${row.bad}`);
                return `${row.decided} ${row.n}${bits.length ? ' (' + bits.join(', ') + ')' : ''}`;
              })
              .join('; ') +
            '.\n';
        }
      } catch {
        domainLine = '';
      }
    }

    const seen = tally
      .filter((row) => row && row.decided)
      .map((row) => `${row.decided} ${row.n}`)
      .join(', ');

    if (!rows.length) {
      // Nothing judged yet: the shape is known and the relationship is not, so
      // the caller gets the counts it needs to say "unmeasured" rather than 0.
      return { text: seen ? `She has chosen here before: ${seen}.` : '', count: 0, shape: per, shapeSeen: shapeRows.length, domain: domainTally, consensus: null, repeating: 0 };
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
        else if (row.correct != null && Number(row.correct) === 0) {
          parts.push('he said that was not what he wanted');
          // His own words for what it should have been. This is his correction,
          // not an answer supplied from outside: it is the record he made.
          if (row.corrected_to) parts.push(`he said the result should have been: ${row.corrected_to}`);
        }
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
            const said = row.correct != null
              ? Number(row.correct) === 1
                ? ', which he wanted'
                : ', which he did not' + (row.corrected_to ? ' (he said it should have been ' + row.corrected_to + ')' : '')
              : '';
            return `${row.decided}${said}${did ? ' (' + did + ')' : ''}`;
          })
          .join('; ') +
        '.\n\n'
      : '';

    return {
      text:
        carried +
        domainLine +
        shapeLine +
        storeLine +
        (seen ? `\nShe has chosen here before: ${seen}.\n\n` : '') +
        (lines.length ? 'What happened on the asks he has reacted to, and where the run showed the result:\n' + lines.join('\n') : '') +
        '\nDo not choose again a move he has already rejected for the same ask.',
      count: lines.length + shapeRows.length,
      consensus: lead,
      repeating: same.length,
      // The tallies the prose was written from, so confidence can be read from
      // the record instead of from the reading's own opinion of itself.
      shape: per,
      shapeSeen: shapeRows.length,
      domain: domainTally,
    };
  }

  /** Ask, then write the row. */
  async function arrive(text, { domain = null, ...askOptions } = {}) {
    // She reviews everything he has judged before she decides again.
    const idiom = idiomOf(text);
    const surface = askOptions.surface || domain || null;
    const known = await domains();
    const choices = known.length ? known : ['general'];
    const store = (SURFACES[surface] || {}).store || null;
    const looked = await review(domain, text, idiom, store, choices);

    // What the store already holds, handed over before she decides. Nothing is
    // generated to find this out: a pair that already exists is either the
    // result, or it is not and she has to ask him.
    const held = askOptions.stored && askOptions.stored.answer ? askOptions.stored : null;
    const heldNote = held
      ? `The store already holds this ask: "${clip(String(held.answer), 220)}" (layer ${held.layer}${held.key ? `, ${held.key}` : ''}). ` +
        'If that is the result he is after, result is the answer. If it comes back as a question instead of an answer, or it was never verified, it is not the result: ask him.'
      : '';
    const seen = heldNote ? `${heldNote}\n\n${looked.text}` : looked.text;

    // A stored pair that asks him back is settled here, not by a decider: the
    // text in front of her already says it is not an answer.
    const pairSettles = Boolean(held) && held.layer !== 'master' && asksBackText(held.answer);

    // A bare word with digits on the end is a key, not a question: it is looking
    // for a stored pair. Found, that pair is the result. Not found, there is
    // nothing to answer and nothing to write until he says what it should be.
    // What the surface handles itself, learned from its reports: a bare one of these is
    // that command, not a key looking for a pair.
    const commands = await knownTerms(db, surface);
    const isKey = idiom.kind === 'code' && !commands.includes(termKey(text));
    if (isKey && !held) {
      // No decider runs here, so the domain is the one he named or the default.
      const pickedNow = choices.includes(domain) ? domain : choices[0];
      const at2 = clock().toISOString();
      const key2 = interactionKey(pickedNow, at2);
      // The same contract as the main path, because this is a record of the ask
      // too, even though no decider ran. "She could not tell" is the reading
      // here, and it is written as a reading rather than left absent. Nothing
      // below is an authorization: a clause is only what the ask looked like.
      const intentWritten = explicitIntent(text, { card: null, domain });
      const intentRead = implicitIntent({ idiom, looked, held: null });
      const intentTaken = interpretedIntent({ move: 'unclear', scope: null, refused: false });
      const intentAround = contextFor({ surface, domain, held: null, card: null, repeating: looked.repeating });
      let id2 = null;
      if (db) {
        const result = await db
          .prepare('INSERT INTO decisions (at, domain, asked, decided, correct, corrected_to, idiom, surface, intent_explicit, intent_implicit, intent_interpreted, context, domains) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(at2, pickedNow, String(text), 'unclear', null, null, idiom.kind, surface, intentWritten, intentRead, intentTaken, intentAround, domainSet(pickedNow, choices.includes(domain) ? 'named' : 'default'))
          .run();
        id2 = rowId(result);
      }
      const said = `"${clip(text, 60)}" is a key, and there is no stored pair for it.`;
      return {
        id: id2, key: key2, at: at2, domain: pickedNow, surface,
        move: 'unclear',
        // Same contract as every other path: she refused nothing here, and what
        // she read goes out beside it.
        refused: false,
        notes: looked.text || null,
        // Nothing was decided here, so nothing is measured: `null`, not 0.
        confidence: null,
        band: 'unmeasured',
        // One line, because a client that shows one line cannot show both the
        // finding and a question about it, and the question was repeating the
        // finding back.
        ...cardFor(said, [
          { value: 'write', label: 'Write a new answer for that key' },
          { value: 'none', label: 'Leave it — no pair for now' },
        ], { clarify: true }),
      };
    }

    // He answered her card: that answer is the decision, and no decider is billed.
    const decided = askOptions.forced
      ? { move: askOptions.forced, scope: null, route: null, refused: false, cost: 0, model: 'his-answer' }
      : pairSettles
        ? { move: 'unclear', scope: null, route: null, refused: false, cost: 0, model: 'the-stored-pair' }
        : isKey
          ? { move: 'result', scope: null, route: null, refused: false, cost: 0, model: 'the-key' }
        : await ask(text, { ...askOptions, review: seen, domains: choices, commands });
    // Her identification wins when it is a domain he has put in the list.
    const picked = decided.scope && choices.includes(decided.scope) ? decided.scope : choices.includes(domain) ? domain : choices[0];
    const at = clock().toISOString();
    // Which of the three the primary is. It mirrors `picked` exactly, including
    // the case where her scope won over a domain he also named: then the row
    // says `decided`, because `decided` is what the column holds.
    const origin = decided.scope && choices.includes(decided.scope)
      ? (decided.scope === domain ? 'named' : 'decided')
      : choices.includes(domain) ? 'named' : 'default';
    // The row records `picked`; the body is written where the row says it is.
    // One identity, computed once, so `outcome` and `feedback` — which derive
    // their key from this same column — cannot disagree with the writer.
    const key = interactionKey(picked, at);

    // What was intended, kept as evidence about the ask rather than as a fact
    // about him. Nothing written here authorizes anything: authorization is
    // evaluated elsewhere, and a clause is only what the ask looked like.
    const intentWritten = explicitIntent(text, { card: askOptions.forced || null, domain });
    const intentRead = implicitIntent({ idiom, looked, held });
    const intentTaken = interpretedIntent(decided);
    const intentAround = contextFor({ surface, domain, held, card: askOptions.forced || null, repeating: looked.repeating });
    // Read from the record, not from the decider's opinion of itself.
    const measured = confidenceFrom({ looked, move: decided.move, domain: picked, origin });

    let id = null;
    if (db) {
      const result = await db
        .prepare('INSERT INTO decisions (at, domain, asked, decided, correct, corrected_to, idiom, surface, model, cost, ms, confidence, intent_explicit, intent_implicit, intent_interpreted, context, domains, intent_confidence, domain_confidence, evidence_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(at, picked, String(text), decided.move, null, null, idiom.kind, surface, decided.model || null, decided.cost ?? null, decided.ms ?? 0, measured.confidence, intentWritten, intentRead, intentTaken, intentAround, domainSet(picked, origin, decided.scope || null), measured.intent_confidence, measured.domain_confidence, measured.evidence_confidence)
        .run();
      id = rowId(result);
    }

    if (kv) {
      const body = {
        at, domain: picked, surface, asked: text, decided: decided.move, route: decided.route,
        refused: decided.refused, confidence: measured.confidence, band: measured.band,
        confidence_basis: measured.basis, routeConfidence: decided.routeConfidence,
        probabilities: decided.probabilities, routes: decided.routes,
        cost: decided.cost, model: decided.model, ms: decided.ms ?? null, correct: null, id,
        reviewed: looked.count, idiom: idiom.kind, consensus: looked.consensus || null,
      };
      // No expirationTtl: this is a record.
      await kv.put(key, JSON.stringify(body), { metadata: metadataFor(body) });
    }

    await trackedDomain(picked, decided.move, at);

    // She answers; the row is what gets written. No probabilities ride out.
    // What the decider billed rides out; what it thought of him does not.
    const face = SURFACES[askOptions.surface] || null;

    // A stored pair that comes back as a question is not the result: there is a
    // call to make, and it is his.
    if (pairSettles) {
      const noted = `The store holds this for "${clip(text, 80)}", and it asks you back instead of answering:`;
      return {
        id, key, at, domain: picked, surface,
        move: decided.move || null,
        refused: Boolean(decided.refused),
        confidence: measured.confidence,
        band: measured.band,
        confidence_basis: measured.basis,
        notes: looked.text || null,
        ...cardFor(noted, [
          { value: 'use', label: 'Use that stored answer as it stands' },
          { value: 'pair', label: 'Show me the stored pair behind it' },
          { value: 'write', label: 'Write a new answer now' },
        ], {
          // The card asks; what it is asking about rides beside the question, so
          // a one-line reader still shows him the reason he is being asked.
          text: `${noted}\n\n"${clip(held.answer, 240)}"`,
          clarify: true,
        }),
        answer: clip(held.answer, 240),
      };
    }

    // Not understanding is not a guess. She says so, the card asks him, and
    // nothing behind her runs.
    if (face && (decided.move === 'unclear' || decided.refused)) {
      return {
        id, key, at, domain: picked, surface,
        move: decided.move || null,
        // Every path says the same thing about whether he refused and what she
        // read, so a caller never has to test for a key that another path
        // always sets. `undefined` on the two paths that ask him is not "no".
        refused: Boolean(decided.refused),
        // A refusal is billed like any other pass, so the spend and the route go
        // out with it: a "no" that cost something says what it cost.
        cost: decided.cost ?? null,
        route: decided.route ?? null,
        confidence: measured.confidence,
        band: measured.band,
        confidence_basis: measured.basis,
        notes: looked.text || null,
        // Her own "I am not sure" is not one of his options.
        ...cardFor(face.question, surfaceOptions(face, { drop: ['unclear'] }), { clarify: true }),
      };
    }

    // A surface with no menu gets no card, and no invented one: `null` says she
    // has nothing to ask, rather than handing out a guess at what he meant.
    const menu = face ? surfaceOptions(face) : null;

    return {
      id, key, at,
      move: decided.move, domain: picked, surface, route: decided.route, refused: Boolean(decided.refused), cost: decided.cost,
      // Measured from the record, with the counts that produced it.
      confidence: measured.confidence,
      band: measured.band,
      confidence_basis: measured.basis,
      reviewed: looked.count,
      idiom: idiom.kind,
      consensus: looked.consensus || null,
      // Her record goes out with the decision: the model that writes the answer
      // reads the same notes she decided from.
      notes: looked.text || null,
      ...(menu ? cardFor(face.question, menu) : { card: null, question: null, text: null, options: null }),
    };
  }

  /** The domains he has put in KV, by name. Nothing is guessed if it is empty. */
  async function domains() {
    if (!kv) return [];
    try {
      const listed = await kv.list({ prefix: DOMAIN_PREFIX });
      const keys = listed?.keys || [];
      return keys
        .map((entry) => (entry.metadata && entry.metadata.name) || String(entry.name || '').slice(DOMAIN_PREFIX.length))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The list as she tracks it: name, when it was first and last seen, and the moves. */
  async function domainRecords() {
    if (!kv) return [];
    try {
      const listed = await kv.list({ prefix: DOMAIN_PREFIX });
      return (listed?.keys || []).map((entry) => ({
        name: (entry.metadata && entry.metadata.name) || String(entry.name || '').slice(DOMAIN_PREFIX.length),
        seen: (entry.metadata && entry.metadata.seen) || 0,
        last: (entry.metadata && entry.metadata.last) || null,
        moves: (entry.metadata && entry.metadata.moves) || {},
      }));
    } catch {
      return [];
    }
  }

  /** Add a domain to the list. The body and the metadata carry the same record. */
  async function addDomain(name) {
    if (!kv) throw new Error('no KV binding');
    const clean = String(name || '').trim();
    if (!clean) throw new Error('a domain needs a name');
    const key = DOMAIN_PREFIX + slug(clean);
    const at = clock().toISOString();
    const raw = await kv.get(key);
    const body = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { name: clean, first: at, seen: 0, moves: {} };
    body.name = clean;
    body.last = at;
    body.seen = Number(body.seen || 0);
    body.moves = body.moves || {};
    await kv.put(key, JSON.stringify(body), {
      metadata: { name: body.name, seen: body.seen, last: body.last, moves: body.moves },
    });
    return body;
  }

  /** Tracking: the domain she decided in gets a visit and the move she made. */
  async function trackedDomain(name, move, at) {
    if (!kv || !name) return null;
    const key = DOMAIN_PREFIX + slug(name);
    try {
      const raw = await kv.get(key);
      const body = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { name, first: at, seen: 0, moves: {} };
      body.name = name;
      body.last = at;
      body.seen = Number(body.seen || 0) + 1;
      body.moves = body.moves || {};
      if (move) body.moves[move] = (body.moves[move] || 0) + 1;
      await kv.put(key, JSON.stringify(body), {
        metadata: { name: body.name, seen: body.seen, last: body.last, moves: body.moves },
      });
      return body;
    } catch {
      return null;
    }
  }

  /** The product reports what the decision produced, after it produced it. */
  async function outcome({ id, returned = null, stored = null, route = null, origin = null } = {}) {
    if (id == null) throw new Error('outcome needs the row id');
    const what = { returned, stored, route, origin, at: clock().toISOString() };

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

  return { ensure, arrive, outcome, feedback, progress, recent, detail, review, domains, domainRecords, addDomain };
}
