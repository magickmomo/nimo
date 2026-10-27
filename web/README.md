# Nimo — Next.js migration

This is an **isolated migration prototype** under `web/`; existing `nimo-frontend/` and `plotter-service/` are unchanged.

## Local setup

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Set `OPENAI_API_KEY` in `.env.local` to enable server-side chat. Never commit API keys. No key means chat returns HTTP 503. Chat history is transient and does not persist.

## Vercel

Create a **new** Vercel project pointing to this repository with **Root Directory = web** (do not repoint the existing production project yet). Framework preset Next.js. Add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in Environment Variables. Chat has no authentication or rate limiting yet: do not publish its URL widely until protections are added.

## Scope and limitations

- New Next.js landing page and experimental companion chat with a server-side LLM call.
- Initial client-side daily spirograph SVG preview and SVG download.
- Not yet ported: raster-to-SVG (potrace/autotrace), vpype path processing, G-code conversion, SQLite job queue, plotter agent connectivity, persistent memory, physical ESP32 device polling.
- The legacy Python processing uses binaries that cannot be directly moved into Next.js API routes. Evaluate JS/WASM alternatives or a separately deployed Vercel Python runtime with suitable native tools; prove it works before removing Fly.io.
- The ESP32 local HTTP server is LAN-only. Production device communication should be ESP32-initiated authenticated HTTPS polling/WebSocket and durable cloud storage. Do not attempt to connect a Vercel server to 192.168.x.x.
- This branch intentionally doesn't change production deployments or shut down Fly.io.
