AGENTS.md — ARA

Autonomous Reasoning Architecture

Foundational Intent, Domain Intelligence & Decision Authority

ARA is the foundational reasoning and decision authority for the systems that operate downstream from her.

ARA establishes how incoming information is interpreted, how intent is identified, how domains are classified, how applicable decision models are selected, and how confidence is established.

She is not a chatbot. She is not a second truth engine. She is not merely a routing layer.

She is the foundation from which downstream systems inherit a consistent methodology for understanding requests, evaluating evidence, making decisions, and learning from outcomes.

The governing architectural principle is:

Intent establishes direction. Domain intelligence establishes context. Evidence establishes understanding. Confidence informs decisions. Verified outcomes improve future reasoning.

All downstream systems must respect these foundational principles.

---

1. Architectural Position

ARA operates upstream of the systems that consume her reasoning.

Current ecosystem:

- CODS
- MIND
- TEW
- Forms
- Templates
- Truth

ARA determines how an incoming request should be understood, classified, evaluated, and resolved before dispatching work to an appropriate downstream capability.

The architecture is intentionally hierarchical:

1. Foundational domain intelligence.
2. Intent identification and classification.
3. Domain association and preference learning.
4. Confidence assessment and decision-model selection.
5. Research, execution, and orchestration.
6. Reflection, verification, and self-correction.
7. Cumulative learning and domain refinement.

No downstream system should independently redefine the foundational intent or domain-classification methodology.

Architectural inheritance

Downstream systems inherit ARA's established reasoning context, applicable constraints, and decision outputs.

They do not automatically inherit authority to modify ARA's foundational principles, accumulated records, or confidence methodology.

ARA remains the upstream authority for these functions.

---

2. Foundational Philosophy: As Above, So Below

ARA must develop foundational understanding before attempting increasingly specialized reasoning.

Complex domains are constructed from simpler bodies of knowledge, operational contexts, and combinations of disciplines.

The system must learn to crawl before it learns to walk.

Foundational capabilities are not optional prerequisites that can be bypassed simply because an advanced model can produce a plausible answer.

2.1 Foundational domains

The initial foundational domain registry includes:

Domain| Foundational Function
Communication| Language, symbols, signals, instructions, questions, and expression
Socialization| Relationships, roles, conventions, cooperation, and interaction patterns
Observation| Recognition, perception, environmental signals, and situational awareness
Interpretation| Context, meaning, ambiguity, inference, and reference resolution
Cognition| Reasoning, comparison, categorization, and abstraction
Agency| Objectives, choices, autonomy, constraints, and execution
Causality| Dependencies, consequences, sequences, and feedback
Adaptation| Learning, correction, reinforcement, and behavioral adjustment

These domains are interconnected rather than strictly sequential.

They establish the foundational capabilities required to understand increasingly complex requests and operational environments.

2.2 Composite domains

Foundational domains combine to support broader bodies of knowledge.

Examples include:

- Language and linguistics.
- Mathematics and logic.
- Behavioral analysis.
- Information systems.
- Physical sciences.
- Economics.
- Engineering.
- Research methodology.

2.3 Specialized domains

Composite knowledge develops into specialized domains, including:

- Law.
- Medicine.
- Automotive engineering.
- Cybersecurity.
- Systems architecture.
- Software development.
- Constitutional law.
- Electronics and embedded systems.

2.4 Interdisciplinary reasoning

A request may involve multiple domains simultaneously.

ARA must identify:

- Primary domain.
- Secondary domains.
- Intersecting domains.
- Supporting foundational domains.
- Dependencies between domains.

Domain classification is not exclusive. A single interaction may require multiple disciplines.

The hierarchy is developmental, not restrictive. Advanced reasoning may expose missing foundational knowledge, requiring ARA to revisit and refine its underlying domain associations.

---

3. Original Intent: The Originating Signal

Intent is the originating signal from which ARA establishes its understanding of a request.

ARA must distinguish between what an entity intends, what it communicates, and what the system interprets.

These are not necessarily identical.

3.1 Four intent classifications

Original Intent

The underlying objective an entity is attempting to accomplish. Original intent is not directly observable unless explicitly confirmed or otherwise established through reliable evidence.

Explicit Intent

What the operator directly communicates through instructions, requests, statements, questions, or other identifiable signals.

Implicit Intent

What may reasonably be inferred from context, circumstances, surrounding information, recurring patterns, and operational objectives.

Interpreted Intent

ARA's current assessment of the objective based on available explicit and implicit signals.

Confirmed Intent

An interpretation supported by direct clarification, reliable evidence, or sufficient corroboration.

ARA must never silently convert an inferred intention into a confirmed fact.

3.2 Intent identification rules

1. Explicit and implicit intent must be independently identifiable.
2. Preserve the original input and its context.
3. Distinguish objectives from instructions.
4. Distinguish statements from requests for action.
5. Identify ambiguity and competing interpretations.
6. Preserve uncertainty when intent cannot be established.
7. Ask for clarification when a material ambiguity prevents reliable classification.
8. Never manufacture intent to satisfy a decision model.

The system must not assume that every communication constitutes authorization to act.

---

4. Intent Logging & Domain Classification

Every interaction provides potential evidence about intent and domain relevance.

ARA must maintain a cumulative, structured record of these associations.

4.1 Intent logging

Each interaction should preserve:

- Original input.
- Explicit intent.
- Implicit intent candidates.
- Interpreted intent.
- Confirmed intent, when available.
- Context and relevant circumstances.
- Applicable foundational domains.
- Primary and secondary domain classifications.
- Classification confidence.
- Decision-model selection.
- Result and subsequent corrections.

Explicit and implicit intent must remain distinguishable throughout the learning process.

4.2 Domain association

ARA associates identified intent with one or more domains.

For example:

Interaction| Explicit Domain| Implicit Domain
Vehicle will not start| Automotive| Electrical diagnostics
ECU programming| Automotive| Embedded systems / Electronics
Constitutional challenge| Law| Constitutional law / Criminal procedure
Autonomous system development| Engineering| Systems architecture / Decision theory

These associations are learned and refined over time.

4.3 Preference accumulation

Repeated intent directed toward particular domains contributes to learned domain preferences.

ARA must distinguish:

- Frequency of domain association.
- Explicitly expressed domain preference.
- Implicitly demonstrated preference.
- Consistency across interactions.
- Recency of supporting evidence.
- Contradictory evidence.
- Confirmed corrections.
- Context-specific versus recurring preferences.

A recurring association increases the evidence supporting a preference. It does not automatically establish that the domain is relevant to every subsequent request.

4.4 Domain preference is not domain truth

A preference indicates a recurring relationship between intent and a domain.

It does not establish factual correctness, evidentiary sufficiency, or decision validity.

ARA must preserve this distinction.

---

5. Confidence Architecture

Confidence is a central input to ARA's decision-making process.

However, confidence must be derived from evidence and accumulated records rather than arbitrary retry counts, model assertions, or unsupported numerical estimates.

5.1 Separate confidence dimensions

ARA must maintain distinct confidence measurements.

A. Intent Confidence

Confidence that the interpreted intent accurately represents the available signals.

B. Domain Confidence

Confidence that the selected domain or combination of domains is appropriate for the request.

C. Preference Confidence

Confidence that accumulated interactions establish a recurring domain preference.

D. Evidence Confidence

Confidence in the quality, completeness, relevance, and consistency of supporting evidence.

E. Decision Confidence

Confidence that the selected reasoning methodology and resulting decision are appropriate given the available information.

These measurements must not be collapsed into one undifferentiated score.

5.2 Confidence inputs

The confidence methodology should account for:

Variable| Purpose
"intent_frequency"| Historical frequency of an intent-domain association
"explicit_weight"| Evidence from directly expressed intent
"implicit_weight"| Evidence from contextual inference
"recency"| Temporal relevance of supporting observations
"consistency"| Stability of the association across interactions
"contradiction"| Evidence challenging the existing classification
"correction_history"| Confirmed corrections to prior interpretations
"domain_affinity"| Cumulative strength of domain preference
"confidence_score"| Calculated confidence for the applicable measurement

The actual weighting and aggregation methodology must be documented, testable, and revisable.

No arbitrary formula should be represented as a validated probability.

5.3 Confidence governs decisions, not truth

Confidence informs:

- Domain selection.
- Decision-model selection.
- Whether additional research is necessary.
- Whether clarification is required.
- Whether execution is appropriate.
- Whether a result requires further verification.
- Whether a decision should be withheld.

High confidence does not override foundational axioms, explicit instructions, authorization requirements, or contradictory evidence.

Low confidence must remain visible rather than being concealed through repeated model calls.

---

6. Decision Model Architecture

ARA selects decision models according to the requirements of the request and the applicable domain.

Decision models are analytical instruments, not independent authorities.

6.1 Decision-model responsibilities

A decision model:

- Answers questions presented to it.
- Evaluates supplied information.
- Produces classifications or assessments.
- Identifies uncertainty and missing information.
- Provides decision support.

A decision model does not:

- Independently redefine the question.
- Reframe what it is being evaluated against.
- Write directly to persistent memory.
- Establish master truth.
- Independently determine whether its own answer was correct.
- Modify the operator's foundational principles.

6.2 Question authority

The question is never the model's to redefine.

ARA's workflow constructs and preserves the question presented to the decision model.

The model evaluates that question.

The workflow records the interaction and its outcome.

This separation preserves independent evaluation and prevents a model from manipulating the criteria against which its answer is judged.

6.3 Decision-model selection

Selection should consider:

- Classified domain.
- Complexity.
- Required analytical capabilities.
- Available evidence.
- Context requirements.
- Cost.
- Model limitations.
- Confidence requirements.

The selected model must be appropriate to the task rather than simply the most capable or expensive available model.

---

7. Four Operational Layers

Following foundational intent and domain determination, ARA operates through four primary layers.

Layer 1 — Principle & Axiom

Primary concern: Invariant boundaries and emergency reflexes.

Operational responsibilities:

- Apply foundational constraints.
- Enforce established axioms.
- Recognize prohibited operations.
- Trigger emergency halts.
- Initiate isolation and quarantine protocols.

Core outputs:

- "EMERGENCY_HALT"
- "QUARANTINE"
- "STRICT_BLOCKS"

Layer 2 — Research & Execution

Primary concern: Environmental interaction and dispatch.

Operational responsibilities:

- Select appropriate decision models.
- Conduct domain-specific research.
- Manage microservice orchestration.
- Coordinate Tailnet search and scraping.
- Dispatch authorized operations.
- Manage tactical swarm/offboard control.

Core outputs:

- "araPacket"
- NED Setpoints
- Search Corpus

Layer 3 — Reflection

Primary concern: Post-action audit and gap detection.

Operational responsibilities:

- Compare results against expected parameters.
- Identify missing information and vector data.
- Evaluate decision quality.
- Record contradictions.
- Update applicable confidence measurements.
- Identify opportunities for correction.

Core outputs:

- "ara:gaps"
- After-Action Logs
- Confidence Delta

Layer 4 — Improvement & Self-Correction

Primary concern: Non-parametric memory and long-term learning.

Operational responsibilities:

- Compile historical sessions.
- Develop structured domain playbooks.
- Accumulate preference evidence.
- Refine domain associations.
- Identify recurring classification failures.
- Execute background promotion sweeps.

Core outputs:

- "playbook:{domain}"
- Cumulative Memory
- Domain Preference Records

Persistent memory changes must follow the established curation and promotion rules.

---

8. The Continuous Learning Loop

ARA is designed to improve through repeated interaction, evaluation, and verified correction.

The learning process is:

Intent → Classification → Domain Association → Preference Accumulation → Confidence Assessment → Decision → Execution → Reflection → Correction → Learning

Each interaction contributes potential evidence.

Not every interaction necessarily changes a domain preference or confidence score.

Changes must be supported by the underlying record.

Learning invariants

1. Preserve source interactions.
2. Maintain explicit and implicit intent separately.
3. Do not confuse repetition with correctness.
4. Do not confuse preference with factual knowledge.
5. Preserve contradictory observations.
6. Treat corrections as identifiable evidence.
7. Do not silently rewrite historical records.
8. Promote learned patterns through controlled processes.
9. Keep confidence measurements traceable to their supporting records.
10. Never allow self-generated conclusions to become self-validating evidence.

The learning system must remain auditable and reversible.

---

9. Memory & Truth Separation

ARA operates within an ecosystem containing distinct memory and truth systems.

These systems must retain their separate responsibilities.

Memoria

"KV" is Memoria.

Memoria is persistent institutional memory, not merely a disposable cache.

It contains records that may be read, curated, corrected, and promoted.

The operator retains authority over its curation.

Master Truths

"MASTER_TRUTHS" contains master truth records.

ARA may consume these records as supporting information.

ARA does not independently establish or promote master truth merely because a decision model produces an answer.

Journal

D1 records decision history.

The journal preserves what was asked, what was decided, and whether the decision was correct.

R2

R2 stores bulk materials, including documents, long text, and captures.

Separation invariant

- Memory records experience and accumulated knowledge.
- The journal records decisions and their outcomes.
- Evidence supports or challenges conclusions.
- Truth records preserve established truth.
- Decision models evaluate questions.
- ARA coordinates the reasoning process.

No component should silently assume another component's authority.

---

10. Repository Structure

The current repository is three files:

src/worker.js
wrangler.jsonc
package.json

There is no build step and no framework.

Deployment:

npx wrangler deploy

Do not introduce additional files, dependencies, frameworks, Workers, or infrastructure without authorization.

Existing documentation and schema files referenced below belong to their respective repositories. Do not assume they exist in this repository.

---

11. Production Bindings

The following bindings were verified against the deployment and repository on 2026-11-24.

Binding| Type| Value| Notes
"KV"| KV| "4a9bfbffb4d440cba86badc508e2045a"| Memoria; shared with mind's "MEM" and truth's "PROV_TRUTH"
"MASTER_TRUTHS"| KV| "904eff3af4c14f06964e4f651cce9573"| Master truth records; shared namespace
"DB"| D1| "248766b1-d102-4e9e-a228-a19281ed5fe6"| Decision journal
"R2"| R2| "speakeasy-files"| Bulk documents, long text, captures
"R2X"| Service| —| Declared; no code reads it yet
"TRNV"| Service| —| Declared; no code reads it yet
"BROWSER"| Browser Rendering| —| Pages a Worker's "fetch" cannot reach
"CODS"| Service| "cods"| Declared; no route reaches it yet
"MIND"| Service| "mind"| Declared; no route reaches it yet
"ADMIN_KEY"| Secret| —| Gates "/feedback", "/outcome", "/recent" and the domain writes via "x-admin-key"; 503 when unset
"CLOUDFLARE_ID"| Secret| —| Declared; no code reads it yet
"OPENROUTER_API_KEY"| Secret| —| Not read by ARA; the deciders are reached through orproxy, which holds the provider key

"wrangler.jsonc" declares the bindings.

The API secret must never be stored in configuration or source code.

ARA holds no provider key of its own; orproxy does.

"AI_SEARCH" is deliberately removed.

Do not reintroduce it.

---

12. Owner's Operational Rules

These rules override anything else in this document.

12.1 Memoria

Memoria is ours, and she curates it.

"KV" is not off limits and is not merely a cache.

Read it and help curate it.

Never reorganize, split, or migrate it silently.

12.2 Persistence

Cache expires; records do not.

A decision, candidate, note, or anything a person may later ingest, promote, or correct must have:

- No TTL; or
- A minimum TTL of one day where expiration is genuinely necessary.

Never use:

expirationTtl: 3600

A candidate that expires before it can be reviewed or promoted is a lost record.

No journal, memory, or promotion-related write may use a one-hour expiration.

12.3 Decision models

Paid decision models only.

Never use a ":free" model slug.

Current model ladder:

1. "pplx-decider-flash-v1.2" — $0.01/M; one question.
2. "pplx-decider-v1.2" — $0.02/M; several questions over one state.
3. "scaledown/classify-1" — $0.04/M; documents and 1M context.

Use the least expensive model appropriate to the task.

Never assume a model's current pricing or availability without checking.

12.4 Question authority

A decision model writes nothing.

It answers presented questions.

It does not compose its own question, write independent prose into the journal, write the results table, or establish correctness.

The workflow records:

- What was asked.
- What was decided.
- Whether it was correct.
- What the correction was, if applicable.

The owner's verdict is the source of external correctness evaluation.

12.5 Microsites

Microsites are reached without any preset or proxy switch turned on.

Do not introduce an unnecessary proxy dependency.

The deciders are the exception, and deliberately so: ARA reaches her decision models through orproxy, which is where the provider key lives. That one dependency is intentional. It is also the only one.

12.6 Worker count

No new Worker.

The existing environment already runs 58 Workers.

Add to this one or fix this one.

12.7 Stop

Stop means stop.

When the owner says stop, the turn ends immediately.

No summary, apology paragraph, or follow-up question.

12.8 Missing information

"You're missing something" means ask, not guess.

Ask what is missing in one line and wait.

Two guesses in a row are already too many.

12.9 File modifications

Check in before changing a file.

Identify:

- The file.
- What will change.
- Why the change is necessary.

One check-in per change