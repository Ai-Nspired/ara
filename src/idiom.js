/**
 * She learns from him, and earns the right to work without asking.
 *
 * Every ask has her move and his. Where they agree, her confidence in working
 * with him goes up; where he corrects her, it goes down. Below the mark she asks.
 * Above it she does not need to, because she has shown she moves the way he does.
 *
 * Store shape: ara:learned:<ask> = { ask, move, agree, disagree, updated }
 */

const KEY = 'ara:learned:';

// Working with him without asking is a claim, so it needs a real record behind
// it: three of his choices, and agreement with at least seven in ten of them.
export const CONSISTENCY = 0.7;
export const MIN_CHOICES = 3;

/** The ask, reduced to the thing that repeats. */
export function normalizeAsk(ask) {
  return String(ask == null ? '' : ask)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!,;:]+$/, '')
    .trim();
}

function ratio(agree, disagree) {
  const total = agree + disagree;
  return total ? Number((agree / total).toFixed(4)) : null;
}

export function createMemory(store, options = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new Error('createMemory needs a store with get and put');
  }
  const target = options.consistency ?? CONSISTENCY;
  const minChoices = options.minChoices ?? MIN_CHOICES;

  async function read(ask) {
    const raw = await store.get(KEY + normalizeAsk(ask));
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  /** What she would do, and how far she has come with him on this ask. */
  async function state(ask) {
    const entry = await read(ask);
    if (!entry) return { ask: normalizeAsk(ask), move: null, agree: 0, disagree: 0, consistency: null, choices: 0, canWork: false };
    const consistency = ratio(entry.agree, entry.disagree);
    const choices = entry.agree + entry.disagree;
    return {
      ask: entry.ask,
      move: entry.move,
      agree: entry.agree,
      disagree: entry.disagree,
      consistency,
      choices,
      // Confidence high enough — and enough of his choices behind it — to work
      // with him without asking first.
      canWork: consistency !== null && consistency >= target && choices >= minChoices,
    };
  }

  /** Her move, if she is confident enough to work without asking. */
  async function recall(ask) {
    const s = await state(ask);
    return s.canWork ? s.move : null;
  }

  /** His choice. Agreement raises her confidence; a correction lowers it. */
  async function remember(ask, move) {
    if (!move) throw new Error('remember needs the move he chose');
    const key = normalizeAsk(ask);
    const entry = await read(key);
    if (!entry) {
      // His first choice is the baseline, not agreement with herself.
      await store.put(KEY + key, JSON.stringify({ ask: key, move, agree: 0, disagree: 0, updated: new Date().toISOString() }));
      return state(key);
    }
    if (entry.move === move) {
      entry.agree += 1;
    } else {
      entry.disagree += 1;
      entry.move = move;
    }
    entry.updated = new Date().toISOString();
    await store.put(KEY + key, JSON.stringify(entry));
    return state(key);
  }

  async function forget(ask) {
    if (typeof store.delete === 'function') await store.delete(KEY + normalizeAsk(ask));
  }

  async function all() {
    if (typeof store.list !== 'function') return [];
    const keys = await store.list(KEY);
    const out = [];
    for (const key of keys) {
      const raw = await store.get(key);
      if (!raw) continue;
      try {
        const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
        out.push({ ...entry, consistency: ratio(entry.agree, entry.disagree) });
      } catch {
        /* a key she cannot read is not a thing she knows */
      }
    }
    return out.sort((a, b) => b.agree + b.disagree - (a.agree + a.disagree));
  }

  return { recall, state, remember, forget, all, target, minChoices };
}

/** A store for tests and for running without a binding. */
export function memoryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async list(prefix = '') {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
