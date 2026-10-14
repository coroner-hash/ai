// Local-dev JSON-RPC proxy for Robinhood Chain.
// The local ISP DNS (Telkomsel "Internet Baik") hijacks robinhood.com, so we
// resolve the RPC host over DNS-over-HTTPS and connect to the real IP with the
// right SNI. Production Workers never need this.
//
// Usage: node tools/rpc-proxy.mjs   → http://127.0.0.1:8546
import http from "node:http";
import https from "node:https";

const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "rpc.mainnet.chain.robinhood.com";
const PORT = Number(process.env.PORT || 8546);
let cached = { ip: null, until: 0 };

async function resolve(host) {
  if (cached.ip && Date.now() < cached.until) return cached.ip;
  const res = await fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, { headers: { accept: "application/dns-json" } });
  const json = await res.json();
  const answer = (json.Answer ?? []).find((a) => a.type === 1);
  if (!answer) throw new Error(`no A record for ${host}`);
  cached = { ip: answer.data, until: Date.now() + Math.min(answer.TTL, 300) * 1000 };
  return cached.ip;
}

// A dropped upstream must never take the proxy down: answer once, or just close the socket.
const fail = (res, err) => {
  if (res.headersSent) return void res.destroy();
  res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: String(err) }));
};
process.on("uncaughtException", (e) => console.error("proxy error:", String(e).slice(0, 200)));
process.on("unhandledRejection", (e) => console.error("proxy rejection:", String(e).slice(0, 200)));

http
  .createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    try {
      const ip = await resolve(UPSTREAM_HOST);
      const upstream = https.request(
        {
          host: ip,
          servername: UPSTREAM_HOST,
          path: "/",
          method: "POST",
          headers: { host: UPSTREAM_HOST, "content-type": "application/json", "content-length": body.length },
          timeout: 60000,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, { "content-type": up.headers["content-type"] ?? "application/json" });
          up.on("error", () => res.destroy());
          up.pipe(res);
        },
      );
      upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
      upstream.on("error", (err) => fail(res, err));
      upstream.end(body);
    } catch (err) {
      fail(res, err);
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`rpc proxy → ${UPSTREAM_HOST} on http://127.0.0.1:${PORT}`));
