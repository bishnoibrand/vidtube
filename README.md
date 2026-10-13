# VidTube

VidTube is a static video-discovery site. It lists and plays **public Dailymotion videos**. It does not host video files, and it does not invent view counts, dates, comments, or subscriber totals.

The live site is GitHub Pages: [https://bishnoibrand.github.io/vidtube/](https://bishnoibrand.github.io/vidtube/). Pages can only serve the static files in this repository. The AI proxy is a separate deploy.

## What changed

The old page picked a random topic on every refresh, searched Dailymotion for that topic, and rendered the raw list. Upload times, watch progress, comments, likes, and subscriber counts were generated in the browser. A provider API key was hard-coded in `index.html`. Shorts were cropped landscape thumbnails that did not open a player.

Those behaviors are gone.

- Home loads `sort=trending` with no search query. The word “Trending” is never sent as a search.
- If trending fails, the page shows an error and a retry. A second button can explicitly load “most viewed this week” (`sort=visited-week`). It does not silently switch to a random topic.
- Every video passes through `js/pipeline.js`: validate, dedupe, score, diversify, then render. Ranking is separate from fetching and from the UI, and it is covered by unit tests.
- Category chips and the sidebar use one config in `js/categories.js`. Channel filters use Dailymotion category ids (`music`, `fun`, `news`, `sport`, `videogames`, `school`, `tech`). Programming, cooking, and motivation have no category id, so they use documented `search` + `sort=relevance`. Live uses `flags=live_onair` and `sort=live-audience`, not the search word “Live”.
- Search runs on Enter and on the search button. Blank or whitespace-only search returns to trending. Old responses cannot overwrite a newer search: each request has a generation id and an `AbortController`.
- Recommendations use `/video/{id}/related` plus a short search built from title, tags, and description. The current video is excluded. Low-overlap results are dropped instead of padded with unrelated videos. Rapid clicks cannot apply the previous video’s list.
- Shorts are portrait videos of at most 60 seconds (`flags=is_vertical`, `shorter_than=1`, then a client check of `aspect_ratio` / width / height). They open in a vertical player. Landscape thumbnails are not cropped into fake shorts.
- Playback uses the public Dailymotion Player library (`https://geo.dailymotion.com/player.js`). Progress is stored only when `getState()` reports `videoTime` and `videoDuration`. If those events are unavailable, there is no progress bar.
- Likes, follows, watch later, and history are labeled as **on this device**. Platform like and follower counts are shown only when the API returns them.
- Comments are read from `/video/{id}/comments` when that call succeeds. There is no fake thread and no fake composer.
- The hard-coded AI key was removed. Chat calls a server proxy only when `js/public-config.js` has an `aiProxyUrl`. Otherwise the assistant says it is not configured. Search commands such as “search jazz” still run locally.

## Feed ranking

`js/pipeline.js` does not claim to know whether a video is good. It only orders items using fields Dailymotion actually returned.

Signals, when present:

- Provider order (trending, relevance, or recent — a prior, not the only signal)
- Token overlap with the search or with the video being watched
- Category match
- Log-normalized view count (a known zero is a mild signal, not a rejection)
- Recency from `created_time`
- Like/view rate only when both numbers exist and views are at least 80
- Metadata completeness
- A small boost when `owner.verified` is exactly `true`, plus a mild follower signal
- Duration fit for a normal watch page

Missing numbers are left out and their weight is shared by the signals that exist. They are not filled in. Very new videos can still rank above irrelevant popular ones in search. Diversity avoids long runs from one channel, then relaxes if that would hide relevant videos. Ties break by provider order, views, upload time, then id. Nothing in the ranker uses `Math.random`.

## Run locally

```bash
npm test
npm start
```

Open `http://localhost:8080`. The preview binds to `0.0.0.0`.

## AI proxy

GitHub Pages cannot hide a secret. Do not put a replacement key in any frontend file.

The previous key in `index.html` is compromised. Revoke it at ChatAnywhere (the host that was hard-coded in the page) before issuing a new one.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_API_KEY` | yes | Provider secret. Set with the host’s secret store, never in git. |
| `AI_API_BASE` | yes | HTTPS API root, for example `https://api.openai.com/v1`. The proxy appends `/chat/completions` if needed. |
| `AI_MODEL` | no | Defaults to `gpt-4o-mini`. The browser cannot choose the model. |
| `AI_ALLOWED_HOSTS` | no | Comma-separated host allowlist. Private and link-local hosts are always rejected. |
| `ALLOWED_ORIGINS` | yes in production | Comma-separated browser origins. `*` is not accepted. Include `https://bishnoibrand.github.io` for Pages. |
| `RATE_LIMIT_PER_MINUTE` | no | Per-IP limit inside one instance. Default 8. Put a platform rate-limit in front of this for production. |
| `PORT` | no | Node proxy port, default `8787`. Static server default is `8080`. |

See `.env.example`.

### Cloudflare Worker

```bash
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_API_BASE
npx wrangler deploy
```

`wrangler.toml` already lists the Pages origin. After deploy, set `aiProxyUrl` in `js/public-config.js` to the worker URL, for example `https://vidtube-ai-proxy.<account>.workers.dev`. That URL is not a secret. The key stays in the worker.

### Node

```bash
AI_API_KEY=... AI_API_BASE=https://api.openai.com/v1 AI_ALLOWED_HOSTS=api.openai.com \
  ALLOWED_ORIGINS=https://bishnoibrand.github.io,http://localhost:8080 \
  npm run ai-proxy
```

The worker and the Node server share `worker/ai-proxy.js`. The proxy:

- ignores client `system` messages and any model field
- caps body size, message count, and reply length
- times out upstream calls and does not follow redirects
- returns `ai_not_configured` when the key or base URL is missing
- does not log the key or the prompt

Until `aiProxyUrl` is set, the in-page assistant will not call `/api/ai/chat` or any other AI URL.

## Tests

```bash
npm test
```

Tests cover ranking, dedupe, diversity, category query building, command detection, response parsing, and the proxy’s refusal to run without a key. They do not call Dailymotion.

## Remaining limitations

- Dailymotion’s public trending list is not a personalized home feed. VidTube can only re-rank what that API returns.
- `sort=trending` combined with `flags=is_vertical` and `shorter_than=1` currently returns an empty list. `sort=visited-today` and `sort=visited-week` return HTTP 500 for that same filter. Shorts therefore use `sort=recent`, then a local quality rank. A real “popular shorts” shelf needs a provider endpoint that can sort vertical short-form video without error.
- `shorter_than` is in minutes. Shorts are limited to 60 seconds so they match that filter and are not just any portrait upload. A 20-minute vertical drama stays in the normal grid, with a Vertical badge, and is not called a Short.
- Related videos are only as good as titles, tags, descriptions, category, and `/related`. VidTube does not watch the file.
- Embedding can still fail when the publisher disables it or the viewer’s region is blocked. The player shows that failure and a link to Dailymotion. Playback is not guaranteed for every id.
- The public player enables its own end-screen recommendations. If it advances to another id, VidTube loads that id’s metadata before changing the title. Progress from a different id is ignored.
- Comment posting, notifications, subscriptions, and accounts need a Dailymotion login. Those controls were removed rather than faked.
- `languages` filters on the uploader-declared language. It will miss videos that were mislabeled.
- The API caps deep pagination (about 1,000 items, and `has_more` becomes false). VidTube also stops after 15 pages.
- Local history, saves, and follows disappear if the browser clears storage. They are not synced.
- In-memory rate limiting on the AI proxy resets when an instance restarts and is not shared across regions.
