// Static topology layout for the Network Topology page. The fleet inventory comes
// from the canonical `asset_inventory` NOC function (the same source the Assets page
// and Device Availability KPI use), but because the inventory itself never changes,
// the layout here is fully *deterministic*: devices are grouped by type into clusters
// and packed onto concentric rings, so positions are stable across refreshes (no
// random jitter). IP / system id are synthesized deterministically from the device id
// — Loki does not carry them — so every asset gets a consistent detail card.

import type { AssetRow } from "@/lib/loki-noc";

// type → display label + node colour. Order here is the cluster layout order.
export const TYPE_META: Record<string, { label: string; color: string }> = {
  switch: { label: "Switches", color: "#f59e0b" },
  router: { label: "Routers", color: "#6366f1" },
  network: { label: "Network & Security", color: "#f43f5e" },
  server: { label: "Servers", color: "#06b6d4" },
  vm: { label: "Virtual / Cloud", color: "#d946ef" },
  storage: { label: "Storage", color: "#14b8a6" },
  atm: { label: "ATMs", color: "#a855f7" },
  host: { label: "Hosts", color: "#64748b" },
};
const TYPE_ORDER = Object.keys(TYPE_META);

export function typeColor(type: string): string {
  return TYPE_META[type]?.color ?? "#64748b";
}
export function typeLabel(type: string): string {
  return TYPE_META[type]?.label ?? type;
}

// device-id prefix → friendly product word for the Asset Details title.
const PREFIX_WORD: Record<string, string> = {
  SW: "Switch", SWT: "Switch", RTR: "Router", ROUTER: "Router",
  FW: "Firewall", VPN: "VPN Gateway", AP: "Access Point", WLC: "WLAN Controller",
  GW: "Gateway", LB: "Load Balancer", NAC: "NAC Appliance",
  ATM: "ATM", SRV: "Server", APP: "App Server", DB: "Database",
  EXCH: "Exchange", WSUS: "WSUS Server", VM: "Virtual Machine", VMW: "Virtual Machine",
  CLOUD: "Cloud Service", PFM: "Platform", PHY: "Sensor",
};

/** "FW-SLU-CAS-01" → "Firewall SLU-CAS 01" — a readable title for the detail card. */
export function friendlyName(deviceId: string): string {
  const parts = deviceId.split("-").filter(Boolean);
  if (parts.length === 0) return deviceId;
  const word = PREFIX_WORD[parts[0].toUpperCase()];
  if (!word) return deviceId;
  const rest = parts.slice(1).join("-");
  return rest ? `${word} ${rest}` : word;
}

/** Stable 32-bit hash of a string (FNV-1a) — used to synthesize IPs deterministically. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic private IP (10.x.y.z) derived from the device id. */
export function synthIp(deviceId: string): string {
  const h = hash(deviceId);
  const a = (h & 0xff) % 254 + 1;
  const b = ((h >>> 8) & 0xff) % 254 + 1;
  const c = ((h >>> 16) & 0xff) % 254 + 1;
  return `10.${a}.${b}.${c}`;
}

// ── Layout ──────────────────────────────────────────────────────────────────

export interface TopoAsset extends AssetRow {
  ip: string;
  systemId: string;
  friendly: string;
}
export interface PlacedNode {
  asset: TopoAsset;
  /** Centre position as a percentage (0–100) of the canvas. */
  xPct: number;
  yPct: number;
}
export interface TopoCluster {
  type: string;
  label: string;
  color: string;
  /** Cluster centre as a percentage of the canvas (for the group label). */
  cxPct: number;
  cyPct: number;
  nodes: PlacedNode[];
}

/** Pack `n` nodes onto concentric rings centred at the origin, radius normalized 0–1. */
function packRings(n: number): Array<{ x: number; y: number }> {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const rings = Math.max(1, Math.ceil(n / 12));
  // Outer rings carry proportionally more nodes (weight = ring index + 1).
  const weights = Array.from({ length: rings }, (_, i) => i + 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(1, Math.round((n * w) / wsum)));
  // Reconcile rounding drift against the outermost ring.
  let drift = n - counts.reduce((a, b) => a + b, 0);
  while (drift !== 0) {
    const i = counts.length - 1;
    counts[i] += Math.sign(drift);
    drift -= Math.sign(drift);
  }
  const pts: Array<{ x: number; y: number }> = [];
  counts.forEach((c, ri) => {
    const radius = rings === 1 ? (n === 1 ? 0 : 1) : (ri + 1) / rings;
    const offset = ri * 0.45; // stagger rings so nodes don't line up radially
    for (let i = 0; i < c; i++) {
      const ang = (i / c) * Math.PI * 2 - Math.PI / 2 + offset;
      pts.push({ x: Math.cos(ang) * radius, y: Math.sin(ang) * radius });
    }
  });
  return pts;
}

/**
 * Enrich + lay out the inventory into deterministic type clusters. Clusters are
 * placed on a grid; nodes within a cluster are packed on concentric rings. The
 * result is stable for a given asset list (assets are sorted by name first).
 */
export function buildTopology(assets: AssetRow[]): TopoCluster[] {
  const enriched: TopoAsset[] = assets.map((a) => ({
    ...a,
    ip: a.ip ?? synthIp(a.name),
    systemId: a.name,
    friendly: friendlyName(a.name),
  }));

  const byType = new Map<string, TopoAsset[]>();
  for (const a of enriched) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }
  for (const list of byType.values()) list.sort((x, y) => x.name.localeCompare(y.name));

  // Present clusters in a stable order: known types first (TYPE_ORDER), then any extras.
  const present = [
    ...TYPE_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort(),
  ];

  const n = present.length;
  if (n === 0) return [];
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const cellW = 100 / cols;
  const cellH = 100 / rows;

  return present.map((type, idx) => {
    const nodes = byType.get(type)!;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cx = cellW * (col + 0.5);
    const cy = cellH * (row + 0.5);
    // Cluster radius as a share of the cell, scaled down a touch for dense clusters.
    const dense = Math.min(1, nodes.length / 24);
    const rx = cellW * (0.34 + dense * 0.05);
    const ry = cellH * (0.30 + dense * 0.05);

    const ring = packRings(nodes.length);
    const placed: PlacedNode[] = nodes.map((asset, i) => ({
      asset,
      xPct: cx + ring[i].x * rx,
      yPct: cy + ring[i].y * ry,
    }));
    return { type, label: typeLabel(type), color: typeColor(type), cxPct: cx, cyPct: cy, nodes: placed };
  });
}
