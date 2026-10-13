/**
 * VidTube AI proxy for Cloudflare Workers.
 *
 * Required Worker secrets/variables:
 *   CHATANYWHERE_API_KEY (secret)
 *   ALLOWED_ORIGIN (variable; exact frontend origin, e.g. https://owner.github.io)
 * Optional:
 *   AI_API_URL (default: https://api.chatanywhere.tech/v1/chat/completions)
 *   AI_MODEL (default: gpt-3.5-turbo)
 *
 * Configure a Cloudflare rate-limiting rule for this endpoint before public production use.
 */
const DEFAULT_AI_API_URL = "https://api.chatanywhere.tech/v1/chat/completions";
const MAX_BODY_BYTES = 16000;
const MAX_MESSAGE_CHARS = 6000;

function json(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = String(env.ALLOWED_ORIGIN || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    // Do not allow an unconfigured or arbitrary browser origin.
    if (!origin || !allowedOrigins.includes(origin)) {
      return json({ error: "Origin is not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Vary": "Origin",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600"
        }
      });
    }

    if (requestUrl.pathname !== "/api/ai/chat") {
      return json({ error: "Not found." }, 404, origin);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, origin);
    }
    if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
      return json({ error: "Content-Type must be application/json." }, 415, origin);
    }
    if (!env.CHATANYWHERE_API_KEY) {
      return json({ error: "AI service is not configured." }, 503, origin);
    }

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_BODY_BYTES) {
      return json({ error: "Request is too large." }, 413, origin);
    }

    let payload;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
        return json({ error: "Request is too large." }, 413, origin);
      }
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON body." }, 400, origin);
    }

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!message || message.length > MAX_MESSAGE_CHARS) {
      return json({ error: "message is required and must be no longer than 6000 characters." }, 400, origin);
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(env.AI_API_URL || DEFAULT_AI_API_URL);
      if (upstreamUrl.protocol !== "https:") {
        return json({ error: "AI endpoint must use HTTPS." }, 500, origin);
      }
    } catch {
      return json({ error: "AI endpoint configuration is invalid." }, 500, origin);
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.CHATANYWHERE_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.AI_MODEL || "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are VidTube AI, a helpful, concise video assistant. Do not claim a video was found, played, or analyzed unless the application confirms the action. If asked who created VidTube, answer that it was created by Arvind Dara Bishnoi."
            },
            { role: "user", content: message }
          ],
          max_tokens: 700
        }),
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      return json({ error: "AI provider is temporarily unavailable." }, 502, origin);
    }

    if (!upstream.ok) {
      // Do not expose the upstream body, authorization details, or provider diagnostics.
      return json({ error: "AI provider returned an error. Check server-side provider configuration." }, 502, origin);
    }

    let upstreamData;
    try {
      upstreamData = await upstream.json();
    } catch {
      return json({ error: "AI provider returned an invalid response." }, 502, origin);
    }

    const answer = upstreamData &&
      Array.isArray(upstreamData.choices) &&
      upstreamData.choices[0] &&
      upstreamData.choices[0].message &&
      upstreamData.choices[0].message.content;

    if (typeof answer !== "string" || !answer.trim()) {
      return json({ error: "AI provider returned no answer." }, 502, origin);
    }

    return json({
      choices: [{ message: { role: "assistant", content: answer } }]
    }, 200, origin);
  }
};
