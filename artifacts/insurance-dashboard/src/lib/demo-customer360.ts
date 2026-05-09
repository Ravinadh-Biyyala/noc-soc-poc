/**
 * Synthetic Customer-360 demo dataset. Generates 3 source tables in browser
 * (~5K orders × 800 customers × 200 products), inner-joins them, and
 * produces a dashboard config plus the prepared rows + column metadata
 * required by AdvancedAnalytics. The whole thing runs in well under 200ms
 * on a modern laptop and demonstrates *why* you'd want a Data Scientist
 * agent: the joined wide table has correlations, segmentations, anomalies
 * and a real time series — none of which any individual source table has.
 */

import type { ColumnInfo, Row } from "@/lib/data-science";

// Deterministic PRNG so the demo looks the same on every load — important
// for screenshots, repeat demos, and "is this random or real?" questions.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const COUNTRIES = ["US", "UK", "DE", "FR", "JP", "AU", "BR", "IN", "CA", "ES"];
const CHANNELS = ["web", "mobile", "store", "partner"];
const SEGMENTS = ["SMB", "Mid-market", "Enterprise", "Consumer"];
const CATEGORIES = ["Electronics", "Apparel", "Home", "Beauty", "Sports", "Books"];

interface Customer {
  customer_id: string;
  country: string;
  segment: string;
  signup_date: string;
  /** Loyalty score 0-100, drifts higher for older customers. */
  loyalty_score: number;
}

interface Product {
  product_id: string;
  category: string;
  unit_price: number;
  /** Margin as a fraction. Beauty/Apparel are higher-margin, Electronics lower. */
  margin: number;
}

interface JoinedOrder extends Row {
  order_id: string;
  order_date: string;
  customer_id: string;
  product_id: string;
  channel: string;
  quantity: number;
  unit_price: number;
  revenue: number;
  margin_pct: number;
  profit: number;
  // From customer
  country: string;
  segment: string;
  loyalty_score: number;
  // From product
  category: string;
}

export interface Customer360Result {
  /** Final wide rows, ready for both viz and DS. */
  rows: JoinedOrder[];
  columns: ColumnInfo[];
  /** Number of rows in each source table — shown to user pre-join. */
  sourceCounts: { customers: number; products: number; orders: number };
}

const N_CUSTOMERS = 800;
const N_PRODUCTS = 200;
const N_ORDERS = 5000;

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

export function buildCustomer360(): Customer360Result {
  const rnd = mulberry32(1337);

  // ---- Customers --------------------------------------------------------
  const customers: Customer[] = [];
  for (let i = 0; i < N_CUSTOMERS; i++) {
    const yearsAgo = Math.floor(rnd() * 4); // 0–3 years
    const year = 2026 - yearsAgo;
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    customers.push({
      customer_id: `C${String(1000 + i).padStart(5, "0")}`,
      country: pick(COUNTRIES, rnd),
      segment: pick(SEGMENTS, rnd),
      signup_date: isoDate(year, month, day),
      loyalty_score: Math.min(100, Math.round(20 + yearsAgo * 18 + rnd() * 25)),
    });
  }

  // ---- Products ---------------------------------------------------------
  const products: Product[] = [];
  for (let i = 0; i < N_PRODUCTS; i++) {
    const category = pick(CATEGORIES, rnd);
    const baseMargin = { Electronics: 0.08, Apparel: 0.42, Home: 0.28, Beauty: 0.55, Sports: 0.32, Books: 0.18 }[category]!;
    const basePrice = { Electronics: 280, Apparel: 65, Home: 110, Beauty: 35, Sports: 90, Books: 18 }[category]!;
    products.push({
      product_id: `P${String(2000 + i).padStart(5, "0")}`,
      category,
      unit_price: Math.round((basePrice * (0.6 + rnd() * 0.9)) * 100) / 100,
      margin: Math.max(0.03, baseMargin + (rnd() - 0.5) * 0.1),
    });
  }

  // ---- Orders (joined inline for speed) ---------------------------------
  // 18-month order window, with a clear upward time trend so the forecast
  // tile actually predicts something interesting; plus a deliberate
  // anomaly cluster every ~15th day so the anomaly tile lights up.
  const startTs = Date.UTC(2024, 10, 1); // Nov 1 2024
  const endTs = Date.UTC(2026, 4, 1);    // May 1 2026
  const span = endTs - startTs;
  const customerById = new Map(customers.map((c) => [c.customer_id, c]));
  const productById = new Map(products.map((p) => [p.product_id, p]));

  const rows: JoinedOrder[] = [];
  for (let i = 0; i < N_ORDERS; i++) {
    const tFrac = (i / N_ORDERS) * 0.95 + rnd() * 0.05;
    const ts = startTs + tFrac * span;
    const d = new Date(ts);
    const dateKey = isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

    const c = pick(customers, rnd);
    const p = pick(products, rnd);

    // Quantity skews up over time + slight loyalty bonus for repeat buyers.
    const trendBoost = 1 + tFrac * 0.6;
    const loyaltyBoost = 1 + (c.loyalty_score / 200);
    let quantity = Math.max(1, Math.round((1 + rnd() * 3) * trendBoost * loyaltyBoost));

    // Inject ~3% deliberate outliers (bulk orders / refunds-as-negatives).
    const outlier = rnd() < 0.03;
    if (outlier) quantity *= 8 + Math.floor(rnd() * 12);

    const revenue = Math.round(quantity * p.unit_price * 100) / 100;
    const profit = Math.round(revenue * p.margin * 100) / 100;

    rows.push({
      order_id: `O${String(100000 + i).padStart(7, "0")}`,
      order_date: dateKey,
      customer_id: c.customer_id,
      product_id: p.product_id,
      channel: pick(CHANNELS, rnd),
      quantity,
      unit_price: p.unit_price,
      revenue,
      margin_pct: Math.round(p.margin * 1000) / 10,
      profit,
      country: c.country,
      segment: c.segment,
      loyalty_score: c.loyalty_score,
      category: p.category,
    });
  }

  const columns: ColumnInfo[] = [
    { name: "order_id", type: "string", uniqueCount: rows.length },
    { name: "order_date", type: "date", uniqueCount: new Set(rows.map((r) => r.order_date)).size },
    { name: "customer_id", type: "string", uniqueCount: customers.length },
    { name: "product_id", type: "string", uniqueCount: products.length },
    { name: "channel", type: "string", uniqueCount: CHANNELS.length },
    { name: "quantity", type: "number" },
    { name: "unit_price", type: "number" },
    { name: "revenue", type: "number" },
    { name: "margin_pct", type: "number" },
    { name: "profit", type: "number" },
    { name: "country", type: "string", uniqueCount: COUNTRIES.length },
    { name: "segment", type: "string", uniqueCount: SEGMENTS.length },
    { name: "loyalty_score", type: "number" },
    { name: "category", type: "string", uniqueCount: CATEGORIES.length },
  ];
  // Fill min/max for the numeric columns (used by classifier variance bonus).
  for (const c of columns) {
    if (c.type !== "number") continue;
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      const v = Number(r[c.name]);
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    c.min = lo; c.max = hi;
  }

  return {
    rows,
    columns,
    sourceCounts: { customers: customers.length, products: products.length, orders: rows.length },
  };
}

/**
 * Cheap-and-cheerful chart specs derived from the joined data so the
 * dashboard isn't blank above the AdvancedAnalytics panel. The point of
 * the demo is the DS layer — these tiles are just there to show the
 * "before" view.
 */
export function buildCustomer360DashboardConfig(result: Customer360Result) {
  const { rows, sourceCounts } = result;
  const totalRevenue = rows.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const totalProfit = rows.reduce((a, r) => a + Number(r.profit || 0), 0);
  const uniqueCustomers = new Set(rows.map((r) => r.customer_id)).size;
  const aov = totalRevenue / rows.length;

  // Revenue by category
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(String(r.category), (byCategory.get(String(r.category)) ?? 0) + Number(r.revenue));
  const categoryData = [...byCategory.entries()].map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);

  // Revenue over time (monthly)
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.order_date).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.revenue));
  }
  const monthData = [...byMonth.entries()].sort().map(([name, value]) => ({ name, value: Math.round(value) }));

  // Revenue by channel
  const byChannel = new Map<string, number>();
  for (const r of rows) byChannel.set(String(r.channel), (byChannel.get(String(r.channel)) ?? 0) + Number(r.revenue));
  const channelData = [...byChannel.entries()].map(([name, value]) => ({ name, value: Math.round(value) }));

  return {
    title: "Customer 360 — joined demo",
    subtitle: `${sourceCounts.orders.toLocaleString()} orders × ${sourceCounts.customers.toLocaleString()} customers × ${sourceCounts.products.toLocaleString()} products (joined client-side)`,
    kpis: [
      { label: "Total revenue", value: Math.round(totalRevenue), format: "currency", icon: "DollarSign" },
      { label: "Total profit", value: Math.round(totalProfit), format: "currency", icon: "TrendingUp" },
      { label: "Unique customers", value: uniqueCustomers, format: "number", icon: "Users" },
      { label: "Avg order value", value: Math.round(aov), format: "currency", icon: "ShoppingBag" },
    ],
    charts: [
      { id: "rev-month", type: "area", title: "Revenue over time", subtitle: "Monthly, all channels", xKey: "name", yKey: "value", data: monthData, colSpan: 2 },
      { id: "rev-cat", type: "bar", title: "Revenue by category", subtitle: "Top categories", xKey: "name", yKey: "value", data: categoryData },
      { id: "rev-channel", type: "pie", title: "Revenue by channel", subtitle: "Channel mix", xKey: "name", yKey: "value", data: channelData },
    ],
    tables: [],
    // Custom field consumed by GeneratedDashboard — surfaces AdvancedAnalytics.
    dataScience: {
      rows: rows as unknown as Record<string, unknown>[],
      columns: result.columns,
      defaultOpen: true,
    },
  };
}
