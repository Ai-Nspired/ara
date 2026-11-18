# AGENTS.md — ARA

**ARA is the resolution layer** in front of cods, mind, TEW, the forms, the
templates and truth. A request arrives, ARA decides what to do with it and says how
sure it is. It is not a chatbot and it is not a second truth engine.

Verified against the deployment and this repo on **2026-11-15**. Anything not
verified says so. Do not upgrade an assumption to a fact without re-checking it.

---

## 1. The repo is three files

```
src/worker.js     the whole Worker
wrangler.jsonc    config
package.json      wrangler as the only dependency
```

There is no build step and no framework. `npx wrangler deploy` is the deploy.

---

## 2. Bindings

| Binding | Type | Value | Notes |
|---|---|---|---|
| `KV` | KV | `4a9bfbffb4d440cba86badc508e2045a` | **Memoria** — legacy memory, shared with mind's `MEM` and truth's `PROV_TRUTH` |
| `MASTER_TRUTHS` | KV | `904eff3af4c14f06964e4f651cce9573` | master truth records, no TTL — the same namespace as mind's `MASTER` and the truth worker's `MASTER_TRUTHS` |
| `DB` | D1 | `248766b1-d102-4e9e-a228-a19281ed5fe6` | the journal (`decisions`) |
| `R2` | R2 | `speakeasy-files` | bulk: documents, long text, captures |
| `BROWSER` | Browser Rendering | — | pages a Worker's `fetch` cannot reach |
| `CODS` | service | worker `cods`, production | declared; no route reaches it yet |
| `MIND` | service | worker `mind`, production | declared; no route reaches it yet |
| `OPENROUTER_API_KEY` | secret | — | paid deciders only; never a `:free` slug |

`wrangler.jsonc` declares every binding in this table. The secret does not live in
it.

**`AI_SEARCH` is not wanted.** It was removed deliberately. Do not add it back.

---

## 3. The owner's rules — these override anything else here

- **Memoria is ours, and she curates it.** `KV` is not off limits and it is not just
  a cache. Read it; help curate it. Never reorganise or split it silently.
- **Cache expires; records do not.** A decision, a candidate, a note or anything a
  person will later ingest, promote or correct gets **no TTL, or a day at minimum —
  never `expirationTtl: 3600`**. Candidates that expired in an hour could never be
  promoted to master truth. That is the fault this rule exists to prevent.
- **Paid deciders only. Never a `:free` slug** — the price of free is that they get
  to look at our data. Ladder: `pplx-decider-flash-v1.2` ($0.01/M, one question) →
  `pplx-decider-v1.2` ($0.02/M, several questions over one state) →
  `scaledown/classify-1` ($0.04/M, documents and 1M ctx).
- **A decision model writes nothing.** It answers presented questions. It never
  composes a question, never writes prose, never writes the table. Rows are written
  by the workflow from the interaction: **what was asked, what was decided, whether
  that was correct.**
- **The question is never hers.** She cannot reframe what she is graded on; that is
  what keeps her from swaying her own answer.
- **Microsites** are reached without any preset or proxy switch turned on.
- **No new Worker.** He already runs 58. Add to this one or fix this one.
- **Stop means stop.** When he says stop, the turn ends there — no summary, no
  apology paragraph, no follow-up question.
- **"You're missing something" means ask, not guess.** Ask what it is, in one line,
  and wait. Two guesses in a row is already too many.
- **Check in before changing a file.** Name the file, what changes, why. One check-in
  per change; a "yes" covers that change only. Reading is always fine. When he says
  **update** a document, that is the go-ahead for that document: write in what he
  said and **delete any language in it that contradicts him.**

---

## 4. Access — use it before asking

**GitHub.** `GITHUB_PAT` is in the environment. Clone and push with an askpass helper so
the token never appears in a URL. The helper must answer **one** prompt — printing the
username and the token together makes git send the username as the password, and GitHub
answers `Invalid username or token`, which looks exactly like a dead token:

```sh
#!/bin/sh
case "$1" in
  *sername*) echo "x-access-token" ;;
  *) echo "$GITHUB_PAT" ;;
esac
```

`GIT_ASKPASS=/tmp/askpass.sh git push origin HEAD:main`. Identity inside the repo:
`dno-luigi <dno@ai-n.org>`. Recreate the helper when needed — `/tmp` does not survive.
Test a token without git: `curl -s -o /dev/null -w '%{http_code}' -H
"Authorization: Bearer $GITHUB_PAT" https://api.github.com/user` — 200 means it is alive.

**Cloudflare.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ID` are in the environment, so
`wrangler` works with no login: `deploy`, `deployments`, `tail`, KV / D1 / R2.
Never run `wrangler login`. Never print or write the token — not into a file, a
command line, a commit message or chat.

---

## 5. What is actually deployed (2026-11-15)

`https://ara.ai-n.workers.dev`

| Route | Behaviour |
|---|---|
| `GET /health` | `{"status":"ok","kv":true,"latencyMs":0}` |
| `POST /resolve` | `{prompt}` → `{response, trail_summary, cached, resolved_by}` |
| anything else | 200 `ara-engine-active` — should be a 404 |

Known faults to fix, in this order:

1. Records were written with a one-hour TTL; anything written there is gone before it
   can be ingested or promoted. **Fixed in `src/worker.js` on 2026-11-15** — both
   cache writes are now 86,400 s. The cache itself may stay short; records may not.
2. `webSearch()` parses the wrong markup and returns no findings; `webKey`
   interpolates a promise instead of awaiting it.
3. Confidence is `0.2 + 0.15 × loop` — a retry counter wearing a probability's
   clothes. It must come from records, not from how many times it tried.
4. The catch-all answers 200, so a broken route looks alive.
5. `/health` reports `latencyMs: 0` unconditionally.

---

## 6. The journal (built, not yet wired)

`ara/schema.sql` and `ara/journal.js` in `Ai-Nspired/tew` define the record this
Worker should write:

- D1 `decisions(id, at, domain, asked, decided, correct, corrected_to)`
- KV `int:<domain>:<at>` — the interaction body, with metadata (`asked`, `decided`,
  `correct`, `result`) beside it, so the history scans without reading bodies
- KV `note:<domain>:<slug>` — notes with no TTL, hand-writable from a card
- `judge()` — the owner's verdict is the only value that comes from outside her

When it is wired, **no write may pass `expirationTtl`.**

---

## 7. Rules about the account (given, not inferred)

- Do not design or wire anything you were not told to wire. If you do not understand how the
  parts fit, ask — do not propose a design for a system you do not understand.
- TEW is the truth engine workstation: it reads truths, queries and audits as the engine makes
  them. Nothing is wired into it for ARA. TEP is in use; do not invent a connection into it.
- ARA decides in front of the tools actually in use: the cards workstation and the truth engine.
