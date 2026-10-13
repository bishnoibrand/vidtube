/**
 * Text normalization, formatting, and search-term extraction.
 * Dates and counts are derived only from real numeric inputs.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "from",
  "this", "that", "these", "those", "is", "are", "was", "were", "be", "as", "at",
  "by", "it", "its", "into", "your", "you", "we", "our", "their", "his", "her",
  "video", "videos", "watch", "official", "full", "episode", "episodes", "hd",
  "4k", "new", "vs", "via", "amp", "http", "https", "www", "com", "dailymotion",
  "youtube", "part", "vol", "volume", "feat", "ft", "remix", "lyrics", "lyric",
  "subscribe", "like", "share", "follow", "click", "link", "bio",
]);

export function tokenize(input) {
  if (typeof input !== "string" || !input) return [];
  return input
    .toLowerCase()
    .replace(/[#@]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 32 && !/^\d+$/.test(token));
}

export function meaningfulTokens(input) {
  return tokenize(input).filter((token) => !STOPWORDS.has(token));
}

/** Exact-enough title key. Numbers and small words stay so similar titles are not treated as duplicates. */
export function normalizeTitle(title) {
  if (typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSearchTerms(video, limit = 4) {
  const scores = new Map();
  const add = (tokens, weight) => {
    for (const token of tokens) {
      if (STOPWORDS.has(token)) continue;
      scores.set(token, (scores.get(token) || 0) + weight);
    }
  };
  add(meaningfulTokens(video?.title || ""), 3);
  const tags = Array.isArray(video?.tags) ? video.tags : [];
  for (const tag of tags) add(meaningfulTokens(tag), 4);
  add(meaningfulTokens(video?.description || "").slice(0, 48), 1);
  if (video?.channel && video.channel !== "fun" && video.channel !== "people") {
    add(meaningfulTokens(video.channel), 1);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function tokenOverlap(queryTokens, video) {
  if (!queryTokens || queryTokens.length === 0) return null;
  const title = new Set(tokenize(video?.title || ""));
  const tags = new Set((video?.tags || []).flatMap((tag) => tokenize(tag)));
  const description = new Set(meaningfulTokens(video?.description || "").slice(0, 80));
  const channelBits = new Set(tokenize(`${video?.channel || ""} ${video?.ownerName || ""}`));

  let score = 0;
  for (const token of queryTokens) {
    if (title.has(token)) score += 1;
    else if ([...title].some((word) => word.startsWith(token) || token.startsWith(word))) score += 0.55;
    else if (tags.has(token)) score += 0.8;
    else if (channelBits.has(token)) score += 0.4;
    else if (description.has(token)) score += 0.32;
  }
  return score / queryTokens.length;
}

export function spamPenalty(title) {
  if (typeof title !== "string" || !title.trim()) return 0;
  const text = title.trim();
  let penalty = 0;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length > 16 && letters === letters.toUpperCase()) penalty += 0.15;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const freq = new Map();
    for (const word of words) freq.set(word, (freq.get(word) || 0) + 1);
    const max = Math.max(...freq.values());
    if (max / words.length > 0.5) penalty += 0.22;
  }
  if (/[!?]{3,}/.test(text)) penalty += 0.06;
  const emoji = text.match(/\p{Extended_Pictographic}/gu);
  if (emoji && emoji.length > 8) penalty += 0.1;
  return Math.min(0.45, penalty);
}

export function formatCount(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const n = Math.floor(value);
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const scaled = n / 1000;
    const digits = n < 10_000 ? 1 : 0;
    return `${trimFixed(scaled, digits)}K`;
  }
  if (n < 1_000_000_000) return `${trimFixed(n / 1_000_000, 1)}M`;
  return `${trimFixed(n / 1_000_000_000, 1)}B`;
}

function trimFixed(n, digits) {
  return n.toFixed(digits).replace(/\.0$/, "");
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCreated(unixSeconds, nowMs = Date.now()) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "Date unavailable";
  const ms = unixSeconds * 1000;
  if (!Number.isFinite(ms)) return "Date unavailable";
  const delta = nowMs - ms;
  if (delta < 0 || delta > 1000 * 60 * 60 * 24 * 365 * 40) return "Date unavailable";
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week} week${week === 1 ? "" : "s"} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? "" : "s"} ago`;
  const year = Math.floor(day / 365);
  return `${year} year${year === 1 ? "" : "s"} ago`;
}

export function plural(n, word) {
  if (!Number.isFinite(n)) return word;
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}
