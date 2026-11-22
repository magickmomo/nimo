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
