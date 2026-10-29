# Nimo poem queue

This feature is isolated from the existing companion chat. It adds a durable Supabase-backed outgoing queue and a test page at `/poetry`.

## Setup

1. Run `web/supabase/nimo_messages.sql` in the Supabase SQL editor.
2. Add these **server-side** environment variables to the Vercel project with Root Directory `web`:
   - `SUPABASE_URL` — your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — the secret service-role key (never use a public/anon key here, never expose via NEXT_PUBLIC_)
   - `NIMO_ADMIN_TOKEN` — a long random secret you enter on the Poetry page to generate a poem
   - `NIMO_DEVICE_TOKEN` — a separate long random secret shared with the ESP32
   - `OPENAI_API_KEY` — existing LLM key
3. Deploy the Next.js site.
4. Visit `/poetry`, enter your admin token, and press **Write and queue a poem**.

## Device protocol

Poll every 30 seconds over HTTPS:

```
GET /api/nimo/messages
Authorization: Bearer <NIMO_DEVICE_TOKEN>
```

Returns HTTP 204 when empty, otherwise:

```json
{"message":{"id":"UUID","type":"poem","content":"line one\nline two","created_at":"...","status":"pending"}}
```

After displaying the message successfully, acknowledge it:

```
POST /api/nimo/messages/ack
Authorization: Bearer <NIMO_DEVICE_TOKEN>
Content-Type: application/json

{"id":"UUID"}
```

Acknowledgement prevents redelivery. If the ESP32 restarts before acknowledging, it may receive the same message again; track the last displayed ID locally if duplicates matter. A 128x64 OLED may require scrolling/pagination; this is **not** implemented in firmware by this PR.

## Scope

This version generates poems **on demand** from the Poetry page and queues them. It does **not** schedule autonomous generation or flash the ESP32 firmware. Nothing in the queue requires an inbound connection to your home's private IP. The administrator page is token-protected on the server, but it is not a complete multi-user login system. Restrict access and consider rate limiting before public exposure.
