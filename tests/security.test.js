import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "tests") continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

test("source no longer contains the exposed AI key, random topics, or fake generators", () => {
  const files = walk(new URL(root).pathname).filter((path) => /\.(html|js|mjs|css|md|toml|yml|json|example)$/.test(path));
  const forbidden = [
    "sk-I7liW",
    "chatanywhere",
    "randomTopics",
    "randomInitialQuery",
    "getRandomTimeAgo",
    "renderMockComments",
    "1.2M subscribers",
  ];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (text.includes(needle)) hits.push(`${file} contains ${needle}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("frontend does not call a hardcoded AI endpoint", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const config = readFileSync(new URL("../js/public-config.js", import.meta.url), "utf8");
  assert.match(config, /aiProxyUrl:\s*""/);
  assert.doesNotMatch(html, /api\.dailymotion\.com\/videos\?search=/);
  assert.doesNotMatch(html, /Authorization/);
});
