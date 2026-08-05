// ara — pre-inference domain resolution engine
// Principles + web fetching in 3 loops. No LLM. Streamed output.
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
// PRINCIPLES — hermetic lenses applied to web findings
// ═══════════════════════════════════════════════════

const PRINCIPLES = [
  { name: "Mentalism",      rule: "Information precedes form. What's the core idea?" },
  { name: "Correspondence",  rule: "As above, so below. What pattern mirrors this elsewhere?" },
  { name: "Vibration",       rule: "Nothing rests. What's changing or in motion here?" },
  { name: "Polarity",        rule: "Opposites differ only in degree. What's the tension?" },
  { name: "Rhythm",          rule: "Everything flows in cycles. Where in the cycle is this?" },
  { name: "Cause/Effect",    rule: "Nothing happens by chance. What caused this?" },
  { name: "Gender",          rule: "Creation requires dual principles. What forces combine here?" },
  { name: "Conservation",    rule: "Nothing is lost, only transformed. What form did this take before?" },
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

function applyPrinciples(query, findings) {
  const lines = [];
  for (const p of PRINCIPLES) {
    let best = null;
    for (const f of findings) {
      if (f.toLowerCase().includes(p.name.toLowerCase().split("/")[0])) {
        best = f;
        break;
      }
    }
    if (!best && findings.length > 0) best = findings[0];
    if (best) {
      lines.push(`${p.name}: ${p.rule} → ${best.substring(0, 150)}`);
    } else {
      lines.push(`${p.name}: ${p.rule}`);
    }
  }
  return lines.join("\n");
}

function synthesize(query, allFindings, trail) {
  const unique = [...new Set(allFindings)].slice(0, 5);
  const principleAnalysis = applyPrinciples(query, unique);

  const sections = [];
  sections.push(query);
  if (unique.length > 0) {
    sections.push("Findings:");
    for (const f of unique) sections.push(`  • ${f.substring(0, 200)}`);
  }
  sections.push("");
  sections.push("Principles:");
  sections.push(principleAnalysis);

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
    if (pattern.test(query)) return { blocked: true, reason: "Do no harm to humans." };
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

  // 3 loops: web fetch → principle analysis → confidence assessment
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    let searchQuery = query;
    if (loop === 1) searchQuery = `${query} explained`;
    if (loop === 2) searchQuery = `${query} details facts`;

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
  const resolvedBy = allFindings.length > 0 ? "principles+web" : "principles";

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
    return new Response("ara", { headers: { "Content-Type": "text/plain" } });
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