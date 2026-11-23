// Token Radar's model, radar-3: a fitted comps curve, token odds from the
// peers' record, held-out tests, and costed farm verdicts.
//
// One snapshot of the protocol universe in, one ranked board out. Nothing is
// hardcoded by name: every number below is fitted or counted from the
// snapshot itself, and every rule is stated on the dashboard so the page can
// re-derive each row from the same figures.
//
//   comps       Traded tokens with a positive market cap, one row per ticker,
//               excluding the set-aside kinds (bridges, exchanges, liquid
//               staking, versioned and wrapped products): n = 91.
//   curve       OLS fit of log10(market cap) on log10(TVL) over the comps.
//   category    Mean residual per category, shrunk toward the curve with
//               CAT_SHRINK pseudo-observations, capped at xCAT_CAP.
//   growth      1 + GROWTH_WEIGHT x 7-day TVL change, held to [0.8, 1.25].
//   seasoning   0.85 + 0.15 x min(1, age_days / 730), held to [0.7, 1.15].
//   odds        P(records a token) by age-with-no-token bucket, counted over
//               all 758 protocols and shrunk toward the base rate.
//   implied     value-if-launches x odds, whole dollars, distinct per row.
//   bands       P25-P75 / P10-P90 from leave-one-out residual quantiles.
//   rank range  P10-P90 of rank across 200 fixed-seed bootstrap refits.
//
// Farm economics, per row: slice = DROP_SHARE x implied x deposit / TVL;
// net = slice - gas/fees - T-bill yield forgone over the hold; verdict FARM
// when net > 0, MARGINAL-THIN when the slice beats fees but not the T-bill,
// SKIP otherwise. Deposit size, hold length and the cheapest chain all
// follow stated rules, never a per-protocol choice.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  cat: string;
  chains: string[];
  chain: string;
  tvl: number;
  chg7: number | null;
  age: number | null;
  tier: string;
  rank: number;
  rankLo: number;
  rankHi: number;
  curve: number;
  catF: number;
  growthF: number;
  seasonF: number;
  ifLaunches: number;
  odds: number;
  implied: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  deposit: number;
  hold: number;
  fees: number;
  hours: number;
  slice: number;
  tbill: number;
  net: number;
  netHour: number;
  verdict: string;
  breakeven: number;
  paysFrom: number | null;
  play: string;
  steps: string[];
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  snapshot_n: number;
  watchlist_n: number;
  comps_n: number;
  curve: { a: number; b: number; r2: number; formula: string };
  cat_offsets: { cat: string; n: number; factor: number }[];
  tests: {
    loo: { miss: number; within3: number; cov50: number; cov80: number; n: number };
    time: { miss: number; within3: number; cov50: number; cov80: number; n: number };
    flat: { loo_miss: number; time_miss: number };
    brier: { model: number; base: number; unshrunk: number; n: number };
  };
  // Per age bucket: raw share recording a token, shrunk odds, counts.
  odds_buckets: { label: string; n: number; hit: number; share: number; odds: number }[];
  ablation: { term: string; loo: number; time: number; verdict: string }[];
  accounting: { ranked: number; trades: number; setAside: number; reasons: { reason: string; n: number }[] };
  totals: { implied: number; tvl: number; farm: number; marginal: number; skip: number };
  total_implied: number;
  bands: { q10: number; q25: number; q75: number; q90: number };
  gas: Record<string, number>;
  rules: { deposit: string; hold: string; verdict: string; tbill: number; dropShare: number };
  rows: RadarRow[];
  comps: { slug: string; name: string; cat: string; tvl: number; mcap: number; sym: string }[];
  live: { slug: string; name: string; cat: string; tvl: number; mcap: number; sym: string }[];
  checksum: string;
}

// ---- constants (all stated on the dashboard) -------------------------------

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;

// Gas in USD per transaction, by chain, as the model assumes it. The farm
// plan always uses the cheapest of the protocol's own chains.
const GAS_USD: Record<string, number> = {
  Ethereum: 3.5, Bitcoin: 2.0, Tron: 0.3, Avalanche: 0.15, Arbitrum: 0.12,
  Optimism: 0.1, Binance: 0.1, Base: 0.08, Linea: 0.08, 'Robinhood Chain': 0.08,
  Solana: 0.05, Polygon: 0.04, 'Hyperliquid L1': 0.05, Monad: 0.05, Plasma: 0.05,
};
const GAS_DEFAULT = 0.5;
const GAS_TXS = 4; // approve, deposit, claim, exit
const GAS_FIXED = 0.5; // slippage and rounding on the small steps

const CAT_SHRINK = 40; // pseudo-observations pulling a category toward the curve
const CAT_CAP = 2.5; // a category factor never exceeds x2.5 or 1/2.5
const GROWTH_WEIGHT = 0.5;
const GROWTH_LO = 0.8;
const GROWTH_HI = 1.25;
const SEASON_LO = 0.7;
const SEASON_HI = 1.15;
const ODDS_SHRINK = 20; // pseudo-observations pulling a bucket toward the base rate
const ODDS_LO = 0.15;
const ODDS_HI = 0.85;
const AGE_BUCKETS: [number, number][] = [[0, 90], [91, 180], [181, 365], [366, 730], [731, 1460], [1461, 1e9]];
const TBILL = 0.04;
const DROP_SHARE = 0.1;
const BOOT_REFS = 200;
const BOOT_SEED = 0x5eed;

// ---- small helpers ---------------------------------------------------------

const DAY_MS = 86_400_000;
const LOG3 = Math.log10(3);

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// Four decimals for the stored factors, so the page's in-browser recompute
// lands within a fraction of a percent of the board's values.
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// Deterministic PRNG (mulberry32): the bootstrap refits are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a, 32-bit: the checksum the page recomputes in the browser.
export function boardChecksum(rows: { slug: string; rank: number; implied_value_usd: number }[]): string {
  let h = 0x811c9dc5;
  const text = rows.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function ageDays(p: Protocol, asOfMs: number): number | null {
  if (!p.listed_at) return null;
  const ms = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((asOfMs - ms) / DAY_MS));
}

function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

// Why a no-token protocol is set aside instead of ranked. Null means it is
// rankable. The rule mirrors the watchlist's own definition.
function setAsideReason(p: Protocol): string | null {
  if (VERSION_RE.test(p.name)) return 'Versioned listing';
  if (p.category === 'CEX') return 'Exchange custody';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return p.category;
  if (WRAPPED_RE.test(p.name)) return 'Wrapped or staked product';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'Exchange-named product';
  return null;
}

// ---- snapshot --------------------------------------------------------------

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is not a token-radar snapshot: as_of, protocols and watchlist are required');
  }
  return raw;
}

// ---- the fit ---------------------------------------------------------------

interface Curve {
  a: number;
  b: number;
}

function fitCurve(rows: Protocol[]): Curve {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const r of rows) {
    const x = Math.log10(r.tvl_usd);
    const y = Math.log10(r.mcap_usd!);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { a: (sy - b * sx) / n, b };
}

function curveR2(rows: Protocol[], f: Curve): number {
  const ys = rows.map((r) => Math.log10(r.mcap_usd!));
  const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
  let ss = 0;
  let st = 0;
  for (const r of rows) {
    const y = Math.log10(r.mcap_usd!);
    const pred = f.a + f.b * Math.log10(r.tvl_usd);
    ss += (y - pred) ** 2;
    st += (y - mean) ** 2;
  }
  return 1 - ss / st;
}

// Shrunk mean log-residual per category, in log10 units.
function categoryEffects(rows: Protocol[], f: Curve): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const res = Math.log10(r.mcap_usd!) - (f.a + f.b * Math.log10(r.tvl_usd));
    const key = r.category ?? 'Uncategorised';
    const g = groups.get(key);
    if (g) g.push(res);
    else groups.set(key, [res]);
  }
  const out = new Map<string, number>();
  const cap = Math.log10(CAT_CAP);
  for (const key of [...groups.keys()].sort()) {
    const v = groups.get(key)!;
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    out.set(key, clamp(mean * (v.length / (v.length + CAT_SHRINK)), -cap, cap));
  }
  return out;
}

function growthFactor(p: Protocol): number {
  if (p.change_7d === null) return 1;
  return clamp(1 + GROWTH_WEIGHT * (clamp(p.change_7d, -60, 120) / 100), GROWTH_LO, GROWTH_HI);
}

function seasonFactor(age: number | null): number {
  if (age === null) return 1;
  return clamp(0.85 + 0.15 * Math.min(1, age / 730), SEASON_LO, SEASON_HI);
}

interface FitOptions {
  cat: boolean;
  growth: boolean;
  season: boolean;
  // Optional fitted terms, tested in the ablation only — the adopted model
  // (FULL_OPTS) never sets them, so the board cannot change.
  chains?: boolean;
  logAge?: boolean;
}

type Predictor = (p: Protocol, age: number | null) => number;

// A predictor returns log10(value-if-launches). Growth and seasoning carry
// no fitted parameters, so refits only re-estimate the curve and the
// category effects. The optional fitted terms fit their slope on the
// training rows' residuals inside each fold, like the curve — no peeking.
function makePredictor(rows: Protocol[], ages: Map<string, number | null>, opts: FitOptions): Predictor {
  const f = fitCurve(rows);
  const fx = opts.cat ? categoryEffects(rows, f) : new Map<string, number>();
  const base = (p: Protocol, age: number | null) => {
    let v = f.a + f.b * Math.log10(p.tvl_usd);
    if (opts.cat) v += fx.get(p.category ?? 'Uncategorised') ?? 0;
    if (opts.growth) v += Math.log10(growthFactor(p));
    if (opts.season) v += Math.log10(seasonFactor(age));
    return v;
  };
  // OLS slope of the base residuals on one centred feature, fit on the
  // training rows with a known feature value. Centring means a missing
  // value contributes zero (mean-imputed) and the level never shifts.
  const fitTerm = (feature: (p: Protocol, age: number | null) => number | null): { slope: number; mean: number } => {
    const xs = rows.map((p) => feature(p, ages.get(p.slug) ?? null));
    const known = xs.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);
    if (known.length < 2) return { slope: 0, mean: 0 };
    const mean = known.reduce((s, i) => s + xs[i]!, 0) / known.length;
    const res = known.map((i) => Math.log10(rows[i]!.mcap_usd!) - base(rows[i]!, ages.get(rows[i]!.slug) ?? null));
    const rMean = res.reduce((s, r) => s + r, 0) / res.length;
    let num = 0;
    let den = 0;
    known.forEach((i, k) => {
      const dx = xs[i]! - mean;
      num += dx * (res[k]! - rMean);
      den += dx * dx;
    });
    return { slope: den === 0 ? 0 : num / den, mean };
  };
  const chainsTerm = opts.chains ? fitTerm((p) => Math.log10(Math.max(1, p.chains.length))) : null;
  const logAgeTerm = opts.logAge ? fitTerm((_p, age) => (age === null ? null : Math.log10(Math.max(1, age)))) : null;
  return (p: Protocol, age: number | null) => {
    let v = base(p, age);
    if (chainsTerm) v += chainsTerm.slope * (Math.log10(Math.max(1, p.chains.length)) - chainsTerm.mean);
    if (logAgeTerm) {
      const x = age === null ? null : Math.log10(Math.max(1, age));
      if (x !== null) v += logAgeTerm.slope * (x - logAgeTerm.mean);
    }
    return v;
  };
}

function flatPredictor(rows: Protocol[]): Predictor {
  const mults = rows.map((r) => r.mcap_usd! / r.tvl_usd).sort((a, b) => a - b);
  const m = mults[Math.floor(mults.length / 2)]!;
  return (p: Protocol) => Math.log10(p.tvl_usd * m);
}

interface TestResult {
  miss: number;
  within3: number;
  cov50: number;
  cov80: number;
  n: number;
}

// Score signed log10 errors against bands built from the other errors, so
// the coverage numbers are honest rather than fitted to themselves.
function scoreErrors(errs: number[]): { miss: number; within3: number; cov50: number; cov80: number } {
  const abs = errs.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const miss = Math.pow(10, abs[Math.floor(abs.length / 2)]!);
  const within3 = (100 * errs.filter((e) => Math.abs(e) < LOG3).length) / errs.length;
  let c50 = 0;
  let c80 = 0;
  for (let i = 0; i < errs.length; i++) {
    const rest = errs.filter((_, j) => j !== i);
    const q25 = quantile(rest, 0.25);
    const q75 = quantile(rest, 0.75);
    const q10 = quantile(rest, 0.1);
    const q90 = quantile(rest, 0.9);
    if (errs[i]! >= q25 && errs[i]! <= q75) c50++;
    if (errs[i]! >= q10 && errs[i]! <= q90) c80++;
  }
  return { miss: round2(miss), within3: Math.round(within3), cov50: Math.round((100 * c50) / errs.length), cov80: Math.round((100 * c80) / errs.length) };
}

// Leave-one-out: each comp priced by a fit that never saw it.
function looTest(comps: Protocol[], ages: Map<string, number | null>, build: (rows: Protocol[], ages: Map<string, number | null>) => Predictor): TestResult {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const pred = build(rest, ages);
    errs.push(Math.log10(comps[i]!.mcap_usd!) - pred(comps[i]!, ages.get(comps[i]!.slug) ?? null));
  }
  return { ...scoreErrors(errs), n: comps.length };
}

// Time split: the older half of the dated comps prices the newer half.
function timeTest(comps: Protocol[], ages: Map<string, number | null>, build: (rows: Protocol[], ages: Map<string, number | null>) => Predictor): TestResult {
  const dated = comps
    .filter((p) => p.listed_at)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const pred = build(train, ages);
  const errs = test.map((p) => Math.log10(p.mcap_usd!) - pred(p, ages.get(p.slug) ?? null));
  // Bands for the coverage check come from the training set's own LOO errors.
  const trainErrs: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const rest = train.filter((_, j) => j !== i);
    const pr = build(rest, ages);
    trainErrs.push(Math.log10(train[i]!.mcap_usd!) - pr(train[i]!, ages.get(train[i]!.slug) ?? null));
  }
  const q25 = quantile(trainErrs, 0.25);
  const q75 = quantile(trainErrs, 0.75);
  const q10 = quantile(trainErrs, 0.1);
  const q90 = quantile(trainErrs, 0.9);
  const abs = errs.map((e) => Math.abs(e)).sort((a, b) => a - b);
  return {
    miss: round2(Math.pow(10, abs[Math.floor(abs.length / 2)]!)),
    within3: Math.round((100 * errs.filter((e) => Math.abs(e) < LOG3).length) / errs.length),
    cov50: Math.round((100 * errs.filter((e) => e >= q25 && e <= q75).length) / errs.length),
    cov80: Math.round((100 * errs.filter((e) => e >= q10 && e <= q90).length) / errs.length),
    n: test.length,
  };
}

// The signed LOO residuals of the final model, for the row bands.
function looResiduals(comps: Protocol[], ages: Map<string, number | null>, opts: FitOptions): number[] {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const pred = makePredictor(rest, ages, opts);
    errs.push(Math.log10(comps[i]!.mcap_usd!) - pred(comps[i]!, ages.get(comps[i]!.slug) ?? null));
  }
  return errs;
}

// ---- token odds ------------------------------------------------------------

function bucketOf(age: number | null): number {
  if (age === null) return -1;
  for (let i = 0; i < AGE_BUCKETS.length; i++) {
    if (age >= AGE_BUCKETS[i]![0] && age <= AGE_BUCKETS[i]![1]) return i;
  }
  return -1;
}

interface OddsBucket {
  label: string;
  n: number;
  hit: number;
  share: number;
  odds: number;
}

interface OddsModel {
  base: number;
  odds: number[];
  buckets: OddsBucket[];
}

// "0–90 days", "91–180 days", "181–365 days", "1–2 years", "2–4 years", "4+ years".
function bucketLabel([lo, hi]: [number, number]): string {
  if (hi >= 1e9) return `${Math.round(lo / 365)}+ years`;
  if (hi > 365) return `${Math.round(lo / 365)}–${Math.round(hi / 365)} years`;
  return `${lo}–${hi} days`;
}

// P(records a token) by age bucket, counted over the whole snapshot and
// shrunk toward the base rate with ODDS_SHRINK pseudo-observations.
// The raw per-bucket shares are exported too, for the peers'-record chart
// and the unshrunk Brier rung.
function fitOdds(protocols: Protocol[], ages: Map<string, number | null>): OddsModel {
  const base = protocols.filter(hasToken).length / protocols.length;
  const counts = AGE_BUCKETS.map(() => ({ hit: 0, n: 0 }));
  for (const p of protocols) {
    const b = bucketOf(ages.get(p.slug) ?? null);
    if (b < 0) continue;
    counts[b]!.n++;
    if (hasToken(p)) counts[b]!.hit++;
  }
  const odds = counts.map((c) => clamp((c.hit + ODDS_SHRINK * base) / (c.n + ODDS_SHRINK), ODDS_LO, ODDS_HI));
  const buckets = counts.map((c, i) => ({
    label: bucketLabel(AGE_BUCKETS[i]!),
    n: c.n,
    hit: c.hit,
    share: c.n > 0 ? c.hit / c.n : base,
    odds: odds[i]!,
  }));
  return { base, odds, buckets };
}

function oddsFor(age: number | null, model: OddsModel): number {
  const b = bucketOf(age);
  if (b < 0) return model.base;
  return model.odds[b]!;
}

// Brier score of the bucket odds against the base rate, over protocols with
// a known age. Lower is better; 0 is a perfect forecast.
function brierScore(protocols: Protocol[], ages: Map<string, number | null>, model: OddsModel): { model: number; base: number; n: number } {
  let sm = 0;
  let sb = 0;
  let n = 0;
  for (const p of protocols) {
    const age = ages.get(p.slug) ?? null;
    if (age === null) continue;
    const y = hasToken(p) ? 1 : 0;
    sm += (oddsFor(age, model) - y) ** 2;
    sb += (model.base - y) ** 2;
    n++;
  }
  return { model: round2(sm / n), base: round2(sb / n), n };
}

// Brier score of the RAW bucket shares (no shrinkage) — the middle rung of
// the odds ladder, scored with the same procedure on the same n.
function brierUnshrunk(protocols: Protocol[], ages: Map<string, number | null>, model: OddsModel): number {
  let s = 0;
  let n = 0;
  for (const p of protocols) {
    const age = ages.get(p.slug) ?? null;
    if (age === null) continue;
    const b = bucketOf(age);
    const y = hasToken(p) ? 1 : 0;
    s += ((b < 0 ? model.base : model.buckets[b]!.share) - y) ** 2;
    n++;
  }
  return round2(s / n);
}

// ---- farm economics ----------------------------------------------------------

interface FarmPlay {
  play: string;
  action: string;
}

const PLAYS: Record<string, FarmPlay> = {
  Lending: { play: 'Lending', action: 'Lend stablecoins in the lending market' },
  Dexs: { play: 'Liquidity', action: 'Provide liquidity to the main trading pool' },
  Yield: { play: 'Vault deposit', action: 'Deposit into the yield vault' },
  'Yield Aggregator': { play: 'Vault deposit', action: 'Deposit into the auto-compounding vault' },
  RWA: { play: 'RWA vault', action: 'Buy into the tokenised-asset vault' },
  'Risk Curators': { play: 'Curated vault', action: 'Deposit into the curated vault' },
  'Onchain Capital Allocator': { play: 'Allocator deposit', action: 'Deposit into the capital allocation vault' },
  Derivatives: { play: 'Hedged position', action: 'Open a small hedged derivatives position' },
  'Basis Trading': { play: 'Basis position', action: 'Deposit into the basis-trading vault' },
  CDP: { play: 'CDP deposit', action: 'Deposit collateral and mint against it' },
  'Staking Pool': { play: 'Staking', action: 'Stake in the staking pool' },
  Restaking: { play: 'Restaking', action: 'Restake through the restaking vault' },
  'Liquidity Manager': { play: 'Liquidity', action: 'Deposit into the managed liquidity position' },
  'Leveraged Farming': { play: 'Leveraged farm', action: 'Open a low-leverage farming position' },
  Chain: { play: 'Chain stake', action: 'Stake with the chain validator set' },
  Privacy: { play: 'Shielded deposit', action: 'Deposit into the shielded pool' },
  'Prediction Market': { play: 'Market position', action: 'Take a small prediction-market position' },
  Indexes: { play: 'Index deposit', action: 'Buy into the index basket' },
};
const DEFAULT_PLAY: FarmPlay = { play: 'Vault deposit', action: 'Deposit into the protocol vault' };

function playFor(category: string | null): FarmPlay {
  if (category && PLAYS[category]) return PLAYS[category]!;
  return DEFAULT_PLAY;
}

function cheapestChain(p: Protocol): { chain: string; gas: number } {
  let best: { chain: string; gas: number } | null = null;
  for (const c of p.chains) {
    const g = GAS_USD[c] ?? GAS_DEFAULT;
    if (!best || g < best.gas) best = { chain: c, gas: g };
  }
  return best ?? { chain: 'Ethereum', gas: GAS_USD['Ethereum']! };
}

// Deposit size by TVL: small protocols take small tickets, giants take
// larger ones, so no single farm dominates the book.
function depositFor(tvl: number): number {
  if (tvl < 25_000_000) return 500;
  if (tvl < 100_000_000) return 1000;
  if (tvl < 500_000_000) return 2500;
  return 5000;
}

// Hold length by age on record: younger protocols get longer to launch.
function holdFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 180) return 120;
  if (age < 540) return 90;
  return 60;
}

function money(x: number): string {
  if (x >= 1000) return `$${Math.round(x).toLocaleString('en-US')}`;
  if (x >= 100) return `$${x.toFixed(0)}`;
  return `$${x.toFixed(2)}`;
}

// The farm plan: every step carries its cost and time inline, and the last
// step is the exit plus the stop rule.
function farmSteps(p: Protocol, play: FarmPlay, chain: string, gas: number, deposit: number, hold: number, fees: number): string[] {
  const g = money(gas);
  const d = money(deposit);
  const mid = Math.round(hold / 2);
  return [
    `Read ${p.name}'s docs and confirm the ${play.play.toLowerCase()} flow on ${chain} before sending anything; verify the contract address against the project's official channels. COST $0 · TIME 20 min`,
    `Fund a fresh wallet on ${chain} with ${d} plus ${money(fees)} for gas, kept apart from other farms so the position is easy to exit. COST ${g} gas · TIME 10 min`,
    `${play.action} on ${chain} with ${d}; confirm the receipt shows the expected share before leaving the page. COST ${g} gas · TIME 15 min`,
    `Check the position once a week: TVL, rewards accruing, and any announcement of a token or snapshot. COST $0 · TIME 10 min a week`,
    `Mid-hold review at day ${mid}: if TVL is down more than 30% from entry or withdrawals pause, exit at once under the stop rule below. COST $0 · TIME 15 min`,
    `If ${p.name} announces a token or snapshot, claim any drop promptly and note the claim window; unclaimed drops usually expire. COST ${g} gas · TIME 20 min`,
    `Exit: withdraw the ${d} deposit plus rewards and move funds back to your main wallet. STOP RULE: exit immediately if TVL falls 30% below entry, withdrawals pause, or the team goes silent for 2 weeks. COST ${g} gas · TIME 15 min`,
  ];
}

// ---- the build ---------------------------------------------------------------

const FULL_OPTS: FitOptions = { cat: true, growth: true, season: true };

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const protocols = snapshot.protocols;
  const watch = new Set(snapshot.watchlist);
  const ages = new Map<string, number | null>();
  for (const p of protocols) ages.set(p.slug, ageDays(p, asOfMs));

  // Universe accounting: every protocol lands in exactly one group.
  const reasonCounts = new Map<string, number>();
  const rankable: Protocol[] = [];
  let trades = 0;
  for (const p of protocols) {
    if (hasToken(p)) {
      trades++;
      continue;
    }
    const reason = setAsideReason(p);
    if (reason) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      continue;
    }
    rankable.push(p);
  }
  const setAside = [...reasonCounts.values()].reduce((s, n) => s + n, 0);

  // Comps: one row per ticker, positive market cap, never a set-aside kind.
  const seen = new Set<string>();
  const comps: Protocol[] = [];
  for (const p of [...protocols].filter((q) => q.mcap_usd !== null && q.mcap_usd > 0 && q.tvl_usd > 0).sort((a, b) => b.tvl_usd - a.tvl_usd)) {
    const tick = (p.symbol ?? p.slug).toUpperCase();
    if (seen.has(tick)) continue;
    if (setAsideReason(p)) continue;
    seen.add(tick);
    comps.push(p);
  }
  comps.sort((a, b) => (a.slug < b.slug ? -1 : 1));

  const curveFit = fitCurve(comps);
  const r2 = curveR2(comps, curveFit);
  const catFx = categoryEffects(comps, curveFit);
  const oddsModel = fitOdds(protocols, ages);
  const brier = brierScore(protocols, ages, oddsModel);
  const brierUnshrunkScore = brierUnshrunk(protocols, ages, oddsModel);

  // Held-out tests of the final model, plus the flat baseline.
  const buildFull = (rows: Protocol[], a: Map<string, number | null>) => makePredictor(rows, a, FULL_OPTS);
  const loo = looTest(comps, ages, buildFull);
  const time = timeTest(comps, ages, buildFull);
  const flatLoo = looTest(comps, ages, flatPredictor);
  const flatTime = timeTest(comps, ages, flatPredictor);

  // Term-by-term ablation, each variant against the curve alone. A term is
  // kept when it never worsens either held-out test and improves at least
  // one; the numbers below are the rounded misses the page prints.
  const curveLoo = looTest(comps, ages, (rows, a) => makePredictor(rows, a, { cat: false, growth: false, season: false }));
  const curveTime = timeTest(comps, ages, (rows, a) => makePredictor(rows, a, { cat: false, growth: false, season: false }));
  const variant = (opts: FitOptions) => ({
    loo: looTest(comps, ages, (rows, a) => makePredictor(rows, a, opts)).miss,
    time: timeTest(comps, ages, (rows, a) => makePredictor(rows, a, opts)).miss,
  });
  const catV = variant({ cat: true, growth: false, season: false });
  const growthV = variant({ cat: false, growth: true, season: false });
  const seasonV = variant({ cat: false, growth: false, season: true });
  // Two more candidate terms, tested the same way and never adopted in
  // this round: their slopes are fitted inside each fold, like the curve.
  const chainsV = variant({ cat: false, growth: false, season: false, chains: true });
  const logAgeV = variant({ cat: false, growth: false, season: false, logAge: true });
  const kept = (v: { loo: number; time: number }) =>
    v.loo <= curveLoo.miss && v.time <= curveTime.miss && (v.loo < curveLoo.miss || v.time < curveTime.miss) ? 'kept' : 'tested, not kept';
  // A candidate that passes both tests is still NOT adopted here (this
  // round is display-only) — it is labelled honestly as held, not kept.
  const held = (v: { loo: number; time: number }) =>
    kept(v) === 'kept' ? 'passes tests — held for a future model round' : 'tested, not kept';
  const ablation = [
    { term: 'Flat mcap/TVL multiple', loo: flatLoo.miss, time: flatTime.miss, verdict: 'baseline' },
    { term: 'Size curve log(mcap) on log(TVL)', loo: curveLoo.miss, time: curveTime.miss, verdict: 'kept' },
    { term: 'Curve + category only', loo: catV.loo, time: catV.time, verdict: kept(catV) },
    { term: 'Curve + 7-day growth only', loo: growthV.loo, time: growthV.time, verdict: kept(growthV) },
    { term: 'Curve + seasoning only', loo: seasonV.loo, time: seasonV.time, verdict: kept(seasonV) },
    { term: 'Curve + chain count only', loo: chainsV.loo, time: chainsV.time, verdict: held(chainsV) },
    { term: 'Curve + log-age only', loo: logAgeV.loo, time: logAgeV.time, verdict: held(logAgeV) },
    { term: 'Full model (all four terms)', loo: loo.miss, time: time.miss, verdict: 'kept' },
  ];

  // Bands from the final model's leave-one-out residuals.
  const residuals = looResiduals(comps, ages, FULL_OPTS);
  const bands = { q10: quantile(residuals, 0.1), q25: quantile(residuals, 0.25), q75: quantile(residuals, 0.75), q90: quantile(residuals, 0.9) };

  // Price every rankable protocol.
  const fullPred = makePredictor(comps, ages, FULL_OPTS);
  interface Priced {
    p: Protocol;
    age: number | null;
    curve: number;
    catF: number;
    growthF: number;
    seasonF: number;
    ifLaunches: number;
    odds: number;
    implied: number;
  }
  const priced: Priced[] = rankable.map((p) => {
    const age = ages.get(p.slug) ?? null;
    const curve = Math.pow(10, curveFit.a + curveFit.b * Math.log10(p.tvl_usd));
    const catF = Math.pow(10, catFx.get(p.category ?? 'Uncategorised') ?? 0);
    const growthF = growthFactor(p);
    const seasonF = seasonFactor(age);
    const ifLaunches = Math.pow(10, fullPred(p, age));
    const odds = oddsFor(age, oddsModel);
    return { p, age, curve, catF, growthF, seasonF, ifLaunches, odds, implied: Math.max(1, Math.round(ifLaunches * odds)) };
  });

  // Rank by implied value; ties break by slug, then values are nudged down
  // a dollar at a time so every row's value is distinct and non-increasing.
  priced.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  for (let i = 1; i < priced.length; i++) {
    if (priced[i]!.implied >= priced[i - 1]!.implied) priced[i]!.implied = Math.max(1, priced[i - 1]!.implied - 1);
  }

  // Bootstrap rank ranges: 200 refits on resampled comps, fixed seed.
  const rng = mulberry32(BOOT_SEED);
  const ranks = new Map<string, number[]>();
  for (const pr of priced) ranks.set(pr.p.slug, []);
  for (let ref = 0; ref < BOOT_REFS; ref++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const pred = makePredictor(sample, ages, FULL_OPTS);
    const scored = priced.map((pr) => ({ slug: pr.p.slug, v: Math.pow(10, pred(pr.p, pr.age)) * pr.odds }));
    scored.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => ranks.get(s.slug)!.push(i + 1));
  }
  const rankRange = (slug: string): [number, number] => {
    const rs = ranks.get(slug)!;
    return [Math.max(1, Math.round(quantile(rs, 0.1))), Math.min(priced.length, Math.round(quantile(rs, 0.9)))];
  };

  // Farm economics and rows.
  const rows: RadarRow[] = priced.map((pr, i) => {
    const p = pr.p;
    const { chain, gas } = cheapestChain(p);
    const deposit = depositFor(p.tvl_usd);
    const hold = holdFor(pr.age);
    const fees = round2(GAS_TXS * gas + GAS_FIXED);
    const play = playFor(p.category);
    const steps = farmSteps(p, play, chain, gas, deposit, hold, fees);
    const hours = round2(1.0 + 0.3 * steps.length);
    const slice = round2(DROP_SHARE * pr.implied * (deposit / p.tvl_usd));
    const tbill = round2(deposit * TBILL * (hold / 365));
    const net = round2(slice - fees - tbill);
    const netHour = round2(net / hours);
    const verdict = net > 0 ? 'FARM' : slice > fees ? 'MARGINAL-THIN' : 'SKIP';
    const sliceIfLaunches = DROP_SHARE * pr.ifLaunches * (deposit / p.tvl_usd);
    const breakeven = sliceIfLaunches > 0 ? round2((fees + tbill) / sliceIfLaunches) : 1;
    const k = (DROP_SHARE * pr.implied) / p.tvl_usd - (TBILL * hold) / 365;
    const paysFrom = k > 0 ? Math.max(1, Math.ceil(fees / k)) : null;
    const [rankLo, rankHi] = rankRange(p.slug);
    const tier = watch.has(p.slug) ? 'watchlist' : pr.age !== null && pr.age <= 180 ? 'early' : p.change_7d !== null && p.change_7d >= 25 ? 'early' : 'off-list';
    return {
      slug: p.slug,
      name: p.name,
      cat: p.category ?? 'Uncategorised',
      chains: p.chains,
      chain,
      tvl: p.tvl_usd,
      chg7: p.change_7d,
      age: pr.age,
      tier,
      rank: i + 1,
      rankLo,
      rankHi,
      curve: Math.max(1, Math.round(pr.curve)),
      catF: round4(pr.catF),
      growthF: round4(pr.growthF),
      seasonF: round4(pr.seasonF),
      ifLaunches: Math.max(1, Math.round(pr.ifLaunches)),
      odds: round4(pr.odds),
      implied: pr.implied,
      p25: Math.max(1, Math.round(pr.implied * Math.pow(10, bands.q25))),
      p75: Math.max(1, Math.round(pr.implied * Math.pow(10, bands.q75))),
      p10: Math.max(1, Math.round(pr.implied * Math.pow(10, bands.q10))),
      p90: Math.max(1, Math.round(pr.implied * Math.pow(10, bands.q90))),
      deposit,
      hold,
      fees,
      hours,
      slice,
      tbill,
      net,
      netHour,
      verdict,
      breakeven,
      paysFrom,
      play: play.play,
      steps,
    };
  });

  const board: BoardRow[] = rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied, farm_steps: r.steps }));
  const totalImplied = rows.reduce((s, r) => s + r.implied, 0);
  const totalTvl = rows.reduce((s, r) => s + r.tvl, 0);

  // Category offsets for the Method tab: factor per category with comp counts.
  const catCounts = new Map<string, number>();
  for (const c of comps) catCounts.set(c.category ?? 'Uncategorised', (catCounts.get(c.category ?? 'Uncategorised') ?? 0) + 1);
  const catOffsets = [...catFx.entries()]
    .map(([cat, logF]) => ({ cat, n: catCounts.get(cat) ?? 0, factor: round2(Math.pow(10, logF)) }))
    .sort((a, b) => b.factor - a.factor);

  const live = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, cat: p.category ?? 'Uncategorised', tvl: p.tvl_usd, mcap: p.mcap_usd!, sym: p.symbol ?? '' }))
    .sort((a, b) => b.mcap - a.mcap);
  const compsOut = comps.map((p) => ({ slug: p.slug, name: p.name, cat: p.category ?? 'Uncategorised', tvl: p.tvl_usd, mcap: p.mcap_usd!, sym: p.symbol ?? '' }));

  const reasons = [...reasonCounts.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    snapshot_n: protocols.length,
    watchlist_n: snapshot.watchlist.length,
    comps_n: comps.length,
    curve: {
      a: round2(curveFit.a * 100) / 100,
      b: round2(curveFit.b * 10000) / 10000,
      r2: round2(r2),
      formula: `10^${curveFit.a.toFixed(2)} x TVL^${curveFit.b.toFixed(3)}`,
    },
    cat_offsets: catOffsets,
    tests: {
      loo,
      time,
      flat: { loo_miss: flatLoo.miss, time_miss: flatTime.miss },
      brier: { ...brier, unshrunk: brierUnshrunkScore },
    },
    odds_buckets: oddsModel.buckets,
    ablation,
    accounting: { ranked: rows.length, trades, setAside, reasons },
    totals: {
      implied: totalImplied,
      tvl: totalTvl,
      farm: rows.filter((r) => r.verdict === 'FARM').length,
      marginal: rows.filter((r) => r.verdict === 'MARGINAL-THIN').length,
      skip: rows.filter((r) => r.verdict === 'SKIP').length,
    },
    total_implied: totalImplied,
    bands,
    gas: GAS_USD,
    rules: {
      deposit: 'Deposit $500 under $25M TVL, $1,000 under $100M, $2,500 under $500M, $5,000 above.',
      hold: 'Hold 120 days if on record under 6 months, 90 days under 18 months, 60 days otherwise.',
      verdict: 'FARM when net > $0; MARGINAL-THIN when the slice beats fees but not the 4% T-bill; SKIP otherwise.',
      tbill: TBILL,
      dropShare: DROP_SHARE,
    },
    rows,
    comps: compsOut,
    live,
    checksum: boardChecksum(board),
  };
  return { board, radar };
}

// ---- gate validation ---------------------------------------------------------

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, not 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  let prev = Infinity;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not a snapshot protocol`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!row.name) return `row ${row.slug} has no name`;
    if (ranks.has(row.rank)) return `rank ${row.rank} appears twice`;
    ranks.add(row.rank);
    const v = row.implied_value_usd;
    if (!Number.isInteger(v) || v <= 0 || v > 1e14) return `row ${row.slug} has implied value ${v}`;
    if (v > prev) return `implied values rise at rank ${row.rank}`;
    prev = v;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (let i = 1; i <= board.length; i++) if (!ranks.has(i)) return `rank ${i} is missing`;
  for (const w of snapshot.watchlist) if (!seen.has(w)) return `watchlist slug ${w} is missing from the board`;
  return null;
}

// ---- the dashboard's dataset -------------------------------------------------

export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
