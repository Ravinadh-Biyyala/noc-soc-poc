// Best-effort GeoIP lookup for the dashboard's geographic threat map. The
// frontend sends the attacker IPs it extracted from Loki; we batch-resolve them
// server-side (avoids browser CORS / mixed-content) via the free ip-api.com
// batch endpoint, with a small in-memory cache. Degrades to {} on any failure —
// the map still renders, points just stay unplaced. NOT proxied to Python
// (`/api/loki-geoip` doesn't match the `/^\/api\/loki(\/|$)/` proxy filter).

import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

interface GeoEntry { lat: number; lon: number; country: string; countryCode: string; city: string }

const cache = new Map<string, GeoEntry | null>(); // null = looked up, not found
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

async function batchLookup(ips: string[]): Promise<void> {
  // ip-api batch: up to 100 IPs per call, no key. http only on the free tier —
  // fine from Node (server-side), avoids the browser's https mixed-content block.
  const body = ips.map((q) => ({ query: q, fields: "status,lat,lon,country,countryCode,city,query" }));
  const resp = await fetch("http://ip-api.com/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`ip-api ${resp.status}`);
  const rows = (await resp.json()) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const ip = String(r.query ?? "");
    if (!ip) continue;
    if (r.status === "success" && typeof r.lat === "number" && typeof r.lon === "number") {
      cache.set(ip, {
        lat: r.lat as number, lon: r.lon as number,
        country: String(r.country ?? ""), countryCode: String(r.countryCode ?? ""), city: String(r.city ?? ""),
      });
    } else {
      cache.set(ip, null);
    }
  }
}

router.post("/loki-geoip", async (req: Request, res: Response) => {
  const ips: string[] = Array.isArray(req.body?.ips) ? req.body.ips : [];
  // Public IPv4 only; drop private/loopback ranges (never geolocatable).
  const valid = [...new Set(ips.filter((ip) => typeof ip === "string" && IP_RE.test(ip)))].filter((ip) => {
    const o = ip.split(".").map(Number);
    return !(o[0] === 10 || o[0] === 127 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || o[0] === 0);
  });

  const missing = valid.filter((ip) => !cache.has(ip));
  if (missing.length) {
    try {
      // ip-api batch allows up to 100 per request.
      for (let i = 0; i < missing.length; i += 100) {
        await batchLookup(missing.slice(i, i + 100));
      }
    } catch (err) {
      (req as unknown as { log?: { warn: Function } }).log?.warn({ err }, "geoip lookup failed");
      // Leave uncached IPs out; respond with whatever we already have.
    }
  }

  const out: Record<string, GeoEntry> = {};
  for (const ip of valid) {
    const e = cache.get(ip);
    if (e) out[ip] = e;
  }
  res.json({ geo: out });
});

export default router;
