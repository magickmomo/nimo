# World 004 — Strategy E isolated live-executor canary

**Status: code staged, NOT provisioned, NOT active.** This branch must not be merged into or deployed as World 003.

## What changes
- Uses the existing World Worker, full action execution, D1-backed physical state, garden, food, notes, art, projects, Oracle, journeys and memory.
- Replaces only `decide()` with Strategy E, using a compact dynamic real-world context for an OpenAI Decisions choice followed by a Responses structured-generation handoff.
- Validates the generated action with the existing `validateDecision` and requires exact agreement with the first-stage selection before any tool can execute.
- Retains normal owner pause control, sleeping schedule, D1 trace logging and R2 decision audit.
- Adds `WORLD_004_ENABLED` (default false), absolute `WORLD_004_STOP_AT`, and `WORLD_004_MAX_DAILY_DECISIONS` (default 120, hard maximum 1000).

## Isolation: mandatory before deploy
- Allocate a completely separate Cloudflare D1 named `nimo-world-004`.
- Allocate a separate R2 bucket named `nimo-world-004-archives`.
- Obtain a consistent SQL export of World 003, and import into the NEW database only. Include all schema migrations and data: world control, seen/visited tiles, long-term memories, projects, sketches, notes, inventory, oracle/research, rewards and journeys. Check counts and foreign keys.
- Edit `wrangler.world-004.toml` with new D1 UUID; never copy World 003's UUID or R2 bucket.
- `npm run check:world004` must pass (fails on placeholder/production bindings).
- Set Cloudflare Worker secrets via environment tooling, never commit them: `OPENAI_API_KEY`, `WORLD_INTERNAL_SECRET` and any additional external-action secrets needed for the cloned engine. Do not share World 003 internal secret.
- Deploy explicitly with `wrangler deploy -c wrangler.world-004.toml` only after passing the safety checker and Worker tests.
- Verify separate database bindings and read-only snapshot first, with `WORLD_004_ENABLED=false`. Do not give public URLs to an instance without authenticated controls.
- Set absolute UTC `WORLD_004_STOP_AT` to 24h after activation and verify the daily call cap before enabling autonomy; do not enable until QA. Add a minute cron trigger to the **World 004 config only** after approval, or invoke its isolated /tick endpoint from a separate scheduler. Leave World 003 schedules untouched.
- Use a distinct website/environment configuration for World 004, pointing only to its own Worker; do not reuse the production web's `WORLD_WORKER_URL`.

## Observation and limitations
This is the live executor, not the browser sandbox. Strategy E here is a faithful first integration of the architecture, **not** a bit-for-bit copy of the browser's five-tier experimental prompt: it uses the same adaptive bounded memory/goal selection principles with a fresh real Worker snapshot. It selects tools at the action-name level; the original schema generation resolves the exact target, which is still checked by the executor. The generator reads the full original context and will cost more than future focused task handoffs. A failed generation/selection produces an audited failed decision and does **not** fall back to legacy, to keep the experiment valid.

A one-day canary is limited evidence; retain both model usage and verified action outcomes. Do not turn on shared/public outbound services without explicit scoping.
