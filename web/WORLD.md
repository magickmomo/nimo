# Nimo World — seed experiment (v0.1)

A deliberately small, separate page at `/world`. Existing companion chat, art studio, and ESP32 firmware are untouched.

## Features
- Bodyless text character, initial identity prompt from `lib/world.ts`.
- Existing energy/happiness/boredom mood variables adapted to elapsed-time updates.
- JSON identity, hypotheses/core beliefs with evidence, activity, goal, and an initially empty tools array.
- Server-side 60-second decision eligibility; LLM emits a short **public journal entry**, not raw hidden model reasoning.
- Durable, timestamped events and owner messages; database state survives browser closure/redeploy.
- `REQUEST` logs proposed capabilities but never grants them.
- Existing prompts and remembered events inform each decision; the model weights do not update.

## Setup
1. Create a Supabase project and run `web/world-schema.sql` in its SQL editor.
2. In the Next.js `web` project set environment variables:
   - `SUPABASE_URL` (project URL)
   - `SUPABASE_SERVICE_ROLE_KEY` (server secret; **never** NEXT_PUBLIC)
   - `OPENAI_API_KEY`
   - `WORLD_MODEL` (optional, defaults to `gpt-4.1-mini`)
   - `WORLD_CRON_SECRET` (long random secret for the scheduler)
   - `WORLD_OWNER_TOKEN` (different long secret for submitting messages)
3. Run `cd web && npm install && npm run dev`.
4. Open `http://localhost:3000/world`. The page reads state but does **not** run the agent.
5. Trigger the decision endpoint by POST with bearer token:
   `curl -X POST http://localhost:3000/api/world/tick -H "Authorization: Bearer YOUR_WORLD_CRON_SECRET"`
6. In production configure an **external scheduler** to POST to `https://your-site/api/world/tick` once a minute with the same Authorization header. The hosted process does not stay alive by itself; Vercel Hobby cron is not suitable for this frequency.
7. Run the scheduler only after setting an API spending cap and monitoring model usage.

## Boundaries
- No avatar, virtual body, self-modifying code or real-world tools.
- No permission to use money, email, social media, or device hardware.
- Server secrets are required for tick and write actions. Public read-only journal intentionally exposes logged thoughts/messages. Do not send private information.
- Underlying seed prompt and safety limits can be changed by the developer; the model can propose updated beliefs but cannot modify the protected seed, tools or permissions.
- Event log is capped to the last 20 entries in each LLM prompt, and last 60 on the page. Older events stay stored but are not automatically recalled yet.
- One tick per eligible minute, not guaranteed precise timing. A single tick may be skipped on a model failure. No automatic retries.
- 10-second UI refresh does not call an LLM; only the authorised tick does.
- Early prototype: no automated deployment or CI verification performed through GitHub; check `npm run typecheck` and `npm run build` before merging.
