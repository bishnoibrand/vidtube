import { publicConfig } from "./public-config.js";
import {
  CATEGORIES,
  LANGUAGES,
  buildListParams,
  feedHeading,
  getCategory,
} from "./categories.js";
import { VIDEO_FIELDS, createClient } from "./api.js";
import { createSeen, isVerticalShort, normalizeVideo, processVideos } from "./pipeline.js";
import { createLibrary } from "./storage.js";
import { cleanQuery, isValidVideoId, videoPageUrl } from "./sanitize.js";
import { extractSearchTerms, meaningfulTokens } from "./text.js";
import { detectVideoCommand } from "./ai-intent.js";
import { createPlayback, destroyPlayer, readPlaybackSample } from "./player.js";
import {
  chipButton,
  clear,
  commentItem,
  el,
  fillPlayerDetails,
  navButton,
  recItem,
  shortCard,
  shortSkeletons,
  skeletonCards,
  statusPanel,
  videoCard,
  categoryIcon,
} from "./render.js";
import { icon } from "./icons.js";

const library = createLibrary();
const client = createClient({
  baseUrl: publicConfig.dailymotionApi,
  timeoutMs: publicConfig.requestTimeoutMs,
});

const $ = (id) => document.getElementById(id);

const state = {
  mode: "home",
  categoryId: "all",
  query: "",
  page: 1,
  hasMore: false,
  loading: false,
  error: null,
  seen: createSeen(),
  feedGen: 0,
  feedAbort: null,
  renderedIds: new Set(),
  shorts: [],
  shortsPage: 1,
  shortsHasMore: false,
  shortsGen: 0,
  shortsAbort: null,
  shortsLoading: false,
  shortsIndex: 0,
  shortsSession: 0,
  shortsPlayer: null,
  playerSession: 0,
  player: null,
  currentVideo: null,
  returnHash: "#/",
  recToken: 0,
  recAbort: null,
  recTab: "all",
  recCache: new Map(),
  commentToken: 0,
  commentAbort: null,
  lastProgressWrite: 0,
  aiMessages: [],
  aiBusy: false,
};

const playerNodes = {};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function toast(message) {
  const node = el("div", { class: "toast", text: message });
  $("toasts").append(node);
  setTimeout(() => node.remove(), 3200);
}

function announce(message) {
  $("feed-live").textContent = message;
}

let lastHash = location.hash || "#/";
let watchPushed = false;

function setHash(hash, { push = false } = {}) {
  const next = hash.startsWith("#") ? hash : `#${hash}`;
  lastHash = next;
  if ((location.hash || "#/") === next) return;
  const stateObj = { vidtube: 1 };
  if (push) history.pushState(stateObj, "", next);
  else history.replaceState(stateObj, "", next);
}

function gridEmpty() {
  return $("video-grid").childElementCount === 0;
}

function showLoader(on) {
  $("loader").hidden = !on;
}

function setActiveNav() {
  const current = state.mode === "library"
    ? state.libraryView
    : state.mode === "home" || state.mode === "popular"
      ? "home"
      : state.mode === "search"
        ? ""
        : state.categoryId;
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const on = button.dataset.nav === current;
    button.classList.toggle("active", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".chip").forEach((chip) => {
    const on = state.mode !== "search" && state.mode !== "library" && state.mode !== "popular" && chip.dataset.category === state.categoryId;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function renderChrome() {
  $("menu-btn").append(icon("menu", "header-icon"));
  $("search-form").querySelector(".search-submit").append(icon("search", "header-icon"));
  $("mic-btn").append(icon("mic", "header-icon"));
  $("ai-launch").prepend(icon("spark"));
  $("ai-fab").append(icon("spark"));
  $("ai-close").append(icon("close", "header-icon"));
  $("player-close").append(icon("close", "header-icon"));
  $("shorts-close").append(icon("close", "header-icon"));
  $("shorts-prev").append(icon("back", "header-icon"));
  $("shorts-next").append(icon("chevron", "header-icon"));
  $("ai-form").querySelector("button").append(icon("send", "header-icon"));

  const primary = $("side-primary");
  const items = [
    ["home", "Home", "home", () => goHome()],
    ["shorts", "Shorts", "bolt", () => openShortsShelf()],
    ["following", "Following", "users", () => goLibrary("following")],
    ["history", "History", "history", () => goLibrary("history")],
    ["later", "Watch later", "clock", () => goLibrary("later")],
    ["likes", "Saved videos", "thumb", () => goLibrary("likes")],
  ];
  for (const [id, label, iconName, onClick] of items) {
    primary.append(navButton({ id, label, iconName, active: false, onClick }));
  }
  const explore = $("side-explore");
  for (const category of CATEGORIES.filter((item) => item.sidebar)) {
    explore.append(navButton({
      id: category.id,
      label: category.label,
      iconName: categoryIcon(category.id),
      onClick: () => goCategory(category.id),
    }));
  }
  const chips = $("chips");
  for (const category of CATEGORIES) {
    const button = chipButton(category, { active: category.id === "all", onClick: () => goCategory(category.id) });
    button.dataset.category = category.id;
    chips.append(button);
  }
  const select = $("language");
  for (const language of LANGUAGES) {
    select.append(el("option", { value: language.id, text: language.label }));
  }
  select.value = library.getLanguage();

  playerNodes.heading = $("player-heading");
  playerNodes.title = $("player-title");
  playerNodes.channel = $("player-channel");
  playerNodes.avatar = $("player-avatar");
  playerNodes.followers = $("player-followers");
  playerNodes.verified = $("player-verified");
  playerNodes.stats = $("player-stats");
  playerNodes.description = $("player-description");
  playerNodes.more = $("desc-more");
  playerNodes.follow = $("follow-btn");
  playerNodes.like = $("like-btn");
  playerNodes.later = $("later-btn");

  const tabs = [
    ["all", "All"],
    ["related", "Related"],
    ["channel", "From channel"],
  ];
  for (const [id, label] of tabs) {
    $("rec-tabs").append(el("button", {
      type: "button",
      class: id === "all" ? "ghost-btn" : "ghost-btn",
      text: label,
      role: "tab",
      "data-tab": id,
      "aria-selected": id === "all" ? "true" : "false",
      onclick: () => {
        state.recTab = id;
        document.querySelectorAll("#rec-tabs button").forEach((button) => {
          const on = button.dataset.tab === id;
          button.setAttribute("aria-pressed", on ? "true" : "false");
          button.classList.toggle("primary-btn", on);
          button.classList.toggle("ghost-btn", !on);
        });
        if (state.currentVideo) loadRecommendations(state.currentVideo, id);
      },
    }));
  }
  document.querySelector('#rec-tabs button[data-tab="all"]').classList.add("primary-btn");
  document.querySelector('#rec-tabs button[data-tab="all"]').classList.remove("ghost-btn");

  if (window.SpeechRecognition || window.webkitSpeechRecognition) $("mic-btn").hidden = false;
  appendAi(assistantIntro(), "assistant");
}

function assistantIntro() {
  if (publicConfig.aiProxyUrl) {
    return "I can search VidTube when you start with search, find, or play. Other messages go to the configured AI backend. I can’t watch or download videos.";
  }
  return "AI chat is not configured, so I won’t pretend a model is connected. Commands still work: “search jazz”, “play cooking”, or “show music”.";
}

function appendAi(text, role) {
  const klass = role === "user" ? "bubble user" : role === "system" ? "bubble system" : "bubble assistant";
  const node = el("div", { class: klass, text });
  $("ai-log").append(node);
  $("ai-log").scrollTop = $("ai-log").scrollHeight;
  return node;
}

function goHome() {
  state.returnHash = "#/";
  setHash("#/", { push: true });
  closeDrawers();
  loadHome();
}

function goCategory(id) {
  const category = getCategory(id);
  if (!category) {
    toast("That category is not available.");
    return;
  }
  if (id === "all") return goHome();
  state.returnHash = `#/c/${id}`;
  setHash(`#/c/${id}`, { push: true });
  closeDrawers();
  $("search-input").value = "";
  $("search-clear").hidden = true;
  state.mode = "category";
  state.categoryId = id;
  state.query = "";
  state.libraryView = null;
  showShortsSection(false);
  loadFeed({ reset: true });
}

function goSearch(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return goHome();
  state.returnHash = `#/search/${encodeURIComponent(cleaned)}`;
  setHash(state.returnHash, { push: true });
  state.mode = "search";
  state.query = cleaned;
  state.libraryView = null;
  $("search-input").value = cleaned;
  $("search-clear").hidden = false;
  showShortsSection(false);
  closeDrawers();
  return loadFeed({ reset: true });
}

function goLibrary(view) {
  const views = {
    history: ["History", "Videos you opened in this browser. Progress appears only after the player reports it."],
    later: ["Watch later", "Saved on this device. This is not a Dailymotion playlist."],
    likes: ["Saved videos", "A local list. These are not platform-wide likes."],
    following: ["Following", "Channels you follow on this device. VidTube does not subscribe you on Dailymotion."],
  };
  if (!views[view]) return;
  state.mode = "library";
  state.libraryView = view;
  state.returnHash = `#/library/${view}`;
  setHash(state.returnHash, { push: true });
  state.feedAbort?.abort();
  state.feedGen += 1;
  state.loading = false;
  showLoader(false);
  showShortsSection(false);
  closeDrawers();
  $("feed-title").textContent = views[view][0];
  $("feed-subtitle").textContent = views[view][1];
  clear($("video-grid"));
  clear($("feed-panel"));
  $("load-more").hidden = true;
  $("feed-end").hidden = true;
  setActiveNav();
  if (view === "following") renderFollowing();
  else renderLocalList(view);
}

function showShortsSection(on) {
  $("shorts-section").hidden = !on;
}

function closeDrawers() {
  $("sidebar").classList.remove("open");
  $("backdrop").hidden = true;
  $("menu-btn").setAttribute("aria-expanded", "false");
}

function updateHeading() {
  const category = getCategory(state.categoryId);
  const heading = feedHeading({
    mode: state.mode,
    category: state.mode === "library" ? { label: state.libraryView } : category,
    query: state.query,
  });
  $("feed-title").textContent = heading.title;
  const language = library.getLanguage();
  const langLabel = LANGUAGES.find((item) => item.id === language)?.label;
  $("feed-subtitle").textContent = langLabel && state.mode !== "library"
    ? `${heading.subtitle} · declared language: ${langLabel}`
    : heading.subtitle;
  setActiveNav();
}

async function loadHome() {
  state.mode = "home";
  state.categoryId = "all";
  state.query = "";
  state.libraryView = null;
  $("search-input").value = "";
  $("search-clear").hidden = true;
  showShortsSection(true);
  loadShorts({ reset: true });
  return loadFeed({ reset: true });
}

async function loadPopular() {
  state.mode = "popular";
  state.categoryId = "all";
  state.query = "";
  state.libraryView = null;
  showShortsSection(false);
  return loadFeed({ reset: true });
}

async function loadFeed({ reset = false } = {}) {
  if (state.mode === "library") return [];
  if (!reset && (state.loading || !state.hasMore)) return [];
  const gen = ++state.feedGen;
  state.feedAbort?.abort();
  const abort = new AbortController();
  state.feedAbort = abort;
  if (reset) {
    state.page = 1;
    state.seen = createSeen();
    state.hasMore = true;
    state.error = null;
    state.emptyStreak = 0;
    state.renderedIds = new Set();
    clear($("video-grid"));
    clear($("feed-panel"));
    $("video-grid").append(...skeletonCards(8));
    $("feed-end").hidden = true;
    $("load-more").hidden = true;
    updateHeading();
  }
  state.loading = true;
  showLoader(true);

  const built = buildListParams({
    mode: state.mode === "search" ? "search" : state.mode === "popular" ? "popular" : state.mode === "home" ? "home" : "category",
    categoryId: state.categoryId,
    query: state.query,
    page: state.page,
    limit: publicConfig.pageSize,
    language: library.getLanguage(),
    fields: VIDEO_FIELDS,
  });
  const queryTokens = state.mode === "search"
    ? meaningfulTokens(state.query)
    : built.category?.kind === "search"
      ? meaningfulTokens(built.category.search || "")
      : [];

  let lastError = null;
  let shown = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await client.listVideos(built.params, { signal: abort.signal });
      if (gen !== state.feedGen) return [];
      let processed = processVideos(result.list, {
        mode: state.mode === "search" ? "search" : state.mode === "popular" ? "home" : state.mode === "home" ? "home" : "category",
        category: built.category,
        queryTokens,
        seen: state.seen,
        now: Date.now() / 1000,
      });
      const page = result.page || Number(built.params.page) || state.page;
      state.hasMore = result.hasMore === true && page < publicConfig.maxPages;
      state.page = page + 1;
      if (processed.videos.length === 0 && state.hasMore && result.list.length > 0) {
        const next = await client.listVideos({ ...built.params, page: String(state.page) }, { signal: abort.signal });
        if (gen !== state.feedGen) return [];
        processed = processVideos(next.list, {
          mode: state.mode === "search" ? "search" : state.mode === "home" || state.mode === "popular" ? "home" : "category",
          category: built.category,
          queryTokens,
          seen: state.seen,
          now: Date.now() / 1000,
        });
        const nextPage = next.page || state.page;
        state.hasMore = next.hasMore === true && nextPage < publicConfig.maxPages;
        state.page = nextPage + 1;
      }
      if (reset) clear($("video-grid"));
      appendVideos(processed.videos);
      shown = processed.videos;
      if (processed.videos.length === 0) {
        state.emptyStreak = (state.emptyStreak || 0) + 1;
        if (state.emptyStreak >= 2) state.hasMore = false;
      } else {
        state.emptyStreak = 0;
      }
      lastError = null;
      state.error = null;
      break;
    } catch (error) {
      if (error?.name === "AbortError") return [];
      if (gen !== state.feedGen) return [];
      lastError = error;
      if (error.retryable && attempt === 0) {
        await delay(800);
        if (gen !== state.feedGen) return [];
        continue;
      }
      break;
    }
  }

  if (gen !== state.feedGen) return [];
  state.loading = false;
  showLoader(false);
  if (lastError) {
    state.error = lastError;
    state.hasMore = false;
    if (reset) clear($("video-grid"));
    $("feed-panel").replaceChildren(feedErrorPanel(lastError));
    announce(lastError.message || "Could not load videos.");
    return [];
  }
  clear($("feed-panel"));
  if (gridEmpty()) {
    $("feed-panel").replaceChildren(emptyPanel());
    announce("No videos to show.");
  } else {
    announce(`${$("video-grid").childElementCount} videos loaded.`);
  }
  $("load-more").hidden = !state.hasMore;
  if (!state.hasMore && !gridEmpty()) {
    $("feed-end").hidden = false;
    $("feed-end").textContent = "End of results from Dailymotion for this view.";
  } else {
    $("feed-end").hidden = true;
  }
  if (state.hasMore && state.page <= 3 && !gridEmpty()) {
    requestAnimationFrame(() => {
      const sentinel = $("feed-sentinel");
      const main = $("main");
      if (!sentinel || !main || state.loading || !state.hasMore || state.error) return;
      const visible = sentinel.getBoundingClientRect().top < main.getBoundingClientRect().bottom + 480;
      if (visible) loadFeed({ reset: false });
    });
  }
  return shown;
}

function feedErrorPanel(error) {
  const actions = [{ label: "Retry", primary: true, onClick: () => loadFeed({ reset: true }) }];
  if (state.mode === "home") {
    actions.push({
      label: "Show most viewed this week",
      onClick: () => loadPopular(),
    });
  }
  const message = error?.type === "rate_limit"
    ? "Dailymotion is rate-limiting requests. Wait a moment, then retry. VidTube will not switch to a random topic."
    : error?.type === "timeout"
      ? "The video service timed out. Retry, or check your connection."
      : (error?.message || "Videos could not be loaded.");
  return statusPanel({ title: "Couldn’t load videos", message, actions });
}

function emptyPanel() {
  const language = library.getLanguage();
  let message = "Dailymotion returned no playable videos for this view.";
  if (state.mode === "search") message = `No playable videos matched “${state.query}”.`;
  if (state.categoryId === "live") message = "No live streams are on air right now.";
  if (language) message += " The language filter only includes videos whose uploader declared that language.";
  const actions = [{ label: "Back to trending", primary: true, onClick: () => goHome() }];
  if (language) actions.push({ label: "Clear language filter", onClick: () => { $("language").value = ""; library.setLanguage(""); loadFeed({ reset: true }); if (state.mode === "home") loadShorts({ reset: true }); } });
  return statusPanel({ title: "Nothing to show", message, actions });
}

function appendVideos(videos) {
  const fragment = document.createDocumentFragment();
  for (const video of videos) {
    if (state.renderedIds.has(video.id)) continue;
    state.renderedIds.add(video.id);
    fragment.append(videoCard(video, {
      progress: library.progressFor(video.id),
      onOpen: (item) => openPlayer(item),
    }));
  }
  $("video-grid").append(fragment);
}

function updateCardProgress(id) {
  const progress = library.progressFor(id);
  if (!Number.isFinite(progress)) return;
  const cards = $("video-grid").querySelectorAll(".card");
  cards.forEach((card) => {
    const title = card.querySelector("h3")?.textContent;
    const video = [...state.renderedIds];
    if (!card.dataset.id && title) {
      /* cards are not keyed; update only the open video's matching title is unsafe. */
    }
  });
  document.querySelectorAll(`.card[data-id="${CSS.escape(id)}"] .watch-progress > span`).forEach((bar) => {
    bar.style.width = `${Math.round(progress * 100)}%`;
  });
}

function renderLocalList(view) {
  const items = view === "history" ? library.getHistory() : view === "later" ? library.getLater() : library.getLikes();
  if (!items.length) {
    $("feed-panel").replaceChildren(statusPanel({
      title: "Nothing saved yet",
      message: "This list is stored in this browser only.",
      actions: [{ label: "Browse trending", primary: true, onClick: () => goHome() }],
    }));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const video = { ...item, ownerVerified: item.ownerVerified === true, explicit: false, short: false, portrait: false };
    const card = videoCard(video, { progress: item.progress, onOpen: () => openPlayer(video) });
    card.dataset.id = item.id;
    fragment.append(card);
  }
  $("video-grid").append(fragment);
  announce(`${items.length} saved videos.`);
}

async function renderFollowing() {
  const follows = library.getFollows();
  if (!follows.length) {
    $("feed-panel").replaceChildren(statusPanel({
      title: "No followed channels",
      message: "Follow is stored on this device. Open a video and choose Follow. VidTube cannot change your Dailymotion subscriptions.",
      actions: [{ label: "Browse trending", primary: true, onClick: () => goHome() }],
    }));
    return;
  }
  $("video-grid").append(...skeletonCards(4));
  showLoader(true);
  const gen = ++state.feedGen;
  const abort = new AbortController();
  state.feedAbort = abort;
  try {
    const batches = await Promise.all(follows.slice(0, 8).map(async (follow) => {
      try {
        const result = await client.userVideos(follow.ownerId, {
          fields: VIDEO_FIELDS,
          limit: 4,
          sort: "recent",
          flags: "no_explicit",
        }, { signal: abort.signal });
        return result.list;
      } catch {
        return [];
      }
    }));
    if (gen !== state.feedGen) return;
    const processed = processVideos(batches.flat(), {
      mode: "home",
      seen: createSeen(),
      now: Date.now() / 1000,
      diversity: { maxConsecutive: 1, maxPerOwner: 4 },
    });
    clear($("video-grid"));
    if (!processed.videos.length) {
      $("feed-panel").replaceChildren(statusPanel({
        title: "No recent videos",
        message: "Followed channels did not return public videos.",
        actions: [{ label: "Retry", primary: true, onClick: () => renderFollowing() }],
      }));
      return;
    }
    appendVideos(processed.videos);
  } finally {
    if (gen === state.feedGen) showLoader(false);
  }
}

async function loadShorts({ reset = false } = {}) {
  if (state.mode !== "home") return;
  const gen = ++state.shortsGen;
  state.shortsAbort?.abort();
  const abort = new AbortController();
  state.shortsAbort = abort;
  if (reset) {
    state.shorts = [];
    state.shortsPage = 1;
    state.shortsHasMore = false;
    clear($("shorts-row"));
    clear($("shorts-panel"));
    $("shorts-row").append(...shortSkeletons());
  }
  state.shortsLoading = true;
  const params = {
    fields: VIDEO_FIELDS,
    limit: "30",
    page: String(state.shortsPage),
    flags: "is_vertical,no_explicit",
    shorter_than: "1",
    sort: "recent",
  };
  const language = library.getLanguage();
  if (language) params.languages = language;
  try {
    const result = await client.listVideos(params, { signal: abort.signal });
    if (gen !== state.shortsGen) return;
    const seen = createSeen(state.shorts.map((video) => video.id));
    const processed = processVideos(result.list, {
      mode: "shorts",
      seen,
      now: Date.now() / 1000,
    });
    state.shorts = reset ? processed.videos : state.shorts.concat(processed.videos);
    state.shortsHasMore = result.hasMore === true && state.shortsPage < 4;
    state.shortsPage = (result.page || state.shortsPage) + 1;
    renderShortsRow();
  } catch (error) {
    if (error?.name === "AbortError" || gen !== state.shortsGen) return;
    clear($("shorts-row"));
    $("shorts-panel").replaceChildren(statusPanel({
      title: "Shorts are unavailable",
      message: "VidTube only shows portrait videos of 60 seconds or less. Dailymotion did not return a usable vertical short-form list, so landscape thumbnails were not cropped into fake shorts.",
      actions: [{ label: "Retry", primary: true, onClick: () => loadShorts({ reset: true }) }],
    }));
  } finally {
    if (gen === state.shortsGen) state.shortsLoading = false;
  }
}

function renderShortsRow() {
  clear($("shorts-row"));
  clear($("shorts-panel"));
  if (!state.shorts.length) {
    $("shorts-panel").replaceChildren(statusPanel({
      title: "No shorts right now",
      message: "Dailymotion did not return playable portrait videos of 60 seconds or less. VidTube will not fill this shelf with cropped landscape thumbnails.",
      actions: [{ label: "Retry", primary: true, onClick: () => loadShorts({ reset: true }) }],
    }));
    return;
  }
  for (const video of state.shorts) {
    $("shorts-row").append(shortCard(video, (item) => openShort(item)));
  }
}

function openShortsShelf() {
  closeDrawers();
  if (state.mode !== "home") {
    goHome();
    setTimeout(() => $("shorts-section").scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    return;
  }
  $("shorts-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openShort(video) {
  const index = state.shorts.findIndex((item) => item.id === video.id);
  state.shortsIndex = index >= 0 ? index : 0;
  await closePlayer(false);
  $("shorts-modal").hidden = false;
  document.body.style.overflow = "hidden";
  showShortAt(state.shortsIndex);
}

async function showShortAt(index) {
  if (!state.shorts.length) return;
  if (index >= state.shorts.length && state.shortsHasMore && !state.shortsLoading) {
    await loadShorts({ reset: false });
  }
  if (index < 0 || index >= state.shorts.length) {
    toast(index < 0 ? "This is the first short." : "No more shorts in this batch.");
    return;
  }
  state.shortsIndex = index;
  const video = state.shorts[index];
  if (!isVerticalShort(video)) {
    toast("That item is not a vertical short.");
    return;
  }
  const session = ++state.shortsSession;
  $("shorts-title").textContent = video.title;
  const views = video.views == null ? "Views unavailable" : `${video.views.toLocaleString()} views`;
  $("shorts-by").textContent = `${video.ownerName} · ${views}`;
  $("shorts-status").hidden = false;
  $("shorts-status").replaceChildren(el("div", { class: "spinner" }), el("p", { text: "Loading short…" }));
  const slot = $("shorts-slot");
  try {
    if (state.shortsPlayer) {
      await destroyPlayer(state.shortsPlayer, slot);
      state.shortsPlayer = null;
    }
    const player = await withTimeout(createPlayback({
      container: slot,
      videoId: video.id,
      aspectRatio: "9:16",
      autoplay: true,
      onEvent: (type, payload) => {
        if (session !== state.shortsSession) return;
        if (type === "ready" || type === "playing") $("shorts-status").hidden = true;
        if (type === "error" || payload?.playerError) {
          $("shorts-status").hidden = false;
          $("shorts-status").replaceChildren(el("p", { text: "This short cannot be played here. The publisher or your region may block embedding." }));
        }
      },
    }), 15000, "The short player took too long to start.");
    if (session !== state.shortsSession) {
      await destroyPlayer(player, slot, { clear: false });
      return;
    }
    state.shortsPlayer = player;
    try { await player.updateParams?.({ aspectRatio: "9:16" }); } catch { /* optional */ }
    library.recordOpen(video);
  } catch (error) {
    if (session !== state.shortsSession) return;
    $("shorts-status").hidden = false;
    $("shorts-status").replaceChildren(
      el("p", { text: error.message || "The short player failed to start." }),
      el("button", { type: "button", class: "ghost-btn", text: "Retry", onclick: () => showShortAt(index) }),
    );
  }
}

async function closeShorts() {
  state.shortsSession += 1;
  const player = state.shortsPlayer;
  state.shortsPlayer = null;
  $("shorts-modal").hidden = true;
  document.body.style.overflow = "";
  await destroyPlayer(player, $("shorts-slot"));
}

async function openPlayer(video, { hashAlready = false } = {}) {
  if (!isValidVideoId(video?.id)) {
    toast("That video id is not valid.");
    return;
  }
  await closeShorts();
  if (!hashAlready && !location.hash.startsWith("#/watch/")) {
    state.returnHash = location.hash || "#/";
  }
  if (!hashAlready) {
    const alreadyWatching = location.hash.startsWith("#/watch/");
    setHash(`#/watch/${video.id}`, { push: !alreadyWatching });
    if (!alreadyWatching) watchPushed = true;
  }
  state.currentVideo = video;
  library.recordOpen(video);
  $("player-modal").hidden = false;
  document.body.style.overflow = "hidden";
  fillPlayerDetails(video, playerNodes, library);
  const page = videoPageUrl(video.id);
  $("dm-link").href = page || "https://www.dailymotion.com";
  $("player-close").focus();
  loadRecommendations(video, state.recTab || "all");
  loadComments(video);
  await startPlayback(video);
}

async function openVideoById(id) {
  if (!isValidVideoId(id)) {
    toast("That video link is not valid.");
    return;
  }
  if (state.currentVideo?.id === id && !$("player-modal").hidden) return;
  const known = findKnown(id);
  if (known) return openPlayer(known, { hashAlready: true });
  $("player-modal").hidden = false;
  $("player-title").textContent = "Loading video…";
  $("player-heading").textContent = "Loading video…";
  try {
    const result = await client.video(id);
    const normalized = normalizeVideo(result.item, 0);
    if (!normalized.ok) throw new Error("This video is missing a title or thumbnail, so it cannot be opened.");
    await openPlayer(normalized.video, { hashAlready: true });
  } catch (error) {
    $("player-status").hidden = false;
    $("player-status").replaceChildren(el("p", { text: error.message || "Could not load that video." }));
  }
}

function findKnown(id) {
  const pools = [state.shorts, library.getHistory(), library.getLikes(), library.getLater()];
  for (const pool of pools) {
    const found = pool.find((item) => item.id === id);
    if (found?.title && found?.thumbnail) return found;
  }
  return null;
}

async function startPlayback(video) {
  const session = ++state.playerSession;
  const slot = $("player-slot");
  $("player-status").hidden = false;
  $("player-status").replaceChildren(el("div", { class: "spinner" }), el("p", { text: "Loading player…" }));
  if (video.allowEmbed === false) {
    $("player-status").replaceChildren(
      el("p", { text: "The publisher has disabled embedding for this video." }),
      el("a", { href: videoPageUrl(video.id), target: "_blank", rel: "noopener noreferrer", text: "Watch on Dailymotion" }),
    );
    return;
  }
  try {
    if (state.player) {
      await destroyPlayer(state.player, slot);
      state.player = null;
    }
    const progress = library.progressFor(video.id);
    const startTime = progress && video.duration && progress < 0.92 ? Math.floor(progress * video.duration) : 0;
    const player = await withTimeout(createPlayback({
      container: slot,
      videoId: video.id,
      startTime,
      aspectRatio: "16:9",
      autoplay: true,
      onEvent: (type, payload) => onPlayerEvent(session, video.id, type, payload),
    }), 15000, "The player took too long to start. Embedding may be blocked.");
    if (session !== state.playerSession) {
      await destroyPlayer(player, slot, { clear: false });
      return;
    }
    state.player = player;
    setTimeout(() => {
      if (session === state.playerSession) $("player-status").hidden = true;
    }, 9000);
  } catch (error) {
    if (session !== state.playerSession) return;
    $("player-status").hidden = false;
    $("player-status").replaceChildren(
      el("p", { text: error.message || "Playback failed. Embedding may be blocked for this video or region." }),
      el("button", { type: "button", class: "ghost-btn", text: "Retry", onclick: () => startPlayback(video) }),
      el("a", { href: videoPageUrl(video.id), target: "_blank", rel: "noopener noreferrer", text: "Watch on Dailymotion" }),
    );
  }
}

function onPlayerEvent(session, videoId, type, payload) {
  if (session !== state.playerSession) return;
  if (type === "ready" || type === "playing") $("player-status").hidden = true;
  if (type === "error" || payload?.playerError) {
    const message = payload?.playerError?.message || payload?.message || "The player reported an error. This video may be restricted.";
    $("player-status").hidden = false;
    $("player-status").replaceChildren(el("p", { text: message }));
    return;
  }
  if (type === "videochange" && payload?.videoId && payload.videoId !== videoId && isValidVideoId(payload.videoId)) {
    syncChangedVideo(payload.videoId, session);
    return;
  }
  if (type === "time" || type === "end") {
    const now = Date.now();
    if (type !== "end" && now - state.lastProgressWrite < 2000) return;
    state.lastProgressWrite = now;
    captureProgress(session, videoId, type === "end");
  }
}

async function captureProgress(session, videoId, ended) {
  if (!state.player || session !== state.playerSession) return;
  try {
    const playerState = await state.player.getState();
    if (session !== state.playerSession) return;
    if (playerState?.videoId && playerState.videoId !== videoId) return;
    const sample = readPlaybackSample(playerState, videoId);
    if (!sample?.duration) return;
    const seconds = ended ? sample.duration : sample.seconds;
    const ratio = library.recordProgress(videoId, seconds, sample.duration);
    if (Number.isFinite(ratio)) paintProgress(videoId, ratio);
  } catch {
    /* Player state is unavailable; do not invent progress. */
  }
}

function paintProgress(id, ratio) {
  document.querySelectorAll(".card").forEach((card) => {
    if (card.dataset.id !== id) return;
    let bar = card.querySelector(".watch-progress");
    if (!bar) {
      bar = el("span", { class: "watch-progress" }, [el("span")]);
      card.querySelector(".thumb")?.append(bar);
    }
    const fill = bar.querySelector("span");
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
  });
}

async function syncChangedVideo(id, session) {
  try {
    const result = await client.video(id);
    if (session !== state.playerSession) return;
    const normalized = normalizeVideo(result.item, 0);
    if (!normalized.ok) return;
    state.currentVideo = normalized.video;
    fillPlayerDetails(normalized.video, playerNodes, library);
    setHash(`#/watch/${id}`);
    loadRecommendations(normalized.video, state.recTab || "all");
    loadComments(normalized.video);
  } catch {
    /* Keep the previous title rather than showing a mismatched guess. */
  }
}

async function closePlayer(restoreHash = true) {
  state.playerSession += 1;
  state.recToken += 1;
  state.commentToken += 1;
  state.recAbort?.abort();
  state.commentAbort?.abort();
  const player = state.player;
  state.player = null;
  state.currentVideo = null;
  $("player-modal").hidden = true;
  if ($("shorts-modal").hidden) document.body.style.overflow = "";
  await destroyPlayer(player, $("player-slot"));
  if (restoreHash && watchPushed) {
    watchPushed = false;
    history.back();
  } else if (restoreHash) {
    setHash(state.returnHash || "#/", { push: false });
  }
}

async function loadRecommendations(video, tab) {
  const token = ++state.recToken;
  state.recAbort?.abort();
  const abort = new AbortController();
  state.recAbort = abort;
  const cacheKey = `${video.id}:${tab}`;
  const cached = state.recCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    renderRecList(cached.videos, cached.note, token);
    return;
  }
  $("rec-note").textContent = "Loading recommendations…";
  $("rec-list").replaceChildren(el("div", { class: "loader" }, [el("div", { class: "spinner" })]));
  try {
    const terms = extractSearchTerms(video);
    let raw = [];
    let note = "";
    if (tab === "channel") {
      if (!video.ownerId) {
        if (token !== state.recToken) return;
        $("rec-note").textContent = "";
        $("rec-list").replaceChildren(statusPanel({
          title: "Channel unavailable",
          message: "This video has no channel id, so other uploads cannot be listed.",
        }));
        return;
      }
      const result = await client.userVideos(video.ownerId, {
        fields: VIDEO_FIELDS,
        limit: 16,
        sort: "recent",
        flags: "no_explicit",
      }, { signal: abort.signal });
      raw = result.list;
      note = "Other public videos from this channel.";
    } else if (tab === "related") {
      const result = await client.related(video.id, { fields: VIDEO_FIELDS, limit: 20 }, { signal: abort.signal });
      raw = result.list;
      note = "Related videos from Dailymotion, re-ranked. Unrelated results are left out.";
    } else {
      const [relatedResult, searchResult] = await Promise.allSettled([
        client.related(video.id, { fields: VIDEO_FIELDS, limit: 20 }, { signal: abort.signal }),
        terms.length
          ? client.listVideos({
            fields: VIDEO_FIELDS,
            search: terms.join(" "),
            sort: "relevance",
            limit: 12,
            flags: "no_explicit",
          }, { signal: abort.signal })
          : Promise.resolve({ list: [] }),
      ]);
      if (relatedResult.status === "fulfilled") raw = raw.concat(relatedResult.value.list || []);
      if (searchResult.status === "fulfilled") raw = raw.concat(searchResult.value.list || []);
      if (!raw.length && relatedResult.status === "rejected" && (searchResult.status === "rejected" || !terms.length)) {
        throw relatedResult.reason || new Error("Recommendations failed.");
      }
      note = terms.length
        ? `Matched on ${terms.join(", ")} plus Dailymotion related videos.`
        : "Dailymotion related videos. The title did not yield extra search terms.";
    }
    if (token !== state.recToken) return;
    const processed = processVideos(raw, {
      mode: tab === "channel" ? "category" : "related",
      source: video,
      queryTokens: terms,
      excludeIds: [video.id],
      seen: createSeen([video.id]),
      category: video.channel ? { id: video.channel, channel: video.channel, kind: "channel", preferredChannels: [video.channel] } : null,
      now: Date.now() / 1000,
    });
    state.recCache.set(cacheKey, { at: Date.now(), videos: processed.videos, note });
    renderRecList(processed.videos, note, token);
    if (tab === "all" && state.player && state.currentVideo?.id === video.id) {
      try { await state.player.setCustomRecommendations?.(processed.videos.slice(0, 8).map((item) => item.id)); } catch { /* optional */ }
    }
  } catch (error) {
    if (error?.name === "AbortError" || token !== state.recToken) return;
    $("rec-note").textContent = "";
    $("rec-list").replaceChildren(statusPanel({
      title: "Recommendations failed",
      message: error.message || "Related videos could not be loaded.",
      actions: [{ label: "Retry", primary: true, onClick: () => loadRecommendations(video, tab) }],
    }));
  }
}

function renderRecList(videos, note, token) {
  if (token != null && token !== state.recToken) return;
  $("rec-note").textContent = note || "";
  if (!videos.length) {
    $("rec-list").replaceChildren(statusPanel({
      title: "No related videos",
      message: "Nothing returned was close enough to this video to recommend. VidTube will not fill this list with unrelated results.",
    }));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const video of videos) fragment.append(recItem(video, (item) => openPlayer(item)));
  $("rec-list").replaceChildren(fragment);
}

async function loadComments(video) {
  const token = ++state.commentToken;
  state.commentAbort?.abort();
  const abort = new AbortController();
  state.commentAbort = abort;
  $("comments-heading").textContent = "Comments";
  $("comments-list").replaceChildren(el("p", { class: "notice", text: "Loading comments…" }));
  try {
    const result = await client.comments(video.id, { limit: 20 }, { signal: abort.signal });
    if (token !== state.commentToken) return;
    const count = Number.isFinite(result.total) ? result.total : video.commentsCount;
    $("comments-heading").textContent = Number.isFinite(count) ? `Comments · ${count}` : "Comments";
    const nodes = result.list.map(commentItem).filter(Boolean);
    if (!nodes.length) {
      $("comments-list").replaceChildren(el("p", { class: "notice", text: "No comments were returned for this video." }));
      return;
    }
    $("comments-list").replaceChildren(...nodes);
  } catch (error) {
    if (error?.name === "AbortError" || token !== state.commentToken) return;
    $("comments-list").replaceChildren(el("p", { class: "notice", text: "Comments are unavailable for this video." }));
  }
}

async function copyShare() {
  const video = state.currentVideo;
  if (!video) return;
  const local = `${location.origin}${location.pathname}#/watch/${video.id}`;
  const remote = videoPageUrl(video.id);
  const text = remote ? `${local}\n${remote}` : local;
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied.");
  } catch {
    toast(remote || local);
  }
}

function toggleAi(force) {
  const panel = $("ai-panel");
  const open = typeof force === "boolean" ? force : panel.hidden;
  panel.hidden = !open;
  $("ai-fab").setAttribute("aria-expanded", open ? "true" : "false");
  $("ai-launch").setAttribute("aria-expanded", open ? "true" : "false");
  if (open) $("ai-input").focus();
}

async function sendAi(event) {
  event?.preventDefault();
  const text = $("ai-input").value.trim();
  if (!text || state.aiBusy) return;
  $("ai-input").value = "";
  appendAi(text, "user");
  const command = detectVideoCommand(text);
  if (command) {
    await runCommand(command);
    return;
  }
  if (!publicConfig.aiProxyUrl) {
    appendAi("AI chat is not configured. I did not send that message anywhere. Try “search” or “show music” to use VidTube directly.", "assistant");
    return;
  }
  state.aiBusy = true;
  const pending = appendAi("Thinking…", "system");
  state.aiMessages.push({ role: "user", content: text.slice(0, 2000) });
  state.aiMessages = state.aiMessages.slice(-8);
  try {
    const response = await fetch(publicConfig.aiProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ messages: state.aiMessages }),
    });
    const data = await response.json().catch(() => null);
    pending.remove();
    if (!response.ok || !data || typeof data.reply !== "string") {
      const reason = data?.error === "ai_not_configured"
        ? "The AI proxy is deployed but has no provider key configured."
        : "The AI backend did not return a reply. Nothing was played or searched.";
      appendAi(reason, "assistant");
      state.aiMessages.pop();
      return;
    }
    const reply = data.reply.slice(0, 4000);
    state.aiMessages.push({ role: "assistant", content: reply });
    appendAi(reply, "assistant");
  } catch {
    pending.remove();
    state.aiMessages.pop();
    appendAi("Could not reach the AI proxy. Check that aiProxyUrl points at a running server.", "assistant");
  } finally {
    state.aiBusy = false;
  }
}

async function runCommand(command) {
  if (command.type === "category") {
    appendAi(`Opening ${command.categoryId === "all" ? "trending" : command.categoryId}.`, "system");
    goCategory(command.categoryId);
    return;
  }
  appendAi(`Searching VidTube for “${command.query}”.`, "system");
  const videos = await goSearch(command.query);
  if (command.type === "play") {
    if (!videos?.length) {
      appendAi(`I searched for “${command.query}” but did not find a playable video, so nothing was played.`, "assistant");
      return;
    }
    await openPlayer(videos[0]);
    appendAi(`Opened “${videos[0].title}” from the search results.`, "assistant");
    return;
  }
  appendAi(videos?.length ? `Showing ${videos.length} results for “${command.query}”.` : `No playable results for “${command.query}”.`, "assistant");
}

function bindEvents() {
  $("logo-btn").addEventListener("click", () => goHome());
  $("menu-btn").addEventListener("click", () => {
    const open = $("sidebar").classList.toggle("open");
    $("backdrop").hidden = !open;
    $("menu-btn").setAttribute("aria-expanded", open ? "true" : "false");
  });
  $("backdrop").addEventListener("click", closeDrawers);
  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = cleanQuery($("search-input").value);
    if (!query) goHome();
    else goSearch(query);
  });
  $("search-input").addEventListener("input", () => {
    $("search-clear").hidden = !$("search-input").value;
  });
  $("search-clear").addEventListener("click", () => {
    $("search-input").value = "";
    $("search-clear").hidden = true;
    $("search-input").focus();
    if (state.mode === "search") goHome();
  });
  $("mic-btn").addEventListener("click", startVoice);
  $("language").addEventListener("change", () => {
    library.setLanguage($("language").value);
    if (state.mode === "library") return;
    loadFeed({ reset: true });
    if (state.mode === "home") loadShorts({ reset: true });
  });
  $("load-more").addEventListener("click", () => loadFeed({ reset: false }));
  $("player-close").addEventListener("click", () => closePlayer(true));
  $("follow-btn").addEventListener("click", () => {
    const video = state.currentVideo;
    if (!video) return;
    const result = library.toggleFollow(video);
    if (!result.ok) {
      toast("This channel cannot be followed because it has no id.");
      return;
    }
    fillPlayerDetails(video, playerNodes, library);
    toast(result.following ? `Following ${video.ownerName} on this device.` : `Removed ${video.ownerName} from follows on this device.`);
  });
  $("like-btn").addEventListener("click", () => {
    const video = state.currentVideo;
    if (!video) return;
    const liked = library.toggleLike(video);
    fillPlayerDetails(video, playerNodes, library);
    toast(liked ? "Saved on this device." : "Removed from saved videos on this device.");
  });
  $("later-btn").addEventListener("click", () => {
    const video = state.currentVideo;
    if (!video) return;
    const saved = library.toggleLater(video);
    fillPlayerDetails(video, playerNodes, library);
    toast(saved ? "Added to Watch later on this device." : "Removed from Watch later.");
  });
  $("share-btn").addEventListener("click", copyShare);
  $("desc-more").addEventListener("click", () => {
    const clamped = playerNodes.description.classList.toggle("clamped");
    $("desc-more").textContent = clamped ? "Show more" : "Show less";
  });
  $("shorts-close").addEventListener("click", closeShorts);
  $("shorts-prev").addEventListener("click", () => showShortAt(state.shortsIndex - 1));
  $("shorts-next").addEventListener("click", () => showShortAt(state.shortsIndex + 1));
  $("ai-launch").addEventListener("click", () => toggleAi());
  $("ai-fab").addEventListener("click", () => toggleAi());
  $("ai-close").addEventListener("click", () => toggleAi(false));
  $("ai-form").addEventListener("submit", sendAi);
  document.addEventListener("keydown", onKeydown);

  const main = $("main");
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      if (!state.loading && state.hasMore && !state.error && state.mode !== "library") {
        loadFeed({ reset: false });
      }
    }
  }, { root: main, rootMargin: "500px" });
  observer.observe($("feed-sentinel"));

  let touchX = null;
  $("shorts-modal").addEventListener("touchstart", (event) => {
    touchX = event.changedTouches[0].clientY;
  }, { passive: true });
  $("shorts-modal").addEventListener("touchend", (event) => {
    if (touchX == null) return;
    const delta = event.changedTouches[0].clientY - touchX;
    touchX = null;
    if (delta < -40) showShortAt(state.shortsIndex + 1);
    else if (delta > 40) showShortAt(state.shortsIndex - 1);
  }, { passive: true });
}

function startVoice() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    toast("Voice search is not available in this browser.");
    return;
  }
  const recognition = new Ctor();
  recognition.lang = library.getLanguage() ? library.getLanguage() : navigator.language || "en";
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    $("search-input").value = transcript;
    $("search-clear").hidden = !transcript;
    if (cleanQuery(transcript)) goSearch(transcript);
  };
  recognition.onerror = () => toast("Voice search failed.");
  try { recognition.start(); toast("Listening…"); } catch { toast("Voice search could not start."); }
}

function onKeydown(event) {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
  if (event.key === "/" && !typing) {
    event.preventDefault();
    $("search-input").focus();
    return;
  }
  if (event.key === "Escape") {
    if (!$("shorts-modal").hidden) closeShorts();
    else if (!$("player-modal").hidden) closePlayer(true);
    else if (!$("ai-panel").hidden) toggleAi(false);
    else closeDrawers();
    return;
  }
  if (!$("shorts-modal").hidden && !typing) {
    if (event.key === "ArrowDown" || event.key === "j") showShortAt(state.shortsIndex + 1);
    if (event.key === "ArrowUp" || event.key === "k") showShortAt(state.shortsIndex - 1);
  }
}

function route({ fromHistory = false } = {}) {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const gridHasVideos = $("video-grid").childElementCount > 0;
  if (raw === "/" || raw === "") {
    if (fromHistory && state.mode === "home" && gridHasVideos) {
      showShortsSection(true);
      updateHeading();
      return;
    }
    return loadHome();
  }
  if (raw.startsWith("/c/")) {
    const id = decodeURIComponent(raw.slice(3));
    if (!getCategory(id)) {
      toast("That category is not available.");
      return loadHome();
    }
    if (fromHistory && state.mode === "category" && state.categoryId === id && gridHasVideos) {
      updateHeading();
      return;
    }
    return goCategory(id);
  }
  if (raw.startsWith("/search/")) {
    const query = cleanQuery(decodeURIComponent(raw.slice(8).replace(/\+/g, " ")));
    if (!query) return loadHome();
    if (fromHistory && state.mode === "search" && state.query === query && gridHasVideos) {
      updateHeading();
      return;
    }
    return goSearch(query);
  }
  if (raw.startsWith("/watch/")) {
    const id = raw.slice(7);
    if (state.mode === "library") {
      /* keep library underneath */
    } else if (!$("video-grid").childElementCount) {
      loadHome();
    }
    return openVideoById(id);
  }
  if (raw.startsWith("/library/")) return goLibrary(raw.slice(9));
  return loadHome();
}

function boot() {
  renderChrome();
  bindEvents();
  if (location.hash && location.hash !== "#/") route();
  else loadHome();
  window.addEventListener("popstate", () => {
    const hash = location.hash || "#/";
    if (hash === lastHash) return;
    lastHash = hash;
    if (!$("shorts-modal").hidden) closeShorts();
    if (!$("player-modal").hidden && !hash.startsWith("#/watch/")) closePlayer(false);
    route({ fromHistory: true });
  });
}

boot();
