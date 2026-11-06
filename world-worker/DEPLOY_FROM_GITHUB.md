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
5. The workflow verifies configuration, runs Worker TypeScript and tests, checks remote `world_control.autonomous_enabled=0`, applies migration **006** and (for 003.2A) **007**, then deploys the matching Worker. When selecting **current-main**, it also applies reward migration **008** and verifies the `world_rewards` table on the remote database before deploying. Any failure stops the workflow.
6. Merge the feature PRs in dependency order to deploy the corresponding `web/` code via Vercel. Keep Nimo asleep until both components are compatible. Wake and verify the world, journeys and active actions.

## Limitations

- This workflow does **not** back up D1, alter sleep/wake state, migrate on PR merge, or automatically restore failed migrations. Back up first.
- Verify account ID, database ID and scoped token permissions before running against production.
- A successful GitHub Actions run is not proof of Vercel deployment or runtime correctness.
- `003.2A` includes `003.1`; both migrations are applied in order when selecting `003.2A`.

## Reward migration 008 / diagnosing "Reward data unavailable"

The World UI may deploy before the Cloudflare Worker. In that case it shows **Reward data unavailable**, because the older Worker has no `rewards` and `rewardTotal` fields. This is different from a real total of zero.

To deploy the reward-enabled Worker safely:

1. Confirm the repository has `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets, a separately scoped **`CLOUDFLARE_D1_API_TOKEN`** secret that permits D1 read/write on the correct account, and `CLOUDFLARE_D1_DATABASE_ID` as a GitHub Actions variable.
2. Put Nimo to sleep in the World settings and back up the remote D1 database.
3. From GitHub Actions, run **Deploy Nimo World Worker (manual and migration-safe)**, select **current-main**, and enter `DEPLOY`.
4. The workflow checks that Nimo is asleep, applies migrations 006, 007 and **008**, verifies `world_rewards` in remote D1, and **only then** deploys the Worker.
5. Wake Nimo once deployment completes and check **Reward feedback** on the World dashboard. It should now have a numeric total (possibly zero initially), and new verified actions will begin populating the history.

The GitHub Actions checks workflow `Nimo World 003 checks` only validates migration SQL in a temporary in-memory SQLite database. Passing those checks **does not** migrate production D1 or deploy Cloudflare.

### Wrangler authentication error 10000

Local `wrangler d1 execute --remote --file=...` uses D1's import endpoint. An OAuth login showing `d1 (write)` does **not** prove this particular import request will be accepted. The manual GitHub workflow uses the dedicated D1 API token from GitHub Secrets instead. If its migration step still fails, inspect its Cloudflare error and check the token's account and D1 permissions in Cloudflare; do not deploy the Worker until the migration is verified.
