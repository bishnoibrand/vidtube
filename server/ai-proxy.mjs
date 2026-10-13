/**
 * Node entrypoint for the same AI proxy used by the Cloudflare Worker.
 * Bind address is 0.0.0.0 so it can be reached outside the sandbox when deployed.
 *
 *   AI_API_KEY=... AI_API_BASE=https://api.openai.com/v1 npm run ai-proxy
 */
import { createServer } from "node:http";
import { handleAiRequest } from "../worker/ai-proxy.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

const server = createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || `127.0.0.1:${port}`;
    const url = new URL(req.url || "/", `http://${hostHeader}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const ip = req.socket?.remoteAddress || "local";
    const response = await handleAiRequest(request, process.env, { clientIp: ip });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const payload = Buffer.from(await response.arrayBuffer());
    res.end(payload);
  } catch (error) {
    console.log(JSON.stringify({ event: "ai_proxy_crash", name: error?.name || "error" }));
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "proxy_error" }));
  }
});

server.listen(port, host, () => {
  console.log(`VidTube AI proxy listening on http://${host}:${port}`);
});
