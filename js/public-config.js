/**
 * Public, non-secret configuration.
 *
 * The AI provider key must never be placed here. Set `aiProxyUrl` to the
 * deployed proxy (see worker/ and README) after the proxy is live.
 * An empty string disables AI chat and the app explains that honestly.
 */
export const publicConfig = {
  aiProxyUrl: "",
  dailymotionApi: "https://api.dailymotion.com",
  playerScript: "https://geo.dailymotion.com/player.js",
  pageSize: 20,
  maxPages: 15,
  requestTimeoutMs: 12000,
};
