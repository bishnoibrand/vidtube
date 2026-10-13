/**
 * Video validation, dedupe, scoring, diversity, and final ranking.
 * Independent of fetching and rendering so it can be tested on its own.
 *
 * Scores use only metadata the provider actually returned. Missing metrics
 * are omitted and their weight is redistributed — they are not invented.
 * The score is an ordering signal, not a claim about artistic quality.
 */

import {
  asBoolean,
  asNonNegative,
  asString,
  asStringList,
  firstTrustedMediaUrl,
  isValidOwnerId,
  isValidVideoId,
} from "./sanitize.js";
import { channelLabel } from "./categories.js";
import { meaningfulTokens, normalizeTitle, spamPenalty, tokenOverlap } from "./text.js";

export const RANK_WEIGHTS = {
  home: {
    providerRank: 0.34,
    relevance: 0,
    category: 0,
    views: 0.18,
    recency: 0.16,
    engagement: 0.08,
    completeness: 0.08,
    credibility: 0.08,
    formatFit: 0.08,
  },
  search: {
    providerRank: 0.12,
    relevance: 0.46,
    category: 0.06,
    views: 0.1,
    recency: 0.1,
    engagement: 0.04,
    completeness: 0.04,
    credibility: 0.04,
    formatFit: 0.04,
  },
  category: {
    providerRank: 0.22,
    relevance: 0.16,
    category: 0.22,
    views: 0.12,
    recency: 0.12,
    engagement: 0.04,
    completeness: 0.04,
    credibility: 0.04,
    formatFit: 0.04,
  },
  related: {
    providerRank: 0.1,
    relevance: 0.4,
    category: 0.14,
    views: 0.1,
    recency: 0.1,
    engagement: 0.05,
    completeness: 0.04,
    credibility: 0.04,
    formatFit: 0.03,
  },
  shorts: {
    providerRank: 0.16,
    relevance: 0,
    category: 0,
    views: 0.34,
    recency: 0.22,
    engagement: 0.1,
    completeness: 0.08,
    credibility: 0.1,
    formatFit: 0,
  },
};

export const DIVERSITY = {
  home: { maxConsecutive: 2, maxPerOwner: 3 },
  search: { maxConsecutive: 2, maxPerOwner: 4 },
  category: { maxConsecutive: 2, maxPerOwner: 3 },
  related: { maxConsecutive: 2, maxPerOwner: 4 },
  shorts: { maxConsecutive: 2, maxPerOwner: 2 },
};

const PORTRAIT_MAX_RATIO = 0.8;
const SHORT_MAX_SECONDS = 60;

export function createSeen(seedIds = []) {
  const seen = { ids: new Set(), titles: new Set() };
  for (const id of seedIds) {
    if (isValidVideoId(id)) seen.ids.add(id.toLowerCase());
  }
  return seen;
}

export function isPortrait(video) {
  const ratio = video?.aspectRatio;
  const width = video?.width;
  const height = video?.height;
  const ratioPortrait = Number.isFinite(ratio) && ratio > 0 && ratio <= PORTRAIT_MAX_RATIO;
  const sizePortrait = Number.isFinite(width) && Number.isFinite(height) && height > width && width > 0;
  if (Number.isFinite(width) && Number.isFinite(height) && width > height) return false;
  return ratioPortrait || sizePortrait;
}

/** A Short requires a portrait frame and short duration. Duration alone is not enough. */
export function isVerticalShort(video, maxDuration = SHORT_MAX_SECONDS) {
  if (!video || !isPortrait(video)) return false;
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > maxDuration) return false;
  if (video.allowEmbed === false) return false;
  if (video.explicit === true) return false;
  if (video.mode === "live") return false;
  return true;
}

export function normalizeVideo(raw, providerIndex = 0) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!isValidVideoId(id)) return { ok: false, reason: "invalid_id" };

  const title = asString(raw.title, 300).trim();
  if (!title || normalizeTitle(title).length === 0) return { ok: false, reason: "unusable_title" };

  const thumbnail = firstTrustedMediaUrl([
    raw.thumbnail_720_url,
    raw.thumbnail_480_url,
    raw.thumbnail_360_url,
    raw.thumbnail_240_url,
    raw.thumbnail,
  ]);
  if (!thumbnail) return { ok: false, reason: "invalid_thumbnail" };

  const thumbnailSmall = firstTrustedMediaUrl([
    raw.thumbnail_360_url,
    raw.thumbnail_240_url,
    raw.thumbnail_720_url,
  ]);

  const ownerIdRaw = raw["owner.id"] || raw.owner_id || null;
  const ownerId = isValidOwnerId(ownerIdRaw) ? ownerIdRaw : null;
  const ownerUsername = asString(raw["owner.username"] || raw.owner_username || "", 80).trim();
  const ownerName = asString(raw["owner.screenname"] || raw.owner_screenname || "", 120).trim();
  const ownerAvatar = firstTrustedMediaUrl([
    raw["owner.avatar_80_url"],
    raw["owner.avatar_120_url"],
    raw.owner_avatar,
  ]);
  const verifiedRaw = raw["owner.verified"];
  const ownerVerified = verifiedRaw === true;

  const channel = asString(raw.channel || "", 40).trim().toLowerCase() || null;
  const duration = asNonNegative(raw.duration);
  const created = asNonNegative(raw.created_time);
  const aspectRatio = asNonNegative(raw.aspect_ratio);
  const width = asNonNegative(raw.width);
  const height = asNonNegative(raw.height);

  const video = {
    id,
    title,
    description: asString(raw.description || "", 4000).trim(),
    tags: asStringList(raw.tags),
    duration,
    views: asNonNegative(raw.views_total),
    likes: asNonNegative(raw.likes_total),
    bookmarks: asNonNegative(raw.bookmarks_total),
    commentsCount: asNonNegative(raw.comments_total),
    createdTime: created,
    channel,
    channelLabel: channelLabel(channel),
    aspectRatio,
    width,
    height,
    allowEmbed: asBoolean(raw.allow_embed),
    explicit: raw.explicit === true,
    mode: asString(raw.mode || "", 20).toLowerCase() || null,
    onair: asBoolean(raw.onair),
    audience: asNonNegative(raw.audience),
    language: asString(raw.language || "", 12).toLowerCase() || null,
    thumbnail,
    thumbnailSmall: thumbnailSmall || thumbnail,
    ownerId,
    ownerUsername: ownerUsername || null,
    ownerName: ownerName || "Unknown channel",
    ownerAvatar,
    ownerVerified,
    followers: asNonNegative(raw["owner.followers_total"]),
    providerIndex: Number.isFinite(providerIndex) ? providerIndex : 0,
    ownerKey: ownerId || (ownerUsername ? ownerUsername.toLowerCase() : "") || (ownerName ? ownerName.toLowerCase() : ""),
  };
  video.portrait = isPortrait(video);
  video.short = isVerticalShort(video);
  return { ok: true, video };
}

function titleKey(video) {
  if (!video.ownerKey) return null;
  const normalized = normalizeTitle(video.title);
  if (!normalized) return null;
  return `${video.ownerKey}::${normalized}`;
}

export function remember(seen, video) {
  seen.ids.add(video.id.toLowerCase());
  const key = titleKey(video);
  if (key) seen.titles.add(key);
}

function alreadySeen(seen, video) {
  if (!seen) return false;
  if (seen.ids.has(video.id.toLowerCase())) return true;
  const key = titleKey(video);
  return Boolean(key && seen.titles.has(key));
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function viewsScore(views) {
  if (views == null) return null;
  if (views === 0) return 0.22;
  return 0.22 + 0.78 * clamp01(Math.log10(views + 1) / Math.log10(1_000_001));
}

function recencyScore(createdTime, nowSec) {
  if (createdTime == null) return null;
  const ageDays = (nowSec - createdTime) / 86400;
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 365 * 40) return null;
  return 0.12 + 0.88 * Math.exp(-ageDays / 21);
}

function engagementScore(likes, views) {
  if (likes == null || views == null || views < 80) return null;
  return clamp01((likes / views) / 0.05);
}

function completenessScore(video) {
  let score = 0;
  if (video.title && video.title.length > 8) score += 0.25;
  if (video.description && video.description.length > 40) score += 0.25;
  if (video.tags && video.tags.length > 0) score += 0.2;
  if (video.thumbnail) score += 0.15;
  if (video.duration != null && video.duration > 0) score += 0.15;
  return score;
}

function credibilityScore(video) {
  let score = 0.45;
  if (video.ownerVerified === true) score += 0.3;
  if (video.followers != null && video.followers > 0) {
    score += 0.25 * clamp01(Math.log10(video.followers + 1) / 6);
  }
  return clamp01(score);
}

function formatFitScore(video, mode) {
  if (mode === "shorts") return video.short ? 1 : 0;
  if (video.mode === "live" && video.onair === true) return 0.9;
  if (video.duration == null) return null;
  if (video.duration < 8) return 0.28;
  if (video.duration < 30) return 0.55;
  if (video.duration <= 20 * 60) return 1;
  if (video.duration <= 90 * 60) return 0.78;
  return 0.58;
}

function categoryScore(video, category) {
  if (!category || category.id === "all" || category.kind === "trending") return null;
  if (category.channel && video.channel === category.channel) return 1;
  if (category.preferredChannels?.includes(video.channel)) return 0.72;
  if (category.kind === "channel" || category.kind === "live") return 0.15;
  return 0.4;
}

function providerRankScore(index, total) {
  if (!Number.isFinite(index) || index < 0) return 0.5;
  if (!Number.isFinite(total) || total <= 1) return 1;
  return 1 - (index / (total - 1)) * 0.82;
}

function relatedEnough(video, context, relevance) {
  if (context.mode !== "related") return true;
  const source = context.source;
  if (relevance != null && relevance >= 0.18) return true;
  if (source?.ownerKey && video.ownerKey && video.ownerKey === source.ownerKey) return true;
  if (source?.channel && video.channel && video.channel === source.channel && (relevance == null || relevance >= 0.08)) {
    return true;
  }
  return false;
}

function combine(parts, weights) {
  let weighted = 0;
  let used = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (!weight) continue;
    const value = parts[key];
    if (value == null || !Number.isFinite(value)) continue;
    weighted += weight * clamp01(value);
    used += weight;
  }
  if (used === 0) return 0;
  return weighted / used;
}

export function scoreVideo(video, context) {
  const mode = context.mode || "home";
  const weights = context.weights || RANK_WEIGHTS[mode] || RANK_WEIGHTS.home;
  const nowSec = Number.isFinite(context.now) ? context.now : Date.now() / 1000;
  const queryTokens = context.queryTokens || [];
  const relevance = tokenOverlap(queryTokens, video);
  const source = context.source;
  let sourceBoost = 0;
  if (mode === "related" && source) {
    if (source.ownerKey && video.ownerKey === source.ownerKey) sourceBoost += 0.06;
    if (source.channel && video.channel && video.channel === source.channel) sourceBoost += 0.04;
    const sourceTags = new Set((source.tags || []).flatMap((tag) => meaningfulTokens(tag)));
    if (sourceTags.size) {
      const shared = (video.tags || []).some((tag) => meaningfulTokens(tag).some((token) => sourceTags.has(token)));
      if (shared) sourceBoost += 0.05;
    }
  }

  const parts = {
    providerRank: providerRankScore(video.providerIndex, context.providerTotal || 1),
    relevance,
    category: categoryScore(video, context.category),
    views: viewsScore(video.views),
    recency: recencyScore(video.createdTime, nowSec),
    engagement: engagementScore(video.likes, video.views),
    completeness: completenessScore(video),
    credibility: credibilityScore(video),
    formatFit: formatFitScore(video, mode),
  };

  let score = combine(parts, weights);
  score = clamp01(score + sourceBoost);
  const penalty = spamPenalty(video.title) + (video.allowEmbed === false ? 0.06 : 0) + (video.explicit ? 0.5 : 0);
  score *= 1 - Math.min(0.6, penalty);
  return { score, parts };
}

export function diversify(ranked, options = {}) {
  const maxConsecutive = options.maxConsecutive ?? 2;
  const maxPerOwner = options.maxPerOwner ?? 3;
  const pool = ranked.slice();
  const out = [];
  const counts = new Map();

  const violates = (video, relaxCap) => {
    const key = video.ownerKey || video.id;
    if (maxConsecutive > 0 && out.length >= maxConsecutive) {
      const tail = out.slice(-maxConsecutive);
      if (tail.every((item) => (item.ownerKey || item.id) === key)) return "consecutive";
    }
    if (!relaxCap && maxPerOwner > 0 && (counts.get(key) || 0) >= maxPerOwner) return "cap";
    return null;
  };

  while (pool.length) {
    let picked = -1;
    for (let i = 0; i < pool.length; i += 1) {
      if (!violates(pool[i], false)) {
        picked = i;
        break;
      }
    }
    if (picked === -1) {
      for (let i = 0; i < pool.length; i += 1) {
        if (violates(pool[i], true) !== "consecutive") {
          picked = i;
          break;
        }
      }
    }
    if (picked === -1) picked = 0;
    const [item] = pool.splice(picked, 1);
    out.push(item);
    const key = item.ownerKey || item.id;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return out;
}

function compareRanked(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.providerIndex !== b.providerIndex) return a.providerIndex - b.providerIndex;
  const av = a.views ?? -1;
  const bv = b.views ?? -1;
  if (bv !== av) return bv - av;
  const at = a.createdTime ?? 0;
  const bt = b.createdTime ?? 0;
  if (bt !== at) return bt - at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Validate, dedupe, score, diversify.
 * `seen` is mutated with accepted videos so later pages skip them.
 */
export function processVideos(rawList, context = {}) {
  const mode = context.mode || "home";
  const seen = context.seen || createSeen(context.excludeIds || []);
  const exclude = new Set((context.excludeIds || []).map((id) => String(id).toLowerCase()));
  const rejected = [];
  const accepted = [];
  const list = Array.isArray(rawList) ? rawList : [];

  list.forEach((raw, index) => {
    const normalized = normalizeVideo(raw, Number.isFinite(raw?.providerIndex) ? raw.providerIndex : index);
    if (!normalized.ok) {
      rejected.push({ reason: normalized.reason, index });
      return;
    }
    const video = normalized.video;
    const key = titleKey(video);
    const duplicateInBatch = accepted.some((item) => item.id.toLowerCase() === video.id.toLowerCase() || (key && titleKey(item) === key));
    if (exclude.has(video.id.toLowerCase()) || alreadySeen(seen, video) || duplicateInBatch) {
      rejected.push({ reason: "duplicate", id: video.id });
      return;
    }
    if (video.explicit) {
      rejected.push({ reason: "explicit", id: video.id });
      return;
    }
    if (mode === "shorts" && !video.short) {
      rejected.push({ reason: "not_a_short", id: video.id });
      return;
    }
    accepted.push(video);
  });

  const providerTotal = Math.max(accepted.length, list.length, 1);
  const queryTokens = context.queryTokens || [];
  const scored = [];
  for (const video of accepted) {
    const { score, parts } = scoreVideo(video, { ...context, providerTotal, queryTokens });
    const relevance = parts.relevance;
    if (!relatedEnough(video, context, relevance)) {
      rejected.push({ reason: "low_relevance", id: video.id });
      continue;
    }
    scored.push({ ...video, score, scoreParts: parts });
  }

  scored.sort(compareRanked);
  const diversity = context.diversity || DIVERSITY[mode] || DIVERSITY.home;
  const ranked = context.skipDiversity ? scored : diversify(scored, diversity);
  for (const video of ranked) remember(seen, video);

  return {
    videos: ranked,
    rejected,
    exhaustedInput: list.length === 0,
  };
}
