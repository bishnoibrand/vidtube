/**
 * Local-only preferences. Nothing here is a platform-wide like,
 * subscription, or view. Malformed storage is discarded rather than thrown.
 */

const LIMITS = {
  history: 80,
  likes: 200,
  later: 100,
  follows: 40,
};

const KEYS = {
  history: "vidtube.history.v1",
  likes: "vidtube.likes.v1",
  later: "vidtube.later.v1",
  follows: "vidtube.follows.v1",
  prefs: "vidtube.prefs.v1",
};

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

export function detectStorage() {
  try {
    if (typeof localStorage === "undefined") return memoryStorage();
    const probe = "__vidtube_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    try { storage.removeItem(key); } catch { /* ignore */ }
    return fallback;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function snapshot(video) {
  if (!video?.id) return null;
  return {
    id: video.id,
    title: video.title || "Untitled",
    ownerName: video.ownerName || "Unknown channel",
    ownerId: video.ownerId || null,
    ownerUsername: video.ownerUsername || null,
    ownerAvatar: video.ownerAvatar || null,
    ownerVerified: video.ownerVerified === true,
    thumbnail: video.thumbnail || null,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    createdTime: Number.isFinite(video.createdTime) ? video.createdTime : null,
    channel: video.channel || null,
    views: Number.isFinite(video.views) ? video.views : null,
  };
}

export function createLibrary(storage = detectStorage()) {
  const prefs = () => {
    const value = readJson(storage, KEYS.prefs, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

  return {
    available: storage !== null,
    getLanguage() {
      const lang = prefs().language;
      return typeof lang === "string" && /^[a-z]{2}$/i.test(lang) ? lang.toLowerCase() : "";
    },
    setLanguage(language) {
      const next = prefs();
      next.language = typeof language === "string" ? language.toLowerCase() : "";
      return writeJson(storage, KEYS.prefs, next);
    },
    getHistory() {
      const list = readJson(storage, KEYS.history, []);
      return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string") : [];
    },
    recordOpen(video) {
      const snap = snapshot(video);
      if (!snap) return this.getHistory();
      const existing = this.getHistory().find((item) => item.id === snap.id);
      const list = this.getHistory().filter((item) => item.id !== snap.id);
      list.unshift({
        ...snap,
        openedAt: Date.now(),
        progress: Number.isFinite(existing?.progress) ? existing.progress : null,
        progressSeconds: Number.isFinite(existing?.progressSeconds) ? existing.progressSeconds : null,
      });
      writeJson(storage, KEYS.history, list.slice(0, LIMITS.history));
      return this.getHistory();
    },
    recordProgress(id, seconds, duration) {
      if (!id || !Number.isFinite(seconds) || seconds < 0) return null;
      if (!Number.isFinite(duration) || duration <= 0) return null;
      const ratio = Math.min(1, Math.max(0, seconds / duration));
      if (ratio < 0.02) return ratio;
      const list = this.getHistory();
      const item = list.find((entry) => entry.id === id);
      if (!item) return ratio;
      item.progress = ratio;
      item.progressSeconds = seconds;
      item.duration = duration;
      writeJson(storage, KEYS.history, list);
      return ratio;
    },
    progressFor(id) {
      const item = this.getHistory().find((entry) => entry.id === id);
      if (!item || !Number.isFinite(item.progress)) return null;
      if (item.progress <= 0 || item.progress > 1) return null;
      return item.progress;
    },
    getLikes() {
      const list = readJson(storage, KEYS.likes, []);
      return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string") : [];
    },
    isLiked(id) {
      return this.getLikes().some((item) => item.id === id);
    },
    toggleLike(video) {
      const snap = snapshot(video);
      if (!snap) return false;
      const list = this.getLikes();
      const index = list.findIndex((item) => item.id === snap.id);
      let liked;
      if (index >= 0) {
        list.splice(index, 1);
        liked = false;
      } else {
        list.unshift({ ...snap, savedAt: Date.now() });
        liked = true;
      }
      writeJson(storage, KEYS.likes, list.slice(0, LIMITS.likes));
      return liked;
    },
    getLater() {
      const list = readJson(storage, KEYS.later, []);
      return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string") : [];
    },
    isLater(id) {
      return this.getLater().some((item) => item.id === id);
    },
    toggleLater(video) {
      const snap = snapshot(video);
      if (!snap) return false;
      const list = this.getLater();
      const index = list.findIndex((item) => item.id === snap.id);
      let saved;
      if (index >= 0) {
        list.splice(index, 1);
        saved = false;
      } else {
        list.unshift({ ...snap, savedAt: Date.now() });
        saved = true;
      }
      writeJson(storage, KEYS.later, list.slice(0, LIMITS.later));
      return saved;
    },
    getFollows() {
      const list = readJson(storage, KEYS.follows, []);
      return Array.isArray(list) ? list.filter((item) => item && typeof item.ownerId === "string") : [];
    },
    isFollowing(ownerId) {
      if (!ownerId) return false;
      return this.getFollows().some((item) => item.ownerId === ownerId);
    },
    toggleFollow(video) {
      if (!video?.ownerId) return { ok: false, following: false, reason: "no_channel_id" };
      const list = this.getFollows();
      const index = list.findIndex((item) => item.ownerId === video.ownerId);
      let following;
      if (index >= 0) {
        list.splice(index, 1);
        following = false;
      } else {
        list.unshift({
          ownerId: video.ownerId,
          ownerUsername: video.ownerUsername || null,
          ownerName: video.ownerName || "Unknown channel",
          ownerAvatar: video.ownerAvatar || null,
          ownerVerified: video.ownerVerified === true,
          followedAt: Date.now(),
        });
        following = true;
      }
      writeJson(storage, KEYS.follows, list.slice(0, LIMITS.follows));
      return { ok: true, following };
    },
  };
}
