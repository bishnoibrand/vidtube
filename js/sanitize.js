/**
 * Validation helpers for untrusted provider and user data.
 * Pure functions — safe to unit test in Node.
 */

const VIDEO_ID = /^x[a-z0-9]{1,20}$/i;
const OWNER_ID = /^x[a-z0-9]{1,20}$/i;

const MEDIA_HOST = /(^|\.)dmcdn\.net$/i;
const PAGE_HOST = /(^|\.)dailymotion\.com$/i;

export function isValidVideoId(value) {
  return typeof value === "string" && VIDEO_ID.test(value);
}

export function isValidOwnerId(value) {
  return typeof value === "string" && OWNER_ID.test(value);
}

export function parseHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

export function isTrustedMediaUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  return MEDIA_HOST.test(url.hostname) || PAGE_HOST.test(url.hostname);
}

export function isTrustedPageUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  return PAGE_HOST.test(url.hostname);
}

export function videoPageUrl(id) {
  if (!isValidVideoId(id)) return null;
  return `https://www.dailymotion.com/video/${id}`;
}

export function playerEmbedUrl(id) {
  if (!isValidVideoId(id)) return null;
  return `https://geo.dailymotion.com/player.html?video=${encodeURIComponent(id)}`;
}

export function cleanQuery(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function asNonNegative(value) {
  const n = asFiniteNumber(value);
  if (n == null || n < 0) return null;
  return n;
}

export function asBoolean(value) {
  if (value === true || value === false) return value;
  return null;
}

export function asString(value, max = 8000) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

export function asStringList(value, maxItems = 40, maxLen = 80) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.replace(/[\u0000-\u001F]/g, "").trim().slice(0, maxLen);
    if (cleaned) out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function firstTrustedMediaUrl(candidates) {
  for (const candidate of candidates) {
    if (isTrustedMediaUrl(candidate)) return candidate;
  }
  return null;
}

export function hashString(value) {
  const text = String(value || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
