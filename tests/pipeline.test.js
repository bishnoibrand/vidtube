import assert from "node:assert/strict";
import test from "node:test";
import { buildListParams, getCategory } from "../js/categories.js";
import { createSeen, isVerticalShort, normalizeVideo, processVideos } from "../js/pipeline.js";
import { VIDEO_FIELDS } from "../js/api.js";

const thumb = "https://s1.dmcdn.net/v/example/x720";

function raw(overrides = {}, index = 0) {
  return {
    id: `x${(index + 10).toString(36)}a`,
    title: `Useful video ${index}`,
    description: "A real description with enough detail to be complete for ranking tests.",
    thumbnail_720_url: thumb,
    duration: 600,
    views_total: 1000 + index,
    likes_total: 10,
    created_time: 1_700_000_000 - index * 86_400,
    channel: "tech",
    allow_embed: true,
    explicit: false,
    mode: "vod",
    "owner.id": "xowner1",
    "owner.username": "owner",
    "owner.screenname": "Owner",
    "owner.verified": false,
    tags: ["tech"],
    ...overrides,
  };
}

test("home request is trending and never searches for the word Trending", () => {
  const { params } = buildListParams({
    mode: "home",
    categoryId: "all",
    query: "Trending",
    page: 1,
    limit: 20,
    fields: VIDEO_FIELDS,
  });
  assert.equal(params.sort, "trending");
  assert.equal(params.search, undefined);
  assert.equal(params.flags, "no_explicit");
});

test("category mappings use channel ids or explicit searches, not the button label", () => {
  const music = buildListParams({ mode: "category", categoryId: "music", page: 1, limit: 20, fields: "id" });
  assert.equal(music.params.channel, "music");
  assert.equal(music.params.search, undefined);
  assert.equal(music.params.sort, "trending");

  const live = buildListParams({ mode: "category", categoryId: "live", page: 1, limit: 20, fields: "id" });
  assert.equal(live.params.flags, "live_onair,no_explicit");
  assert.equal(live.params.sort, "live-audience");
  assert.equal(live.params.search, undefined);

  const programming = buildListParams({ mode: "category", categoryId: "programming", page: 1, limit: 20, fields: "id" });
  assert.equal(programming.params.search, "programming");
  assert.equal(programming.params.sort, "relevance");

  const gadgets = buildListParams({ mode: "category", categoryId: "gadgets", page: 1, limit: 20, fields: "id" });
  assert.equal(gadgets.params.channel, "tech");
  assert.equal(getCategory("comedy").channel, "fun");
  assert.equal(getCategory("sports").channel, "sport");
  assert.equal(getCategory("education").channel, "school");
  assert.equal(getCategory("gaming").channel, "videogames");
});

test("search is separate from the active category", () => {
  const searched = buildListParams({
    mode: "search",
    categoryId: "music",
    query: "piano",
    page: 2,
    limit: 20,
    fields: "id",
  });
  assert.equal(searched.params.search, "piano");
  assert.equal(searched.params.sort, "relevance");
  assert.equal(searched.params.channel, undefined);
});

test("rejects missing ids, bad thumbnails, and empty titles without throwing", () => {
  const result = processVideos([
    null,
    { title: "No id", thumbnail_720_url: thumb },
    { id: "not-an-id", title: "Bad", thumbnail_720_url: thumb },
    { id: "xokvideo", title: "   ", thumbnail_720_url: thumb },
    { id: "xokvideo", title: "Javascript thumb", thumbnail_720_url: "javascript:alert(1)" },
    { id: "xokvideo", title: "Http thumb", thumbnail_720_url: "http://s1.dmcdn.net/v/example/x720" },
    { id: "xokvideo", title: "Foreign thumb", thumbnail_720_url: "https://evil.example/thumb.jpg" },
    raw({ id: "xgoodvid", title: "Playable clip" }),
  ], { mode: "home", seen: createSeen(), now: 1_700_000_100 });
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].id, "xgoodvid");
  assert.ok(result.rejected.some((item) => item.reason === "invalid_id"));
  assert.ok(result.rejected.some((item) => item.reason === "invalid_thumbnail"));
});

test("dedupes same id and same title on the same channel, but keeps the same title elsewhere", () => {
  const seen = createSeen();
  const first = processVideos([
    raw({ id: "xaaaaaa", title: "Same Title", "owner.id": "xowner1" }),
    raw({ id: "xaaaaaa", title: "Same Title", "owner.id": "xowner1" }),
    raw({ id: "xbbbbbb", title: "Same Title!", "owner.id": "xowner1" }),
    raw({ id: "xcccccc", title: "Same Title", "owner.id": "xowner2", "owner.screenname": "Other" }),
  ], { mode: "home", seen, now: 1_700_000_100 });
  assert.deepEqual(first.videos.map((video) => video.id).sort(), ["xaaaaaa", "xcccccc"]);
  const second = processVideos([
    raw({ id: "xaaaaaa", title: "Same Title" }),
    raw({ id: "xdddddd", title: "Fresh video", "owner.id": "xowner3", "owner.screenname": "Third" }),
  ], { mode: "home", seen, now: 1_700_000_100 });
  assert.deepEqual(second.videos.map((video) => video.id), ["xdddddd"]);
});

test("ranking is deterministic and does not use randomness", () => {
  const list = [0, 1, 2, 3, 4].map((index) => raw({
    id: `xrank${index}a`,
    title: `Clip ${index}`,
    views_total: index % 2 === 0 ? 50 : 5000,
    "owner.id": `xown${index}`,
    "owner.screenname": `Owner ${index}`,
  }));
  const a = processVideos(list, { mode: "home", seen: createSeen(), now: 1_700_000_100 });
  const b = processVideos(list, { mode: "home", seen: createSeen(), now: 1_700_000_100 });
  assert.deepEqual(a.videos.map((video) => video.id), b.videos.map((video) => video.id));
});

test("diversity breaks up a channel without discarding the rest", () => {
  const list = [];
  for (let i = 0; i < 6; i += 1) {
    list.push(raw({
      id: `xdom${i}aa`,
      title: `Dominant ${i} unique`,
      views_total: 1_000_000 - i,
      "owner.id": "xdominant",
      "owner.screenname": "Dominant",
    }));
  }
  for (let i = 0; i < 4; i += 1) {
    list.push(raw({
      id: `xoth${i}aa`,
      title: `Other ${i} unique`,
      views_total: 2000 - i,
      "owner.id": `xother${i}`,
      "owner.screenname": `Other ${i}`,
    }));
  }
  const result = processVideos(list, { mode: "home", seen: createSeen(), now: 1_700_000_100 });
  assert.equal(result.videos.length, 10);
  assert.notEqual(result.videos[2].ownerId, "xdominant");
  assert.equal(result.videos.filter((video) => video.ownerId !== "xdominant").length, 4);
});

test("a relevant new video can outrank an irrelevant popular one in search", () => {
  const now = 1_760_000_000;
  const result = processVideos([
    raw({
      id: "xpopular",
      title: "Unrelated celebrity gossip",
      views_total: 5_000_000,
      created_time: now - 86400 * 400,
      channel: "people",
      "owner.id": "xbig",
      "owner.screenname": "Big",
      providerIndex: 0,
    }),
    raw({
      id: "xnewbie1",
      title: "Programming basics for beginners",
      description: "A programming walkthrough.",
      views_total: 0,
      created_time: now - 3600,
      channel: "tech",
      "owner.id": "xnew",
      "owner.screenname": "New",
      tags: ["programming"],
      providerIndex: 1,
    }),
  ], {
    mode: "search",
    queryTokens: ["programming"],
    seen: createSeen(),
    now,
  });
  assert.equal(result.videos[0].id, "xnewbie1");
});

test("missing optional stats do not throw and are not invented", () => {
  const normalized = normalizeVideo({
    id: "xminimal",
    title: "Minimal playable video",
    thumbnail_240_url: "https://s2.dmcdn.net/v/example/x240",
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.video.views, null);
  assert.equal(normalized.video.likes, null);
  assert.equal(normalized.video.createdTime, null);
  assert.equal(normalized.video.ownerVerified, false);
  assert.equal(normalized.video.duration, null);
  const ranked = processVideos([normalized.video && {
    id: "xminimal",
    title: "Minimal playable video",
    thumbnail_240_url: "https://s2.dmcdn.net/v/example/x240",
  }], { mode: "home", seen: createSeen(), now: 1_700_000_000 });
  assert.equal(ranked.videos.length, 1);
  assert.equal(ranked.videos[0].ownerVerified, false);
});

test("shorts require portrait format, not merely a short duration", () => {
  const landscape = normalizeVideo(raw({
    id: "xlandsca",
    duration: 20,
    aspect_ratio: 1.777,
    width: 1920,
    height: 1080,
  })).video;
  const portraitLong = normalizeVideo(raw({
    id: "xportlng",
    duration: 600,
    aspect_ratio: 0.5625,
    width: 720,
    height: 1280,
  })).video;
  const portraitShort = normalizeVideo(raw({
    id: "xportshr",
    duration: 24,
    aspect_ratio: 0.5625,
    width: 720,
    height: 1280,
    allow_embed: true,
  })).video;
  assert.equal(isVerticalShort(landscape), false);
  assert.equal(isVerticalShort(portraitLong), false);
  assert.equal(isVerticalShort(portraitShort), true);
  const feed = processVideos([
    raw({ id: "xlandsca", duration: 15, aspect_ratio: 1.77, width: 1920, height: 1080, title: "Landscape clip one" }),
    raw({ id: "xportshr", duration: 24, aspect_ratio: 0.56, width: 720, height: 1280, title: "Portrait clip one", "owner.id": "xother" }),
  ], { mode: "shorts", seen: createSeen(), now: 1_700_000_000 });
  assert.deepEqual(feed.videos.map((video) => video.id), ["xportshr"]);
});

test("related mode drops videos that share neither topic nor channel", () => {
  const source = {
    id: "xsource1",
    title: "Iguazu Falls flooding",
    description: "Heavy rainfall at the falls.",
    tags: ["Iguazu", "flood"],
    channel: "news",
    ownerKey: "xmeteo",
    ownerName: "Meteored",
  };
  const result = processVideos([
    raw({
      id: "xrelated",
      title: "Flooding near Iguazu after heavy rain",
      tags: ["Iguazu"],
      channel: "news",
      "owner.id": "xsomeone",
      "owner.screenname": "Someone",
    }),
    raw({
      id: "xrandom1",
      title: "Cake decorating championship",
      tags: ["cake"],
      channel: "lifestyle",
      "owner.id": "xbaker",
      "owner.screenname": "Baker",
    }),
  ], {
    mode: "related",
    source,
    queryTokens: ["iguazu", "flood"],
    excludeIds: ["xsource1"],
    seen: createSeen(["xsource1"]),
    now: 1_700_000_000,
  });
  assert.deepEqual(result.videos.map((video) => video.id), ["xrelated"]);
});
