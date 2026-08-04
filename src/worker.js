// ara — pre-inference domain resolution engine
// Principles and logic first. Internet during the loop. LLM as last resort.
// Single file — all domains and utilities inlined for dashboard deployment.
//
// Bindings needed:
//   KV                 — persistent memory + cache
//   BROWSER            — Browser Rendering (remote: false, nodejs_compat)
//   OPENROUTER_API_KEY — secret for LLM fallback
//
// Endpoints:
//   POST /resolve  → { prompt, cards[], system?, model?, max_tokens? }
//   GET  /health   → { status, browser, kv, openrouter, latencyMs }

import puppeteer from "@cloudflare/puppeteer";

const CONFIDENCE_THRESHOLD = 0.6;
const MAX_ITERATIONS = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ═══════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════

async function hashKey(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function webSearch(env, query, maxResults = 5) {
  if (!env.BROWSER) return null;
  try {
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.goto(
        `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { waitUntil: "domcontentloaded", timeout: 8000 }
      );
      const results = await page.evaluate(() => {
        const items = [...document.querySelectorAll(".result__snippet, .result__a")];
        return items.slice(0, 5).map((el) => el.textContent.trim());
      });
      return results.length > 0 ? results.slice(0, maxResults) : null;
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("webSearch error:", e.message);
    return null;
  }
}

async function scrapeUrl(env, url) {
  if (!env.BROWSER) return null;
  try {
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
      const text = await page.evaluate(() => document.body.innerText);
      return text ? text.substring(0, 5000) : null;
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("scrapeUrl error:", e.message);
    return null;
  }
}

async function remember(env, key, value, ttl = 86400) {
  if (!env.KV) return;
  await env.KV.put(key, typeof value === "string" ? value : JSON.stringify(value), {
    expirationTtl: ttl,
  });
}

async function recall(env, key) {
  if (!env.KV) return null;
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function callExternalApi(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}
Part 4 of 5 — ara/src/worker.js (lines 101-330)

// ═══════════════════════════════════════════════════
// DOMAIN: UNIVERSAL — Hermetic principles
// ═══════════════════════════════════════════════════

const PRINCIPLES = [
  { name: "Mentalism", rule: "The universe is mental. Information precedes form. Thought shapes reality.", applies: "Every query starts as thought. What is the mental model behind this question?" },
  { name: "Correspondence", rule: "As above, so below. As within, so without.", applies: "Patterns at one scale reflect patterns at another. Does the macro mirror the micro here?" },
  { name: "Vibration", rule: "Nothing rests. Everything moves. Change is the only constant.", applies: "What is changing? What is the rate of change? What is the frequency?" },
  { name: "Polarity", rule: "Everything has its pair of opposites. Opposites differ only in degree.", applies: "What are the poles? Where on the spectrum does this sit? What is the tension between them?" },
  { name: "Rhythm", rule: "Everything flows in and out. The pendulum swings both ways.", applies: "What cycle is this part of? Where are we in the swing? What comes next?" },
  { name: "Cause and Effect", rule: "Every cause has its effect. Nothing happens by chance.", applies: "What caused this? What will this cause? Trace the chain." },
  { name: "Gender", rule: "Everything has masculine and feminine principles. Creation requires both.", applies: "What creates vs. what sustains? What is the active vs. receptive force?" },
  { name: "Conservation", rule: "Energy, matter, and information are never destroyed, only transformed.", applies: "What is being transformed? What form did this take before? What form will it take next?" },
];

async function domainUniversal({ query, env }) {
  const lens = PRINCIPLES.map((p) => `${p.name}: ${p.rule}\n  → ${p.applies}`).join("\n\n");

  let memory = null;
  if (env.KV) {
    memory = await recall(env, "universal:" + query.toLowerCase().substring(0, 100));
  }

  return {
    confidence: 0.2,
    found: true,
    source: "hermetic",
    result: lens + (memory ? `\n\nMemory: ${JSON.stringify(memory)}` : ""),
    note: memory ? "Hermetic principles applied with recalled memory" : "Hermetic principles applied as foundational lens",
  };
}

// ═══════════════════════════════════════════════════
// DOMAIN: ETHICAL — do no harm, compassion is real power
// ═══════════════════════════════════════════════════

async function domainEthical({ query }) {
  const harmPatterns = [
    /how to (make|build|create|synthesi[sz]e).*(bomb|weapon|poison|explosive|chemical.agent)/i,
    /how to (harm|hurt|kill|injure|poison|maim).*(person|human|people|child|animal)/i,
    /generate (malware|virus|ransomware|trojan|exploit)/i,
    /how to (stalk|abduct|kidnap|traffick|exploit).*(person|child|woman|minor)/i,
    /how to (hack|breach|penetrate).*(system|network|database|account).*(for|to|into)/i,
  ];

  for (const pattern of harmPatterns) {
    if (pattern.test(query)) {
      return {
        confidence: 1.0,
        found: true,
        source: "ethical",
        result: "BLOCKED: Do no harm to humans. Compassion is real power.",
        note: "Ethical guardrail — harm pattern detected, pipeline halted",
      };
    }
  }

  const compassionKeywords = /\b(help|care|protect|support|heal|wellbeing|welfare|safety|vulnerab|suffer|pain|relief|comfort)\b/i;

  if (compassionKeywords.test(query)) {
    return {
      confidence: 0.3,
      found: true,
      source: "ethical",
      result: "This query involves human welfare. Approach with compassion. Consider who is affected and how. Real power is the ability to help without harm.",
      note: "Ethical lens — compassion dimension identified",
    };
  }

  return {
    confidence: 0.2,
    found: true,
    source: "ethical",
    result: "Do no harm. Compassion is real power. No harm indicators detected.",
    note: "Ethical lens applied — clear",
  };
}

// ═══════════════════════════════════════════════════
// DOMAIN: MACRO — broad view, the 30,000 foot view
// ═══════════════════════════════════════════════════

async function domainMacro({ query, env, trail }) {
  const universalEntry = trail.find((t) => t.domain === "universal");
  const principles = universalEntry?.result || "";

  const iteration = trail.filter((t) => t.domain === "macro").length + 1;

  let webContext = null;
  if (env.BROWSER && iteration === 1) {
    webContext = await webSearch(env, query, 5);
  }

  let memory = null;
  if (env.KV) {
    memory = await recall(env, "macro:" + query.toLowerCase().substring(0, 100));
  }

  if (env.KV && webContext && !memory) {
    await remember(env, "macro:" + query.toLowerCase().substring(0, 100), webContext, 86400);
  }

  const broadView = {
    question: query,
    bigPicture: "Step back. What is the systemic context? What forces are at play?",
    principles,
    webContext,
    memory,
  };

  let confidence = 0.2;
  if (webContext) confidence += 0.15;
  if (memory) confidence += 0.1;

  return {
    confidence,
    found: true,
    source: "macro",
    result: JSON.stringify(broadView),
    note: `Macro iter ${iteration} — ${webContext ? "with web" : "no web"} ${memory ? "with memory" : "no memory"}`,
  };
}

// ═══════════════════════════════════════════════════
// DOMAIN: MICRO — close-up view, the details
// ═══════════════════════════════════════════════════

async function domainMicro({ query, env, trail }) {
  const macroEntry = trail.find((t) => t.domain === "macro");
  let broadView = null;
  try {
    if (macroEntry?.result) broadView = JSON.parse(macroEntry.result);
  } catch {}

  const iteration = trail.filter((t) => t.domain === "micro").length + 1;

  let webDetail = null;
  if (env.BROWSER && iteration === 1) {
    webDetail = await webSearch(env, `${query} specifics details`, 3);
  }

  let cachedFact = null;
  if (env.KV) {
    cachedFact = await recall(env, "fact:" + query.toLowerCase().substring(0, 200));
  }

  if (env.KV && webDetail && !cachedFact) {
    await remember(env, "fact:" + query.toLowerCase().substring(0, 200), webDetail, 86400);
  }

  const closeUp = {
    question: query,
    specifics: "What exactly is being asked? What are the precise details?",
    broadContext: broadView?.bigPicture,
    webDetail,
    cachedFact,
  };

  let confidence = 0.2;
  if (cachedFact) confidence += 0.25;
  if (webDetail) confidence += 0.15;

  return {
    confidence,
    found: true,
    source: "micro",
    result: JSON.stringify(closeUp),
    note: `Micro iter ${iteration} — ${cachedFact ? "with cached fact" : "no cache"} ${webDetail ? "with web" : "no web"}`,
  };
}

// ═══════════════════════════════════════════════════
// DOMAIN: DOMAIN-SPECIFIC — the actual field of knowledge
// ═══════════════════════════════════════════════════

async function domainSpecific({ query, env, trail }) {
  const macroEntry = trail.find((t) => t.domain === "macro");
  const microEntry = trail.find((t) => t.domain === "micro");
  const universalEntry = trail.find((t) => t.domain === "universal");

  let broadView = null;
  let closeUp = null;
  try { if (macroEntry?.result) broadView = JSON.parse(macroEntry.result); } catch {}
  try { if (microEntry?.result) closeUp = JSON.parse(microEntry.result); } catch {}

  const principles = universalEntry?.result || "";

  const iteration = trail.filter((t) => t.domain === "domain-specific").length + 1;

  let domainWeb = null;
  if (env.BROWSER && iteration === 1) {
    domainWeb = await webSearch(env, query, 5);
  }

  let memory = null;
  if (env.KV) {
    memory = await recall(env, "domain:" + query.toLowerCase().substring(0, 100));
  }

  if (env.KV && domainWeb && !memory) {
    await remember(env, "domain:" + query.toLowerCase().substring(0, 100), domainWeb, 86400);
  }

  const analysis = {
    question: query,
    broadView: broadView?.bigPicture,
    closeUp: closeUp?.specifics,
    principles,
    domainWeb,
    memory,
    cachedFact: closeUp?.cachedFact,
    domainQuestions: [
      "What expertise is needed to answer this?",
      "What are the known facts in this domain?",
      "What are the open questions?",
      "What would an expert ask next?",
    ],
  };

  let confidence = 0.2;
  if (domainWeb) confidence += 0.15;
  if (memory) confidence += 0.1;
  if (closeUp?.cachedFact) confidence += 0.15;

  return {
    confidence,
    found: true,
    source: "domain-specific",
    result: JSON.stringify(analysis),
    note: `Domain-specific iter ${iteration} — ${domainWeb ? "with web" : "no web"} ${memory ? "with memory" : "no memory"}`,
  };
}
Part 5 of 5 — ara/src/worker.js (lines 331-end)

// ═══════════════════════════════════════════════════
// EVIDENCE ASSESSMENT & SYNTHESIS
// ═══════════════════════════════════════════════════

function assessEvidence(trail) {
  const domainEntries = trail.filter((t) => t.found);
  if (domainEntries.length === 0) return { canSynthesize: false, evidenceScore: 0 };

  let hasWeb = false;
  let hasMemory = false;
  let hasPrinciples = false;
  let hasFacts = false;
  let totalConfidence = 0;

  for (const entry of domainEntries) {
    totalConfidence += entry.confidence;
    if (entry.source === "hermetic") hasPrinciples = true;
    if (entry.note?.includes("web")) hasWeb = true;
    if (entry.note?.includes("memory")) hasMemory = true;
    if (entry.note?.includes("cached fact") || entry.note?.includes("cache")) hasFacts = true;
  }

  const avgConfidence = totalConfidence / domainEntries.length;
  const sourceCount = [hasWeb, hasMemory, hasPrinciples, hasFacts].filter(Boolean).length;

  const canSynthesize =
    (avgConfidence >= 0.35 && sourceCount >= 2) ||
    domainEntries.some((t) => t.confidence >= CONFIDENCE_THRESHOLD);

  return { canSynthesize, evidenceScore: avgConfidence * (sourceCount / 4), avgConfidence, sourceCount };
}

function synthesizeFromDomains(query, trail) {
  const universal = trail.filter((t) => t.domain === "universal").pop();
  const ethical = trail.filter((t) => t.domain === "ethical").pop();
  const macro = trail.filter((t) => t.domain === "macro").pop();
  const micro = trail.filter((t) => t.domain === "micro").pop();
  const specific = trail.filter((t) => t.domain === "domain-specific").pop();

  const webFindings = [];
  for (const entry of trail) {
    if (entry.result) {
      try {
        const parsed = JSON.parse(entry.result);
        if (parsed.webContext) webFindings.push(...(Array.isArray(parsed.webContext) ? parsed.webContext : [parsed.webContext]));
        if (parsed.webDetail) webFindings.push(...(Array.isArray(parsed.webDetail) ? parsed.webDetail : [parsed.webDetail]));
        if (parsed.domainWeb) webFindings.push(...(Array.isArray(parsed.domainWeb) ? parsed.domainWeb : [parsed.domainWeb]));
      } catch {}
    }
  }

  let cachedFact = null;
  for (const entry of trail) {
    if (entry.result) {
      try {
        const parsed = JSON.parse(entry.result);
        if (parsed.cachedFact) { cachedFact = parsed.cachedFact; break; }
      } catch {}
    }
  }

  if (cachedFact) {
    return {
      canResolve: true,
      resolved_by: "domains",
      response: buildResponse(query, { principles: universal?.result, ethical: ethical?.result, macro: macro?.result, micro: micro?.result, specific: specific?.result, web: [...new Set(webFindings)], cachedFact }),
    };
  }

  if (webFindings.length >= 2) {
    return {
      canResolve: true,
      resolved_by: "domains",
      response: buildResponse(query, { principles: universal?.result, ethical: ethical?.result, macro: macro?.result, micro: micro?.result, specific: specific?.result, web: [...new Set(webFindings)], cachedFact: null }),
    };
  }

  return { canResolve: false, resolved_by: "none", response: null };
}

function buildResponse(query, findings) {
  const sections = [];
  sections.push(`Query: ${query}\n`);

  if (findings.cachedFact) {
    sections.push(`Known fact:\n${findings.cachedFact}`);
  }

  if (findings.web && findings.web.length > 0) {
    sections.push(`Web research:\n${findings.web.slice(0, 5).join("\n")}`);
  }

  if (findings.principles) {
    const principles = findings.principles.split("\n\n").slice(0, 4).join("\n");
    sections.push(`Relevant principles:\n${principles}`);
  }

  if (findings.specific) {
    try {
      const parsed = JSON.parse(findings.specific);
      if (parsed.domainQuestions) {
        sections.push(`Domain questions:\n${parsed.domainQuestions.map((q) => `• ${q}`).join("\n")}`);
      }
    } catch {}
  }

  return sections.join("\n---\n");
}

// ═══════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return handleHealth(env);
    }

    if (url.pathname === "/resolve" && request.method === "POST") {
      return handleResolve(request, env);
    }

    return new Response("ara", { headers: { "Content-Type": "text/plain" } });
  },
};

async function handleHealth(env) {
  const start = Date.now();
  const status = {
    status: "ok",
    browser: !!env.BROWSER,
    kv: !!env.KV,
    openrouter: !!env.OPENROUTER_API_KEY,
    latencyMs: 0,
  };
  status.latencyMs = Date.now() - start;
  return new Response(JSON.stringify(status), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function handleResolve(request, env) {
  const body = await request.json();
  const query = body.prompt || "";
  const contextCards = Array.isArray(body.cards) ? body.cards : [];
  const systemPrompt = body.system || "";
  const model = body.model || "inclusionai/ling-2.6-flash";
  const maxTokens = body.max_tokens || 2000;

  if (!query) return json({ error: "No prompt provided" }, 400);

  const cacheKey = await hashKey(query + JSON.stringify(contextCards));
  if (env.KV) {
    const cached = await env.KV.get(cacheKey);
    if (cached) {
      const entry = JSON.parse(cached);
      return json({ response: entry.response, trail: entry.trail, cached: true });
    }
  }

  const trail = [];
  let blocked = false;

  const domains = [
    { name: "universal", fn: domainUniversal },
    { name: "ethical", fn: domainEthical },
    { name: "macro", fn: domainMacro },
    { name: "micro", fn: domainMicro },
    { name: "domain-specific", fn: domainSpecific },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    for (const domain of domains) {
      const result = await domain.fn({ query, context: contextCards, env, trail });

      trail.push({
        iteration: iteration + 1,
        domain: domain.name,
        confidence: result.confidence,
        found: result.found,
        source: result.source,
        result: result.result,
        note: result.note,
      });

      if (domain.name === "ethical" && result.found && result.confidence >= 1.0) {
        blocked = true;
        break;
      }
    }

    if (blocked) break;

    const evidence = assessEvidence(trail);
    if (evidence.canSynthesize) break;
  }

  if (blocked) {
    const ethicalResult = trail.find((t) => t.domain === "ethical" && t.confidence >= 1.0);
    const response = ethicalResult?.result || "BLOCKED";
    return json({ response, trail, cached: false, resolved_by: "ethical" });
  }

  const synthesis = synthesizeFromDomains(query, trail);

  let response = synthesis.response;
  let resolvedBy = synthesis.resolved_by;

  if (!synthesis.canResolve) {
    const domainContext = trail
      .filter((t) => t.found && t.result)
      .map((t) => `[${t.domain} iter ${t.iteration}] (${Math.round(t.confidence * 100)}%): ${t.result}`)
      .join("\n");

    let fullPrompt = query;
    if (domainContext) fullPrompt += "\n\nDomain findings:\n" + domainContext;

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: fullPrompt });

    try {
      const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://ai.nspired.cc",
          "X-Title": "ara",
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      });

      if (!orRes.ok) throw new Error(`OpenRouter ${orRes.status}`);

      const orData = await orRes.json();
      response = orData.choices?.[0]?.message?.content || "(no response)";
      resolvedBy = "llm";

      trail.push({
        iteration: null,
        domain: "llm",
        confidence: 0.75,
        found: true,
        source: "openrouter",
        result: response,
        note: "LLM fallback — domains could not resolve",
      });
    } catch (e) {
      trail.push({
        iteration: null,
        domain: "llm",
        confidence: 0,
        found: false,
        source: "openrouter",
        result: null,
        note: e.message,
      });
      response = synthesis.response;
      resolvedBy = "domains-degraded";
    }
  }

  if (env.KV && response) {
    await env.KV.put(cacheKey, JSON.stringify({ response, trail }), {
      expirationTtl: 3600,
    });
  }

  return json({ response, trail, cached: false, resolved_by: resolvedBy });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
