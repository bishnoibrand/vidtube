/**
 * Dailymotion public Data API client.
 * No API key is required for these public reads.
 * Responses are status-checked and shape-checked before use.
 */

import { isValidOwnerId, isValidVideoId } from "./sanitize.js";

export const VIDEO_FIELDS = [
  "allow_embed",
  "aspect_ratio",
  "audience",
  "bookmarks_total",
  "channel",
  "comments_total",
  "created_time",
  "description",
  "duration",
  "explicit",
  "height",
  "id",
  "language",
  "likes_total",
  "mode",
  "onair",
  "owner.avatar_80_url",
  "owner.followers_total",
  "owner.id",
  "owner.screenname",
  "owner.username",
  "owner.verified",
  "tags",
  "thumbnail_240_url",
  "thumbnail_360_url",
  "thumbnail_480_url",
  "thumbnail_720_url",
  "title",
  "url",
  "views_total",
  "width",
].join(",");

export class ApiError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = "ApiError";
    this.type = info.type || "unknown";
    this.status = info.status ?? null;
    this.code = info.code ?? null;
    this.retryable = Boolean(info.retryable);
  }
}

export function interpretListResponse(status, body) {
  if (status === 429) {
    return {
      ok: false,
      error: { type: "rate_limit", status, retryable: false, message: "Dailymotion rate-limited this request." },
    };
  }
  if (status === 0) {
    return {
      ok: false,
      error: { type: "network", status, retryable: true, message: "Network request failed." },
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      error: { type: "server", status, retryable: true, message: "Dailymotion returned a server error." },
    };
  }
  if (status >= 400) {
    const message = body?.error?.message || `Dailymotion rejected the request (${status}).`;
    return {
      ok: false,
      error: { type: "client", status, code: body?.error?.code ?? null, retryable: false, message },
    };
  }
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: { type: "invalid", status, retryable: false, message: "Dailymotion returned an unreadable response." },
    };
  }
  if (body.error) {
    const code = Number(body.error.code) || null;
    const retryable = code != null && code >= 500;
    return {
      ok: false,
      error: {
        type: body.error.type || "api",
        status: status || code || 400,
        code,
        retryable,
        message: body.error.message || "Dailymotion returned an API error.",
      },
    };
  }
  if (!Array.isArray(body.list)) {
    return {
      ok: false,
      error: { type: "invalid", status, retryable: false, message: "Dailymotion response did not include a video list." },
    };
  }
  let hasMore = null;
  if (body.has_more === true) hasMore = true;
  else if (body.has_more === false) hasMore = false;
  const page = Number.isFinite(Number(body.page)) ? Number(body.page) : null;
  const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : null;
  const total = Number.isFinite(Number(body.total)) ? Number(body.total) : null;
  return { ok: true, page, limit, hasMore, total, list: body.list };
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The request timed out.", "TimeoutError"));
  }, timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createClient({
  baseUrl = "https://api.dailymotion.com",
  timeoutMs = 12000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available.");
  }

  async function request(path, params, { signal, shape = "list" } = {}) {
    const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const entries = Object.entries(params || {}).filter(([, value]) => value != null && value !== "");
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of entries) url.searchParams.set(key, String(value));

    const timed = withTimeout(signal, timeoutMs);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: timed.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new DOMException("Request aborted.", "AbortError");
      }
      if (error?.name === "TimeoutError") {
        throw new ApiError("The video service took too long to respond.", {
          type: "timeout",
          retryable: true,
        });
      }
      throw new ApiError("Could not reach Dailymotion.", { type: "network", retryable: true });
    } finally {
      timed.cancel();
    }

    const body = await readJson(response);
    const interpreted = shape === "object"
      ? coerceVideoPayload(response.status, body)
      : interpretListResponse(response.status, body);
    if (!interpreted.ok) {
      throw new ApiError(interpreted.error.message, interpreted.error);
    }
    if (interpreted.hasMore == null) {
      const limit = Number(params?.limit) || interpreted.limit || 0;
      interpreted.hasMore = limit > 0 && interpreted.list.length >= limit;
    }
    return interpreted;
  }

  return {
    listVideos(params, options) {
      return request("videos", params, options);
    },
    related(videoId, params, options) {
      if (!isValidVideoId(videoId)) {
        return Promise.reject(new ApiError("Invalid video id.", { type: "client", retryable: false }));
      }
      return request(`video/${encodeURIComponent(videoId)}/related`, params, options);
    },
    video(videoId, options) {
      if (!isValidVideoId(videoId)) {
        return Promise.reject(new ApiError("Invalid video id.", { type: "client", retryable: false }));
      }
      return request(
        `video/${encodeURIComponent(videoId)}`,
        { fields: VIDEO_FIELDS },
        { ...options, shape: "object" },
      ).then((result) => ({ ...result, item: result.list?.[0] || null }));
    },
    comments(videoId, params = {}, options) {
      if (!isValidVideoId(videoId)) {
        return Promise.reject(new ApiError("Invalid video id.", { type: "client", retryable: false }));
      }
      return request(`video/${encodeURIComponent(videoId)}/comments`, {
        fields: "id,message,created_time,owner.screenname",
        limit: params.limit || 20,
      }, options);
    },
    userVideos(ownerId, params, options) {
      if (!isValidOwnerId(ownerId)) {
        return Promise.reject(new ApiError("Invalid channel id.", { type: "client", retryable: false }));
      }
      return request(`user/${encodeURIComponent(ownerId)}/videos`, params, options);
    },
  };
}

/**
 * The single-video endpoint returns an object, not a list.
 * Normalize both shapes so callers can share the list interpreter.
 */
export function coerceVideoPayload(status, body) {
  if (body && typeof body === "object" && !Array.isArray(body) && !body.error && !body.list && body.id) {
    return interpretListResponse(status, {
      page: 1,
      limit: 1,
      has_more: false,
      list: [body],
    });
  }
  return interpretListResponse(status, body);
}
