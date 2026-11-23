# Nimo decision-context harness

**Experimental and offline.** This harness does not modify the live Worker, call an AI model, or write to Cloudflare. It constructs a proposed compact decision request from Nimo's existing private R2 decision-input exports. Do not commit input exports or generated reports.

## Usage

Run from `world-worker`:

```bash
npm run context:harness -- --input /path/to/nimo-decision-context-last60m.json --trace 8557
npm run context:harness -- --input /path/to/nimo-decision-context-last60m.json --mode creative --out ./harness-output
npm run context:harness -- --input /path/to/nimo-decision-context-last60m.json --mode research --target-chars 20000
node --test tests/decision-context-harness.test.mjs
```

`summary.json` contains the before/after character counts, estimated reductions, omitted sections and over-budget flags. The per-trace JSON files contain the **complete proposed request** (including the original structured response schema) alongside the archived decision outcome. The archived outcome is only a reference: **no new model decision is generated**.

## Context strategy being simulated

* A short persistent system prompt about Nimo's identity and autonomy.
* Always retain current identity, activity, goals, needs, position, visible obstacles/objects, actual available actions and carried resources.
* Send compact overviews of remembered places, projects, relevant memories, significant experience and other capabilities.
* Keep at least some memories not relevant to the current goal, to avoid reinforcing the same activity indefinitely.
* Offer optional creative/research working sets; choose `auto`, `routine`, `creative` or `research` from the command line.
* Keep the **original response schema unchanged** while testing context reduction separately.

## Important limitations

This is an exploratory prototype, **not a production-ready token budgeter**.

1. The budget is in serialized **characters**, not measured tokens. `characters / 4` is a rough illustrative heuristic and cannot be used to estimate real charges reliably.
2. The required core and original schema are never removed to hit the character budget; the report explicitly flags an over-budget result.
3. Some details (historical Oracle answers, full workspace contents, exact explored tiles, older drawings and object inspections) are omitted or summarized, and this may change model behaviour. Examine these gaps before integration.
4. The proposed context has **not** been tested against a model for validity, creativity, action quality or autonomy. Running a controlled model shadow replay would be a separate experiment with explicit API costs.
5. The archived visitor-message payload is preserved when present, but the harness cannot independently prove that all historical actions and special states are represented sufficiently.
6. The script has no access to the live database. Source context is a snapshot from a supplied export.

**No integration with production `decide()` is performed in this branch.**

## Framework V1: action selection and generation handoff

The new `decision-framework-v1.mjs` rehearses the new philosophy using exact archived snapshots.

```bash
cd world-worker
npm run framework:simulate -- --input /path/to/nimo-decision-context-last60m.json --trace 8557
npm run framework:simulate -- --input /path/to/nimo-decision-context-last60m.json --trace 8557 --choose start_sketch
npm run framework:simulate -- --input /path/to/nimo-decision-context-last60m.json --trace 8557 --choose eat_fruit:red --outcome success
node --test tests/decision-framework-v1.test.mjs
```

The output contains `context`, a candidate `POST /v1/decisions` request (using a `choice` question), `choices` with executable mappings, and (when a manual `--choose` is supplied) either a direct `toolCall`, or a `/v1/responses` task context.

Important:
- **There is no live Decisions call.** Selection is supplied manually via `--choose`; it is not a model prediction.
- **There is no world mutation, live execution or persistent state update.** Optional outcome feedback is tagged simulated.
- Visitor replies bypass the single-choice selection and go to the generation handoff.
- Travel choices are currently limited to immediately adjacent, explicitly walkable destinations. Extending to meaningful distant reachable destinations needs a verified pathfinder and careful option bounds.
- Generative handoffs are **specifications**, not production-ready requests: tool-specific schemas and actual world execution remain in the existing `decide()` implementation.
- New `identity` prompt exists in the harness only. No production prompt or architecture is altered.
- API choice questions require 2–255 options. The simulator checks overflow; pending visitor replies use a direct handoff.
- This first version prioritises faithful options and continuity over ideal token budgets. Measure input tokens and validate memory coverage before live integration.

## Step-by-step logging (Framework V1)

Every `framework:simulate` run writes three audit views alongside its normal output:

- `framework-trace-<traceId>.json`: complete structured record, including every stage's unmodified input/output values and provenance.
- `framework-trace-<traceId>.jsonl`: one JSON object per stage for filtering and comparing runs.
- `framework-trace-<traceId>.md`: human-readable sections, each with its input, output, status and notes.

Example:

```bash
cd world-worker
npm run framework:simulate -- --input /path/to/nimo-decision-context-last60m.json --trace 8558 --out ./harness-output
npm run framework:simulate -- --input /path/to/nimo-decision-context-last60m.json --trace 8558 --choose start_sketch --out ./harness-output
npm run framework:simulate -- --input /path/to/nimo-decision-context-last60m.json --trace 8558 --choose start_sketch --outcome success --out ./harness-output
```

**Logged stages:** `archive` → `context` → `choices` → `decisions_request` → `decisions_response` → `route` → `generation` → `world_execution` → `feedback`.

Statuses and provenance are explicit:

- `archived_request`: historical request copied from the export, not a new request.
- `offline_simulation`: pure context/choice/routing transformations.
- `manual_test_choice`: option passed through `--choose`; **not** a Decisions API response.
- `not_run` or `skipped`: no model call or executor call occurred.
- `simulated_feedback`: synthetic test outcome, **not** world-verified success.

The logs are **full-fidelity, not redacted**, and include private historical prompt and memory contents. Keep them local; do not check them into Git, attach them to public issues, or publish the outputs. Do not assume logged content is safe to share.

This is instrumentation of the *offline harness*. It is not wired to live APIs, so there are no actual Decisions or Responses API outputs to log yet.

## Preview UI: Run with AI (owner-only)

The deployed `/decision-harness` feature-branch page now has two actions:

- **Run simulation**: runs in the browser, manual choice, zero model calls.
- **Run with AI**: makes one real `gpt-6-luna` `POST /v1/decisions` call via `/api/decision-harness/run`, guarded by the same signed owner session used for world settings. Sign in at `/world/settings` on the same preview hostname first. It consumes API tokens and requires `LAB_OPENAI_API_KEY` (or `OPENAI_API_KEY`) configured for the preview project.

The browser sends only the compact decision context and choice value/description pairs after the explicit AI click. The historical archive stays in browser memory. The server verifies same-origin, validates the choice payload, reconstructs the complete request including the fixed identity/instructions, and calls the OpenAI API. The returned raw model response, selected choice, latency, token usage, and estimated cost are shown in the trace. The selected choice is verified against the exact menu that was sent.

**Both modes remain strictly read-only with respect to Nimo's world:** no executor, D1 or R2 calls, no creative Responses API calls, no autonomous ticks. A generative action produces only a *handoff specification*.

The cost displayed in the UI is an estimate based on published Decisions API token rates for a short-context `gpt-6-luna` call ($0.10/M uncached inputs, $0.01/M cached reads, $0.125/M cache writes, zero output cost). Actual charges can differ depending on billing tier, region, rate changes or discounts; consult provider billing for exact cost.

Do not expose the OpenAI key in client code or share downloaded historical traces publicly. The owner session is essential because public callers must not be able to incur API charges.

## Isolated replay sandbox (first integration milestone)

Open `/decision-harness/sandbox` on the preview deployment.

- Load the built-in fixture or upload an archived decision input.
- Run one step manually or use the owner-authenticated Decisions API.
- A supported selected creative action invokes the owner-protected `/api/decision-harness/generate` endpoint (real `/v1/responses` call) to produce narrow structured parameters.
- The browser applies supported action effects to an isolated clone of the loaded world. Travel uses the same `web/lib/world-map.ts` pathfinding as the Worker. It reports the generated legacy-shaped decision and feeds replay events into the next compact context.
- Stepwise trace shows the exact selection, generation result, local replay outcome, running usage and the next state. A reset restores the original snapshot. No browser or server step may write to D1 or invoke the production Worker.

**Important limitation:** This is a guarded *emulator*, not the Cloudflare D1-backed executor in `world-worker/src/index.ts`. Although it uses the actual shared map, local effects are deliberately restricted. For example, fruit consumption removes a carried item but deliberately does **not** invent the fruit's fullness effect. Tool outcomes are tagged `sandbox_replay_event`; unsupported actions fail without mutations. A true executor-parity test requires a separately provisioned D1 database, migrations, and a dedicated isolated Worker binding, or a carefully extracted executor with an injectable persistence interface.

Do not enable automatic consecutive AI calls or point this sandbox at the production Worker. Calls occur only on the owner's explicit step click; maximum 30 steps per replay.
