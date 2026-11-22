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
