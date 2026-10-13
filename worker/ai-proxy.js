/**
 * Server-side AI proxy for VidTube.
 *
 * The browser never sees the provider key. Deploy this file as a Cloudflare
 * Worker (see wrangler.toml) or run it with `npm run ai-proxy`.
 *
 * Required environment:
 *   AI_API_KEY   provider secret (never commit)
 *   AI_API_BASE  https origin + optional /v1 prefix, e.g. https://api.openai.com/v1
 * Optional:
 *   AI_MODEL              default gpt-4o-mini
 *   ALLOWED_ORIGINS       comma-separated origins; * is rejected
 *   RATE_LIMIT_PER_MINUTE default 8
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_BODY_BYTES = 16_000;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 2000;
const MAX_REPLY_CHARS = 4000;
const UPSTREAM_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
  "You are VidTube's assistant. VidTube is a video discovery site that plays public Dailymotion videos.",
  "The project credits Arvind Bishnoi.",
  "You cannot watch, download, analyze, or open videos yourself. Never claim that you played, found, or analyzed a video unless the user message already says the app did so.",
  "You do not have live access to the user's feed, likes, or follows.",
  "Do not invent view counts, upload dates, or channel statistics.",
  "If you are unsure, say so. Keep replies concise.",
].join(" ");

const buckets = globalThis.__vidtubeRateLimit || (globalThis.__vidtubeRateLimit = new Map());

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  const configured = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!origin) return { ok: true, origin: "" };
  if (!configured.length) return { ok: false, origin };
  if (configured.includes(origin)) return { ok: true, origin };
  return { ok: false, origin };
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host === "169.254.169.254") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function resolveUpstream(env) {
  const raw = (env.AI_API_BASE || "").trim();
  if (!raw) return { ok: false, error: "AI_API_BASE is not configured." };
  let url;
  try { url = new URL(raw); } catch { return { ok: false, error: "AI_API_BASE is not a valid URL." }; }
  if (url.protocol !== "https:") return { ok: false, error: "AI_API_BASE must use https." };
  if (url.username || url.password) return { ok: false, error: "AI_API_BASE must not include credentials." };
  if (isBlockedHost(url.hostname)) return { ok: false, error: "AI_API_BASE host is not allowed." };
  const allow = (env.AI_ALLOWED_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length && !allow.includes(url.hostname.toLowerCase())) {
    return { ok: false, error: "AI_API_BASE host is not in AI_ALLOWED_HOSTS." };
  }
  const path = url.pathname.replace(/\/+$/, "");
  const endpoint = path.endsWith("/chat/completions")
    ? `${url.origin}${path}`
    : `${url.origin}${path}/chat/completions`;
  return { ok: true, endpoint, model: (env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL };
}

function takeRateToken(ip, limit) {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(ip) || [];
  const recent = bucket.filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  buckets.set(ip, recent);
  if (buckets.size > 5000) {
    const oldest = buckets.keys().next().value;
    buckets.delete(oldest);
  }
  return true;
}

export function sanitizeMessages(input) {
  if (!Array.isArray(input)) return { ok: false, error: "messages must be an array." };
  const messages = [];
  for (const message of input.slice(-MAX_MESSAGES)) {
    if (!message || typeof message !== "object") continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (typeof message.content !== "string") continue;
    const content = message.content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
    if (!content) continue;
    messages.push({ role: message.role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { ok: false, error: "A user message is required." };
  }
  return { ok: true, messages };
}

export async function handleAiRequest(request, env, context = {}) {
  const check = originAllowed(request, env);
  const headers = corsHeaders(check.origin);
  if (request.method === "OPTIONS") {
    if (!check.ok) return json(403, { error: "origin_not_allowed" }, headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, headers);
  if (!check.ok) return json(403, { error: "origin_not_allowed" }, headers);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(415, { error: "unsupported_media_type" }, headers);
  }

  const ip = context.clientIp || "unknown";
  const limit = Math.max(1, Math.min(60, Number(env.RATE_LIMIT_PER_MINUTE) || 8));
  if (!takeRateToken(ip, limit)) {
    return json(429, { error: "rate_limited" }, headers);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return json(413, { error: "body_too_large" }, headers);

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "body_too_large" }, headers);
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid_json" }, headers);
  }

  const cleaned = sanitizeMessages(body?.messages);
  if (!cleaned.ok) return json(400, { error: "invalid_messages" }, headers);

  if (!env.AI_API_KEY) return json(503, { error: "ai_not_configured" }, headers);
  const upstream = resolveUpstream(env);
  if (!upstream.ok) return json(503, { error: "ai_not_configured" }, headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(upstream.endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: upstream.model,
        temperature: 0.4,
        max_tokens: 600,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...cleaned.messages],
      }),
    });
  } catch {
    return json(504, { error: "upstream_timeout" }, headers);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    console.log(JSON.stringify({
      event: "ai_upstream_error",
      status: response.status,
    }));
    return json(502, { error: "upstream_failed" }, headers);
  }
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    return json(502, { error: "upstream_invalid" }, headers);
  }
  return json(200, { reply: reply.trim().slice(0, MAX_REPLY_CHARS) }, headers);
}

export default {
  async fetch(request, env) {
    const ip = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";
    return handleAiRequest(request, env, { clientIp: ip });
  },
};
