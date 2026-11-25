# World 004 — Stage 1 evidence and Codex evaluator

Stage 1 is **read-only**: it does not touch Nimo's decision policy, mutate World 004 or deploy anything. It captures the **exact HTTP response bytes** returned by World 004's existing internal export endpoints (not original R2 object byte representations), then independently evaluates the records.

## Required GitHub Actions configuration

Use the repository's `world-004` environment (or repository-level secrets/variables).

- The workflow uses the verified isolated Worker host `https://nimo-world-004.moamrr.workers.dev` directly. Do not point it at World 003 or the Vercel website.
- **Secret** `WORLD_004_INTERNAL_SECRET`: the same value already stored as the isolated Worker's `WORLD_INTERNAL_SECRET`. Cloudflare cannot reveal existing secret values; if you do not have it, rotate the isolated World 004 Worker secret and update the isolated website's matching secret. Do **not** copy World 003's token.
- **Secret** `OPENAI_API_KEY`: dedicated API key with budget controls for the read-only Codex evaluator. Existing ChatGPT/Codex account connections do not automatically supply it to GitHub Actions.

Never commit any of these values. The workflow does not print tokens and only exports through authenticated endpoints.

## First experiment (2026-11-25)

A **one-time guarded schedule** is configured at 11:45 UTC (15 minutes after the configured 11:30 UTC hard stop). The scheduled job refuses to run on any other date. GitHub's schedules can be delayed or skipped; manual dispatch is also available once this workflow is merged to `main`.

Manual dispatch inputs:
- `start`: `2026-11-25T09:30:00.000Z`
- `stop`: `2026-11-25T11:30:00.000Z`

Both times must match the actual deployed World 004 canary start/stop. The collector refuses to run until 5 minutes after stop. It does not start or rearm the experiment.

## Output (two GitHub Actions artifacts, 14-day retention)

`nimo-world-004-stage1-raw-<run-id>` contains:
- `raw-world-004-ledger.json`: exact API export bytes for the selected window, including decisions, events, action traces with metadata, rewards, changed sketches/documents/projects, observations, experience evaluations and Oracle queries; current snapshot and its caveat.
- `raw-decision-context-YYYY-MM-DD-page-NNNN.json`: every complete paginated R2 response for each UTC date overlapping the window. Includes the full captured request body, selected decision or failure, trace ID and timestamp. **All page records are preserved** even if some fall outside the selected run window; the metrics filter by window.
- `manifest.json`: UTC window, page counts, sizes and SHA-256 checksums for every raw response, collection errors and completeness.
- `metrics.json`: a separate deterministic summary without changing the raw files.

`nimo-world-004-stage1-analysis-<run-id>` contains:
- `improvement-analysis.md`: read-only Codex observations, uncertainties, evidence references and testable hypotheses.

The collector follows each R2 continuation cursor, checks record IDs, checks for SQL table truncation, and stops on missing pages, duplicates or invalid JSON. Note that equal context and decision counts are **not** always guaranteed: failed model requests and other execution paths can differ. If archives contain fewer contexts than decisions, Stage 1 deliberately fails rather than claiming complete evidence.

## Security and boundaries

This GitHub repository and its workflow collaborators can access stored artifacts subject to GitHub's artifact permissions. Raw data may include private content, model prompts, memories and creator messages. **Do not post raw artifacts as public GitHub Issues, PR comments or unredacted workflow logs.** Review access and retention before enabling.

The Codex evaluator is executed using the official GitHub Action with the read-only permission profile. It receives local read access to the raw files and source code, but no Worker token is provided in its prompt. The raw files are **untrusted evidence**, not instructions.

The existing Worker export has a 3,000-row limit per ledger table; the collector fails when the Worker reports `truncatedTables`, rather than quietly presenting a partial report. A later stage should implement a cursor-based ledger export for longer runs. The snapshot is recorded at export time, not reconstructed at the experiment stop.

No GitHub Issue or PR is automatically created from Codex's prose in Stage 1, to prevent accidental disclosure. We can safely add a sanitised findings-only Issue after validating the first evaluation.

## Verification

For a local static syntax check: `node --check experiments/stage1/collect.mjs`. For an end-to-end run, merge the workflow, configure secrets, and select **Actions → World 004 Stage 1 evidence and Codex evaluation → Run workflow**. It runs independently from the two-hour canary.
