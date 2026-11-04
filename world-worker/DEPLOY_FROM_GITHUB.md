# Deploy Nimo World from an iPhone

The **Deploy Nimo World Worker (manual and migration-safe)** GitHub Actions workflow is deliberately **manual-only**. Merging a PR does not automatically mutate Cloudflare D1 or deploy a Worker. It deploys Worker code from the selected, named feature branch; it does **not** deploy the Vercel website.

## Required repository secrets and variable

In GitHub **Settings → Secrets and variables → Actions**, configure:

- Secret `CLOUDFLARE_API_TOKEN`: existing **Specified Workers → Editor** token for `nimo-world` (Worker deployment).
- Secret `CLOUDFLARE_D1_API_TOKEN`: a **separate Cloudflare token** with D1 permissions to query and execute migrations on the `nimo-world` database. A Workers Editor token alone does not necessarily grant D1 access.
- Secret `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- **Variable** `CLOUDFLARE_D1_DATABASE_ID`: ID of the existing `nimo-world` D1 database.

Never share API tokens in chat or commit them to GitHub.

## Runbook

1. Review PR #16 (003.1) and PR #17 (003.2A, stacked on #16). PR #17 includes PR #16's work.
2. Put Nimo to **sleep** at `/world/settings`. **Back up the remote D1 database** using Cloudflare's backup/export tools before migration.
3. Once the workflow PR is merged into `main`, open GitHub **Actions → Deploy Nimo World Worker (manual and migration-safe) → Run workflow**.
4. Select `003.1` for PR #16 only, `003.2A` for the original feature branch, or **`current-main`** to deploy the latest reviewed `main` Worker fixes (including 003.2A). Enter confirmation `DEPLOY`. Review changes on `main` before choosing this option.
5. The workflow verifies configuration, runs Worker TypeScript and tests, checks remote `world_control.autonomous_enabled=0`, applies migration **006** and (for 003.2A) **007**, then deploys the matching Worker. Any failure stops the workflow.
6. Merge the feature PRs in dependency order to deploy the corresponding `web/` code via Vercel. Keep Nimo asleep until both components are compatible. Wake and verify the world, journeys and active actions.

## Limitations

- This workflow does **not** back up D1, alter sleep/wake state, migrate on PR merge, or automatically restore failed migrations. Back up first.
- Verify account ID, database ID and scoped token permissions before running against production.
- A successful GitHub Actions run is not proof of Vercel deployment or runtime correctness.
- `003.2A` includes `003.1`; both migrations are applied in order when selecting `003.2A`.
