# VidTube deployment and security setup

## What the current video feed uses

VidTube is currently a client-side HTML application and uses Dailymotion's video API. The home feed defaults to the provider's trending ordering; a non-empty search uses relevance. The app removes invalid entries and duplicate IDs, and uses a lightweight ranking score based on provider order, available view counts, dates, and metadata completeness.

Ranking cannot guarantee that every video is high quality: the public API does not supply a reliable universal content-quality score. A true personalized recommendation system needs user preferences and a backend to collect them responsibly.

The app hides the Shorts shelf when it cannot identify portrait-format results. Dailymotion's returned fields and thumbnail shape can vary; verify actual portrait assets from the provider before treating this as a production Shorts system.

## Important: rotate the previously exposed AI key

A provider key was previously included in client-side source code. Treat it as compromised and revoke/rotate it in the provider dashboard. Removing it from the latest source does not erase it from existing Git history. Never put its replacement in index.html, other browser JavaScript, or a public repository variable.

## Deploy the AI proxy on Cloudflare Workers

The Worker source is worker/ai-proxy.js.

1. Create a Cloudflare Worker for VidTube.
2. Deploy worker/ai-proxy.js as the Worker entry point.
3. Add a Worker secret named CHATANYWHERE_API_KEY containing the newly rotated provider key.
4. Add a Worker variable named ALLOWED_ORIGIN with the exact origin of the published VidTube site. For GitHub Pages, this normally resembles https://OWNER.github.io; for a custom domain, use that exact https origin. Do not include a path or trailing slash.
5. Optionally configure AI_API_URL and AI_MODEL only if supported by the AI provider account.
6. Add a Cloudflare rate-limiting rule for /api/ai/chat before public launch. CORS is not authentication and does not stop non-browser callers; use platform rate limits and usage limits to control abuse.
7. Verify the Worker route is reachable as https://YOUR-WORKER.workers.dev/api/ai/chat.

The Worker accepts POST JSON shaped as { "message": "your question" }, limits message size, validates the calling origin, keeps the provider key server-side, and returns a controlled error when the provider is unavailable.

### Connect the frontend to the Worker

In index.html, set aiHost to your deployed Worker endpoint, for example:

~~~js
aiHost: "https://YOUR-WORKER.workers.dev/api/ai/chat",
~~~

Replace the example hostname with your actual Worker hostname. The Worker ALLOWED_ORIGIN must exactly match the published frontend origin. The endpoint URL is public configuration; the provider key must remain a Worker secret.

Without a deployed Worker and valid provider secret, the AI assistant will show an unavailable/configuration message. A static GitHub Pages site cannot run a server-side route merely because the frontend references /api/ai/chat.

## Local and browser checks

- Open the home page and verify the default feed uses trending results.
- Submit searches by Enter and by clicking Search.
- Scroll until pagination ends and check for duplicates.
- Open a video, then a recommendation, and verify the title/player update correctly.
- Confirm unavailable comments/statistics are not fabricated.
- Confirm the Shorts shelf is hidden when provider data does not identify appropriate portrait video.
- Test the AI proxy with an allowed frontend origin, an unapproved origin, a missing secret, invalid JSON, an overlong message, and a provider failure.
- Check the published source/build for credentials. Rotate any previously exposed key even if it is no longer visible in the latest file.

## Known boundaries

- Likes and follows are local browser preferences, not account-wide server data.
- A real personalized feed requires a backend and an explicit user-preference/history model.
- Cross-origin embedded-player watch progress requires supported player events; do not infer it from opening the player.
- Public video APIs may limit fields, sorting, playback, rate limits, and video availability. The UI should report unsupported features honestly.
