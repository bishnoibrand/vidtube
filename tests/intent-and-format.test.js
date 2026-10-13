import assert from "node:assert/strict";
import test from "node:test";
import { detectVideoCommand } from "../js/ai-intent.js";
import { cleanQuery, isTrustedMediaUrl, isValidVideoId } from "../js/sanitize.js";
import { formatCreated, formatDuration, extractSearchTerms } from "../js/text.js";
import { createLibrary } from "../js/storage.js";

test("video commands require a leading verb and ignore ordinary sentences", () => {
  assert.deepEqual(detectVideoCommand("search jazz piano"), { type: "search", query: "jazz piano" });
  assert.deepEqual(detectVideoCommand("please find me cooking"), { type: "search", query: "cooking" });
  assert.deepEqual(detectVideoCommand("play lo-fi beats"), { type: "play", query: "lo-fi beats" });
  assert.deepEqual(detectVideoCommand("show music"), { type: "category", categoryId: "music" });
  assert.equal(detectVideoCommand("I want to play chess tonight"), null);
  assert.equal(detectVideoCommand("research quantum computing"), null);
  assert.equal(detectVideoCommand("display the settings"), null);
  assert.equal(detectVideoCommand("search"), null);
  assert.equal(detectVideoCommand("play"), null);
  assert.equal(detectVideoCommand("Can you search your feelings?"), null);
});

test("queries are trimmed and control characters are removed", () => {
  assert.equal(cleanQuery("  jazz \n piano  "), "jazz piano");
  assert.equal(cleanQuery("   "), "");
  assert.equal(cleanQuery(null), "");
});

test("ids and media urls are strict", () => {
  assert.equal(isValidVideoId("xbm52y6"), true);
  assert.equal(isValidVideoId("javascript"), false);
  assert.equal(isValidVideoId("x"), false);
  assert.equal(isTrustedMediaUrl("https://s1.dmcdn.net/v/example/x720"), true);
  assert.equal(isTrustedMediaUrl("https://user:pass@s1.dmcdn.net/x"), false);
  assert.equal(isTrustedMediaUrl("http://s1.dmcdn.net/v/example/x720"), false);
});

test("dates and durations are honest about missing data", () => {
  assert.equal(formatCreated(null), "Date unavailable");
  assert.equal(formatCreated(-5), "Date unavailable");
  assert.equal(formatCreated(9_999_999_999, 1_700_000_000_000), "Date unavailable");
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(75), "1:15");
  assert.equal(formatDuration(3661), "1:01:01");
});

test("search terms come from title, tags, and description, not the whole raw title", () => {
  const terms = extractSearchTerms({
    title: "The official full video of Iguazu Falls flooding",
    description: "Heavy rainfall caused flooding.",
    tags: ["Iguazu Falls"],
    channel: "news",
  });
  assert.ok(terms.includes("iguazu"));
  assert.ok(!terms.includes("official"));
  assert.ok(!terms.includes("video"));
});

test("local library does not invent platform likes and survives bad json", () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => mem.get(key) ?? null,
    setItem: (key, value) => mem.set(key, value),
    removeItem: (key) => mem.delete(key),
  };
  storage.setItem("vidtube.likes.v1", "{not json");
  const library = createLibrary(storage);
  assert.deepEqual(library.getLikes(), []);
  const video = {
    id: "xabc123",
    title: "Real title",
    ownerName: "Channel",
    ownerId: "xowner",
    thumbnail: "https://s1.dmcdn.net/v/example/x720",
    duration: 10,
  };
  assert.equal(library.toggleLike(video), true);
  assert.equal(library.isLiked("xabc123"), true);
  assert.equal(library.toggleLike(video), false);
  library.recordOpen(video);
  assert.equal(library.progressFor("xabc123"), null);
  library.recordProgress("xabc123", 4, 10);
  assert.ok(library.progressFor("xabc123") > 0.3);
  const again = library.recordOpen(video);
  assert.ok(again[0].progress > 0.3);
});
