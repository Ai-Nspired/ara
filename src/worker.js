// ara — pre-inference domain resolution engine
// Principles + web fetching in 3 loops. No LLM. Streamed output.
// Updated: Rigorous analytical framing (replaces esoteric lenses).
//
// Bindings:
//   KV — persistent cache
//
// Endpoints:
//   POST /resolve            → JSON: { response, trail, resolved_by, cached }
//   POST /resolve?stream=1  → SSE stream
//   GET  /health            → { status, kv, latencyMs }

const MAX_LOOPS = 3;
const CONFIDENCE_THRESHOLD = 0.55;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ═══════════════════════════════════════════════════
// ANALYTICAL LENSES — rigorous frameworks applied to web findings
// ═══════════════════════════════════════════════════

const ANALYTICAL_LENSES = [
  { name: "Empirical Grounding",   rule: "What verifiable data or direct evidence supports this?" },
  { name: "Causal Mechanism",      rule: "What is the precise chain of cause and effect?" },
  { name: "Systemic Constraints",  rule: "What structural boundaries, limits, or bottlenecks apply?" },
  { name: "Historical Precedent",  rule: "How have analogous scenarios manifested in the past?" },
  { name: "Statistical Baseline",  rule: "What is the quantitative likelihood or frequency of this outcome?" },
  { name: "Adversarial Stress",    rule: "What counter-arguments, failure modes, or edge cases exist?" },
  { name: "Resource Trade-offs",   rule: "What costs, energy expenditures, or opportunity losses are incurred?" },
  { name: "Second-Order Effects",  rule: "What downstream or delayed consequences follow this state?" },
];

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

async function hashKey(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function webSearch(query, maxResults = 3) {
  try {
    const res = await fetch(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const snippets = [];
    let match;
    const regex = /<td[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/td>/g;
    while ((match = regex.exec(html)) !== null && snippets.length < maxResults) {
      const text = match[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 20) snippets.push(text.substring(0, 300));
    }
    if (snippets.length === 0) {
      const regex2 = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
      while ((match = regex2.exec(html)) !== null && snippets.length < maxResults) {
        const text = match[1].replace(/<[^>]+>/g, "").trim();
        if (text.length > 10) snippets.push(text.substring(0, 300));
      }
    }
    return snippets;
  } catch {
    return [];
  }
}

function applyAnalyticalLenses(query, findings) {
  const lines = [];
  for (const l of ANALYTICAL_LENSES) {
    let best = null;
    for (const f of findings) {
      if (f.toLowerCase().includes(l.name.toLowerCase().split(" ")[0])) {
        best = f;
        break;
      }
    }
    if (!best && findings.length > 0) best = findings[0];
    if (best) {
      lines.push(`${l.name}: ${l.rule} → ${best.substring(0, 150)}`);
    } else {
      lines.push(`${l.name}: ${l.rule}`);
    }
  }
  return lines.join("\n");
}

function synthesize(query, allFindings, trail) {
  const unique = [...new Set(allFindings)].slice(0, 5);
  const lensAnalysis = applyAnalyticalLenses(query, unique);

  const sections = [];
  sections.push(`Query: ${query}`);
  if (unique.length > 0) {
    sections.push("Empirical Findings:");
    for (const f of unique) sections.push(`  • ${f.substring(0, 200)}`);
  }
  sections.push("");
  sections.push("Analytical Breakdown:");
  sections.push(lensAnalysis);

  return sections.join("\n");
}

function summarizeTrail(trail) {
  return trail.map((t) => ({
    loop: t.loop,
    web: t.webCount,
    conf: Math.round(t.confidence * 100) + "%",
  }));
}

// ═══════════════════════════════════════════════════
// ETHICAL GUARDRAIL
// ═══════════════════════════════════════════════════

function checkEthics(query) {
  const harmPatterns = [
    /how to (make|build|create|synthesi[sz]e).*(bomb|weapon|poison|explosive|chemical.agent)/i,
    /how to (harm|hurt|kill|injure|poison|maim).*(person|human|people|child|animal)/i,
    /generate (malware|virus|ransomware|trojan|exploit)/i,
    /how to (stalk|abduct|kidnap|traffick|exploit).*(person|child|woman|minor)/i,
  ];
  for (const pattern of harmPatterns) {
    if (pattern.test(query)) return { blocked: true, reason: "Prohibited content vector: potential harm." };
  }
  return { blocked: false };
}

// ═══════════════════════════════════════════════════
// MAIN RESOLUTION LOOP
// ═══════════════════════════════════════════════════

async function resolve(query, env) {
  const trail = [];
  const allFindings = [];
  let confidence = 0;

  // KV cache check
  const cacheKey = await hashKey(query);
  if (env.KV) {
    const cached = await env.KV.get(cacheKey);
    if (cached) {
      const entry = JSON.parse(cached);
      return { response: entry.response, trail: entry.trail, resolvedBy: "cache", cached: true };
    }
  }

  // Ethical guardrail
  const ethics = checkEthics(query);
  if (ethics.blocked) {
    const response = `BLOCKED: ${ethics.reason}`;
    const trailSummary = [{ loop: 0, web: 0, conf: "100%" }];
    if (env.KV) await env.KV.put(cacheKey, JSON.stringify({ response, trail: trailSummary, resolvedBy: "ethical" }), { expirationTtl: 3600 });
    return { response, trail: trailSummary, resolvedBy: "ethical", cached: false };
  }

  // 3 loops: web fetch → analytical lens evaluation → confidence assessment
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    let searchQuery = query;
    if (loop === 1) searchQuery = `${query} data analysis verification`;
    if (loop === 2) searchQuery = `${query} technical specifications constraints`;

    const findings = await webSearch(searchQuery, 3);
    allFindings.push(...findings);

    if (env.KV && findings.length > 0) {
      const webKey = `web:${loop}:${hashKey(searchQuery)}`;
      await env.KV.put(webKey, JSON.stringify(findings), { expirationTtl: 86400 });
    }

    let loopConfidence = 0.2;
    if (findings.length > 0) loopConfidence += 0.15 * (loop + 1);
    const uniqueCount = new Set(allFindings).size;
    if (uniqueCount >= 3) loopConfidence += 0.1;
    confidence = Math.max(confidence, loopConfidence);

    trail.push({ loop: loop + 1, webCount: findings.length, confidence: loopConfidence });

    if (confidence >= CONFIDENCE_THRESHOLD && allFindings.length >= 3) break;
  }

  const response = synthesize(query, allFindings, trail);
  const resolvedBy = allFindings.length > 0 ? "analytical_lenses+web" : "analytical_lenses";

  if (env.KV) {
    await env.KV.put(cacheKey, JSON.stringify({ response, trail, resolvedBy }), { expirationTtl: 3600 });
  }

  return { response, trail, resolvedBy, cached: false };
}

// ═══════════════════════════════════════════════════
// STREAMING
// ═══════════════════════════════════════════════════

function streamResponse(text, trailSummary, cached, resolvedBy) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ trail_summary: trailSummary, cached, resolved_by: resolvedBy, done: false });
      const words = text.split(/(\s+)/);
      let i = 0;
      const chunkSize = 3;
      const interval = setInterval(() => {
        if (i >= words.length) {
          clearInterval(interval);
          send({ done: true });
          controller.close();
          return;
        }
        const chunk = words.slice(i, i + chunkSize).join("");
        send({ token: chunk, done: false });
        i += chunkSize;
      }, 30);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...corsHeaders },
  });
}

// ═══════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (url.pathname === "/health" && request.method === "GET") return handleHealth(env);
    if (url.pathname === "/resolve" && request.method === "POST") {
      return handleResolve(request, env, url.searchParams.get("stream") === "1");
    }
    return new Response("ara-engine-active", { headers: { "Content-Type": "text/plain" } });
  },
};

function handleHealth(env) {
  const start = Date.now();
  const status = { status: "ok", kv: !!env.KV, latencyMs: Date.now() - start };
  return new Response(JSON.stringify(status), { headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function handleResolve(request, env, isStream) {
  const body = await request.json();
  const query = body.prompt || "";
  if (!query) return json({ error: "No prompt provided" }, 400);

  const { response, trail, resolvedBy, cached } = await resolve(query, env);
  const trailSummary = summarizeTrail(trail);

  if (isStream) {
    return streamResponse(response, trailSummary, cached, resolvedBy);
  }
  return json({ response, trail_summary: trailSummary, cached, resolved_by: resolvedBy });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
      }
    
