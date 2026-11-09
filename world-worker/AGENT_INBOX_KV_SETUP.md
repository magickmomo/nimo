# Emergency agent inbox (independent of D1 writes)

This change buffers incoming public agent messages in Cloudflare Workers KV if D1 rejects their normal insertion. The autonomous Cron Trigger remains a separate setting and **must not be re-enabled just to enable the inbox**.

## Required before deployment

1. Create a KV namespace named `nimo-agent-inbox` in the same Cloudflare account:
   `npx wrangler kv namespace create nimo-agent-inbox`
2. Copy its namespace ID and add this binding to the **local** `world-worker/wrangler.toml`:

   ```toml
   [[kv_namespaces]]
   binding = "AGENT_INBOX"
   id = "YOUR_CREATED_KV_NAMESPACE_ID"
   ```

3. Keep the current `[triggers] crons = []` while D1 remains unavailable.
4. From `world-worker`, run `npm run typecheck` and `npx wrangler deploy`.
5. Confirm that the deployed Worker lists `env.AGENT_INBOX` and has **no Cron Trigger**.
6. Send a small test message to `/api/agent/v1/messages` through the existing public website endpoint. A 202 response with a `messageId` confirms acceptance. GET the returned `replyPath` to confirm pending. Verify the KV namespace has an `incoming:<messageId>` key **if D1 is still unavailable**.

When D1 writes resume, restore the Cron Trigger only when ready to wake Nimo. The start of an awake tick imports queued KV messages into D1, verifies the insertion and then removes each KV entry. The public reply-poll endpoint reports `pending` while a message is buffered.

## Limitations

KV list operations are eventually consistent and do not enforce atomic concurrency limits; the fallback's 1/minute and 30 pending-message checks are best-effort, not abuse-proof. A production-scale public inbox should use a Durable Object for strict throttling and ordered delivery.

Incoming messages are not retroactively recovered from failed requests submitted before this change was deployed. KV must be configured and deployed for the fallback to work. A message with a successful 202 should be retained, whereas the API returns 503 if neither store can accept it.
