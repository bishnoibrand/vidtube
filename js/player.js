/**
 * Dailymotion Player SDK wrapper.
 * Progress is recorded only from documented player events (videoTime / videoDuration).
 * The iframe existing is not treated as playback progress.
 */

import { isValidVideoId, playerEmbedUrl } from "./sanitize.js";
import { publicConfig } from "./public-config.js";

let scriptPromise = null;

export function loadPlayerScript(src = publicConfig.playerScript) {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.dailymotion?.createPlayer) return Promise.resolve(window.dailymotion);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-vidtube-player]");
    const script = existing || document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.vidtubePlayer = "1";
    script.onload = () => {
      if (window.dailymotion?.createPlayer) resolve(window.dailymotion);
      else reject(new Error("Player library loaded without an API."));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the Dailymotion player library."));
    };
    if (!existing) document.body.appendChild(script);
  });
  return scriptPromise;
}

function eventName(dm, key) {
  return dm?.events?.[key] || key;
}

export async function destroyPlayer(player, container, { clear = true } = {}) {
  try { await player?.pause?.(); } catch { /* already stopped */ }
  try {
    if (typeof player?.destroy === "function") await player.destroy();
  } catch { /* fall through to DOM removal */ }
  try {
    if (clear && container?.id && typeof window.dailymotion?.destroy === "function") {
      await window.dailymotion.destroy(container.id);
    }
  } catch { /* ignore */ }
  if (clear && container) container.replaceChildren();
}

/**
 * Create a player and attach honest progress / error callbacks.
 * Returns a session handle. Late events from a replaced session are ignored
 * by the caller via the session token they pass in `onEvent`.
 */
export async function createPlayback({
  container,
  videoId,
  startTime = 0,
  aspectRatio = "16:9",
  autoplay = true,
  onEvent,
}) {
  if (!isValidVideoId(videoId)) {
    throw new Error("Invalid video id.");
  }
  if (!container) throw new Error("Missing player container.");

  const dm = await loadPlayerScript();
  if (typeof dm.onScriptLoaded === "function") {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try { dm.onScriptLoaded(done); } catch { done(); }
      setTimeout(done, 1500);
    });
  }

  container.replaceChildren();
  const params = {
    autoplay: Boolean(autoplay),
    scaleMode: "fit",
  };
  if (Number.isFinite(startTime) && startTime >= 1) params.startTime = Math.floor(startTime);

  const player = await dm.createPlayer(container.id, {
    video: videoId,
    params,
  });

  try {
    player.updateParams?.({ aspectRatio });
  } catch { /* aspect ratio is best-effort */ }

  const listen = (key, handler) => {
    const name = eventName(dm, key);
    try { player.on(name, handler); } catch { /* event unsupported */ }
  };

  listen("PLAYER_CRITICALPATHREADY", (state) => onEvent?.("ready", state || {}));
  listen("PLAYER_VIDEOCHANGE", (state) => onEvent?.("videochange", state || {}));
  listen("VIDEO_TIMECHANGE", (state) => onEvent?.("time", state || {}));
  listen("VIDEO_DURATIONCHANGE", (state) => onEvent?.("duration", state || {}));
  listen("VIDEO_END", (state) => onEvent?.("end", state || {}));
  listen("PLAYER_PLAYBACKPERMISSION", (state) => onEvent?.("permission", state || {}));
  listen("PLAYER_ERROR", (state) => onEvent?.("error", state || {}));
  listen("VIDEO_PLAYING", (state) => onEvent?.("playing", state || {}));

  return player;
}

export function fallbackEmbedSrc(videoId) {
  return playerEmbedUrl(videoId);
}

export function readPlaybackSample(state, expectedId) {
  if (!state || typeof state !== "object") return null;
  const id = state.videoId || state.video || null;
  if (expectedId && id && id !== expectedId) return null;
  const time = Number(state.videoTime);
  const duration = Number(state.videoDuration);
  if (!Number.isFinite(time) || time < 0) return null;
  if (!Number.isFinite(duration) || duration <= 0) return { seconds: time, duration: null, ratio: null };
  return {
    seconds: time,
    duration,
    ratio: Math.min(1, time / duration),
  };
}
