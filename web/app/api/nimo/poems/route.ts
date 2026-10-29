import { authorised, db, noStore } from "../../../../lib/nimo-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorised(request, "NIMO_ADMIN_TOKEN")) return noStore({ error: "Unauthorized" }, 401);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return noStore({ error: "LLM API key not configured" }, 503);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        max_tokens: 100,
        messages: [
          { role: "system", content: "You are Nimo, a small robot who writes original miniature poems. Write exactly four short lines, each at most 16 characters including spaces. No title, introduction, markdown, or claims about real-world observations. Plain ASCII characters only." },
          { role: "user", content: "Write a tiny original poem about quiet curiosity." },
        ],
      }),
    });
    if (!response.ok) return noStore({ error: "Poem generation failed" }, 502);
    const result = await response.json();
    const poem = result?.choices?.[0]?.message?.content;
    if (typeof poem !== "string" || !poem.trim()) return noStore({ error: "No poem returned" }, 502);
    const content = poem.trim().slice(0, 240);
    const rows = await db("nimo_messages?select=id,type,content,created_at,status", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ type: "poem", content, status: "pending" }),
    }) as Array<{ id: string; content: string }>;
    return noStore({ message: rows[0] }, 201);
  } catch {
    return noStore({ error: "Unable to queue poem; check server configuration" }, 503);
  }
}
