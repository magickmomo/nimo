# Nimo's World — website

This Next.js app is the public interface for Nimo's persistent autonomous world.

## Routes

- `/` redirects to `/world`.
- `/world` displays Nimo's live world, status, journal, inventory, and owner-only Memories, Messages, Requests, Projects, Artworks and Oracle panels.
- `/world/settings` provides owner sign-in and controls.
- `/world/lab/*` contains isolated development experiments, not the live world.
- `/api/world/*` proxies the Cloudflare World Worker, including world state and owner functionality.
- `/api/agent/v1/*` exposes the restricted external agent mailbox.
- `/api/nimo/messages*` is a **legacy ESP32 message queue** retained until firmware and deployment usage can be confirmed. It is not the world's message inbox.

## Local development

```bash
cd web
npm install
npm run dev
```

Configure `WORLD_WORKER_URL`, `WORLD_INTERNAL_SECRET`, and `WORLD_OWNER_TOKEN` as required for the world. See `WORLD.md` for architecture and environment details. Do not commit secrets.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

Deploy this Next.js app on Vercel with **Root Directory = web**. The Cloudflare Worker and D1 schema/migrations live in `../world-worker`.

## Legacy code

The old Companion, Poetry and Art Studio website pages have been removed. The separate `../nimo-frontend` Svelte app and `../plotter-service` Python backend are historical projects, not dependencies of the world website. Confirm no independent deployment or physical plotter still consumes them before deleting. The ESP32 queue remains intact for the same reason.

Do not delete D1 migrations, reset scripts, or the worker's memory, artwork, or Oracle code as part of website cleanup.
