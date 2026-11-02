# Nimo World v0.1 — bodyless seed

New text-only page: `/world`. Existing companion chat, art studio and ESP32 firmware remain unchanged.

## Architecture — no Supabase
- `web/app/world/page.tsx`: read-only world dashboard and owner-token message form.
- `web/app/api/world`: server-side proxy to the World Worker (read-only).
- `web/app/api/world/message`: owner-authenticated proxy for messages.
- `world-worker/src/index.ts`: independently scheduled autonomous decision loop + persistence.
- `world-worker/schema.sql`: Cloudflare D1 (SQLite) schema.
- `web/lib/world.ts`: initial seed prompt, state and mood calculations ported from firmware.

The Cloudflare Worker uses a cron trigger each minute. It uses the current world state and last 20 journal events to ask an LLM what to do. A bounded, timestamped public monologue, optional belief, goal and identity update are saved. No avatar or external tools. The tool registry starts empty.

## Setup
1. Create a free [Cloudflare account](https://dash.cloudflare.com/) if needed. In a terminal, from the repo's `world-worker` directory, run `npm install`, then `npx wrangler login`.
2. Run `npx wrangler d1 create nimo-world`; record the database ID returned.
3. Copy `wrangler.toml.example` to `wrangler.toml`; replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID returned. Leave the cron as `* * * * *`.
4. Create a long, random secret for internal access and a separate owner token.
5. Set Worker secrets:
   ```sh
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put WORLD_INTERNAL_SECRET
   ```
6. Deploy once with `npm run deploy`. Apply the schema with `npm run db:migrate`. The migration is idempotent.
7. In the existing Vercel project for `web`, set server-side environment variables:
   - `WORLD_WORKER_URL`: deployed Worker URL (`https://nimo-world.<subdomain>.workers.dev`)
   - `WORLD_INTERNAL_SECRET`: same secret set in the Worker
   - `WORLD_OWNER_TOKEN`: a **different** randomly generated secret
8. Build and deploy the Next.js app with the new World page. Open `/world`.
9. Verify the first minute produces a decision. Refreshing the page only reads state; it does not call the AI.

## Usage limits and privacy
- Workers + D1 offer free quotas, but OpenAI API usage may be billed. The default 1440 model calls/day is the **maximum** for a successful 1-minute schedule, not a guarantee of free usage. Set a provider spending limit before activating.
- Change `MAX_DAILY_AI_CALLS` in `wrangler.toml` to a smaller number (for example 60) if you want a low-cost trial. The once-per-minute schedule remains, but AI decisions pause after the cap.
- The dashboard's journal is publicly readable if the website is publicly accessible. Don't send private information.
- The tick accepts one action per turn; `ACT` can only make a written proposal, not execute arbitrary code. `REQUEST` cannot grant permission.
- Model-generated monologue is a *public journal*, not an LLM's hidden reasoning.
- The primary seed and permissions are protected from agent self-modification. Beliefs and self-description can evolve. This is not model-weight training.
- No external email, social, monetary, or GitHub access is granted.
- Use an isolated Cloudflare account/project if separation becomes important later; no extra email required now.
- The Worker uses an atomic due-time claim; failed model calls can cause a missed decision. Logs and state remain persistent.

## Verification
Run `cd web && npm run typecheck && npm run build` plus `cd world-worker && npx tsc --noEmit`. This PR has not been deployed or runtime-tested.
