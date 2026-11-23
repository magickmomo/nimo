# World 004 — Strategy E isolated live-executor canary

**Status: separate D1/R2 provisioned, selected state cloned and checked; Worker NOT deployed and autonomy NOT active.** This branch must not be merged into or deployed as World 003.

## What changes
- Uses the existing World Worker, full action execution, D1-backed physical state, garden, food, notes, art, projects, Oracle, journeys and memory.
- Replaces only `decide()` with Strategy E, using a compact dynamic real-world context for an OpenAI Decisions choice followed by a Responses structured-generation handoff.
- Validates the generated action with the existing `validateDecision` and requires exact agreement with the first-stage selection before any tool can execute.
- Retains normal owner pause control, sleeping schedule, D1 trace logging and R2 decision audit.
- Adds `WORLD_004_ENABLED` (default false), absolute `WORLD_004_START_AT` and `WORLD_004_STOP_AT`, and `WORLD_004_MAX_RUN_DECISIONS` (default 120 decisions for the entire canary, hard maximum 1000).

## Completed infrastructure (23 November 2026)
- Created Cloudflare D1 `nimo-world-004` (UUID tracked in `wrangler.world-004.toml`) and empty R2 bucket `nimo-world-004-archives`. These are independent of World 003.
- Copied source world state, its 46 application table schemas, 27 indexes and 43 triggers through authenticated D1 APIs. The copy includes 11,268 historical events, 284 sketches, 12 notes, 72 consolidated V2 memories, 273 V2 memory-evidence rows, 66 Oracle questions, 11 creator requests, all available world map tiles and recorded world position, food, garden, projects, rewards, and supporting state.
- Preserved primary keys and verified all 11 database foreign-key relationships by left-join orphan checks: zero broken references.
- World 004 `world_control.autonomous_enabled` is **0**, so its stored world is paused.
- Intentionally did **not** copy the three bulky diagnostic/audit datasets: `action_trace` (9,347 old traces), `decisions` (5,949 old selections), or `world_revision_history` (15,258 old revision snapshots). Their schemas and triggers exist, and World 004 will start fresh independent logs. Earlier decisions and traces remain preserved in World 003.
- This copy was taken from live tables using successive API reads, not from one atomic multi-table SQL transaction. Treat as a **near-time operational clone**, not a strictly point-in-time export. World 003 was never paused or written during cloning.

## Remaining before deployment
1. The isolated Worker `nimo-world-004` has **not** been deployed. The dedicated GitHub Actions workflow `.github/workflows/nimo-world-004-deploy.yml` can deploy a reviewed commit with autonomy OFF, and is designed to run separately from the production deployment workflow. The workflow must be available on the repository's default branch for GitHub's manual workflow-dispatch UI.
2. Set distinct Worker secrets through Cloudflare secrets UI / protected environment tools. World 003's `OPENAI_API_KEY` and `WORLD_INTERNAL_SECRET` are write-only and intentionally were not copied. Do not commit or paste them into chat.
3. Verify the deployed Worker reports its own state (not World 003) and verify the owner/site route uses a **separate web deployment** pointing only at World 004.
4. Smoke-test Decisions selection, Responses structured generation and at least one safe real action with the isolated Worker; review traces and costs.
5. Only then set a 24-hour UTC activation window, configure World 004's one-minute cron and set `WORLD_004_ENABLED=true`. The decision budget is `WORLD_004_MAX_RUN_DECISIONS=120` for the **whole run** (not per UTC calendar day), with a hard maximum of 1,000. Operator pause remains available. World 003's schedule remains untouched.
6. Restore `WORLD_004_ENABLED=false`, remove its cron, or pause `world_control` to stop the canary. The absolute `WORLD_004_STOP_AT` independently prevents decisions after the experiment window.

## Deployment safety requirements
- Never run a deployment using `wrangler.toml` (that points to World 003). Always pass `--config wrangler.world-004.toml`.
- `npm run check:world004` must pass before deploying. The checker rejects World 003 D1 or R2 bindings, wrong Worker name, invalid or missing canary settings, and missing activation window checks.
- Use a reviewed commit SHA, not a moving branch ref, in the manual release workflow. Keep the GitHub `world-004` environment protected for secret-bearing releases.
- The Worker has no cron while staged, `WORLD_004_ENABLED=false`, and a disabled stored autonomy control. Do not activate by publishing a cron alone.
- External side effects through shared services require separate scoping. The existing Oracle research path is available, but all API costs and R2/D1 writes are independent of World 003.

## Observation and limitations
This is the live executor, not the browser sandbox. Strategy E here is a faithful first integration of the architecture, **not** a bit-for-bit copy of the browser's five-tier experimental prompt: it uses the same adaptive bounded memory/goal selection principles with a fresh real Worker snapshot. It selects tools at the action-name level; the original schema generation resolves the exact target, which is still checked by the executor. The generator reads the full original context and will cost more than future focused task handoffs. A failed generation/selection produces an audited failed decision and does **not** fall back to legacy, to keep the experiment valid.

A one-day canary is limited evidence; retain both model usage and verified action outcomes. Do not turn on shared/public outbound services without explicit scoping.
