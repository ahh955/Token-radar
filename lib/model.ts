// Token Radar's model, radar-2: peer-calibrated implied value, farm plans, and the
// dashboard's dataset. One snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and
// adds the 160 strongest pre-token protocols below the watchlist floor, chosen by the
// model's own implied value. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol). Live-token protocols are kept apart and
// shown with the market's own values, never mixed into the ranked board.
//
// Implied value is calibrated on the snapshot itself, never on a hardcoded list of names:
//
//   multiple   = the MEDIAN mcap/TVL of the live-token protocols in the same category,
//                when that category has at least MIN_PEERS of them; otherwise the
//                global median mcap/TVL across every live-token protocol. Capped at
//                MULTIPLE_CAP, so one thin category cannot print an absurd value.
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = MATURITY_FLOOR + min(age_days, MATURITY_DAYS) / MATURITY_DAYS x MATURITY_RANGE
//                (age_days unknown: UNKNOWN_AGE_DAYS; age is listed_at vs snapshot as_of)
//   implied    = max(1, round(base x growthMult x maturityMult))
//
// Every constant is stated in the dashboard's methodology section, and the dashboard
// recomputes each row from the same figures, so the page and board.json visibly agree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  min_peers: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  min_peers: 3,
  multiple_cap: 2,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many live peers the detail view shows for a protocol's category. */
export const PEER_ROWS = 3;

/** One category's peer calibration: the median mcap/TVL the market gives its live tokens. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  multiple: number;
  fallback: boolean;
}

/** The whole calibration: the global median and one multiple per category. */
export interface Calibration {
  global_multiple: number;
  global_peers: number;
  categories: CategoryMultiple[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with its model's working shown. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js; the page generates the farm plan from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: BoardRow['model'];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

/** One live peer of a category, for the detail view's calibration panel. */
export interface PeerRow {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** Everything the dashboard needs: the board, the live set, the peers and the calibration. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  calibration: Calibration;
  rows: RadarRow[];
  live: LiveRow[];
  peers: Record<string, PeerRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; 0 when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is live-token with a market cap the calibration can use. */
function isCalibrating(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The peer calibration, computed from the snapshot alone: the median mcap/TVL of the
 * live-token protocols in each category (when the category has MIN_PEERS of them, else
 * the global median), and the global median across every live-token protocol.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter(isCalibrating);
  const globalMultiple = Math.min(median(live.map((p) => p.mcap_usd! / p.tvl_usd)), model.multiple_cap);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  const rows: CategoryMultiple[] = [...categories].map((category) => {
    const peers = byCategory.get(category) ?? [];
    const fallback = peers.length < model.min_peers;
    const multiple = fallback ? globalMultiple : Math.min(median(peers), model.multiple_cap);
    return { category, peers: peers.length, multiple, fallback };
  });
  rows.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_multiple: globalMultiple, global_peers: live.length, categories: rows };
}

/** The multiple one category scores with, from the calibration. */
function multipleFor(category: string | null, calibration: Calibration): { multiple: number; source: 'category' | 'global' } {
  const key = category ?? 'Other';
  const row = calibration.categories.find((c) => c.category === key);
  if (row === undefined || row.fallback) return { multiple: calibration.global_multiple, source: 'global' };
  return { multiple: row.multiple, source: 'category' };
}

/** The implied value one protocol gets, with every step of the arithmetic shown. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): {
  implied: number;
  base: number;
  multiple: number;
  multipleSource: 'category' | 'global';
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const { multiple, source } = multipleFor(protocol.category, calibration);
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base, multiple, multipleSource: source, growthPct, growthMult, maturityMult, age };
}

// ---------------------------------------------------------------- farm plans

/** The farm family a category belongs to: one action template per family, never per name. */
type FarmFamily =
  | 'stake' | 'bridge' | 'lend' | 'dex' | 'derivatives' | 'prediction' | 'vault' | 'rwa'
  | 'insurance' | 'stable' | 'basis' | 'btc' | 'payments' | 'index' | 'otc' | 'governance'
  | 'chain' | 'yield' | 'generic';

function familyOf(category: string | null): FarmFamily {
  const c = (category ?? '').toLowerCase();
  if (c.includes('stak') || c.includes('restak')) return 'stake';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lend';
  if (c.includes('dex')) return 'dex';
  if (c.includes('perpetual') || c.includes('derivative')) return 'derivatives';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return 'vault';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('stable') || c.includes('dual-token')) return 'stable';
  if (c.includes('basis')) return 'basis';
  if (c.includes('btc') || c.includes('anchor')) return 'btc';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('index')) return 'index';
  if (c.includes('otc')) return 'otc';
  if (c.includes('governance')) return 'governance';
  if (c.includes('chain')) return 'chain';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  return 'generic';
}

/** The family's main action: what to do first with the capital, naming the protocol and chain. */
function mainAction(family: FarmFamily, name: string, capital: number, chain: string): string {
  switch (family) {
    case 'stake': return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in your wallet.`;
    case 'bridge': return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    case 'lend': return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    case 'dex': return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    case 'derivatives': return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
    case 'prediction': return `Fund your account with $${capital} and place one market position on ${name}.`;
    case 'vault': return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
    case 'rwa': return `Mint $${capital} of the protocol's yield-bearing asset through ${name} on ${chain} and hold it.`;
    case 'insurance': return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
    case 'stable': return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    case 'basis': return `Deposit $${capital} into ${name}'s basis-trading vault on ${chain} and keep the shares.`;
    case 'btc': return `Deposit $${capital} of BTC-backed collateral through ${name} on ${chain} and hold the receipt.`;
    case 'payments': return `Fund $${capital} through ${name} and make one real payment with it.`;
    case 'index': return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
    case 'otc': return `Place one $${capital} OTC order through ${name} on ${chain}.`;
    case 'governance': return `Deposit $${capital} into ${name}'s incentive pool on ${chain} and vote when a proposal opens.`;
    case 'chain': return `Move $${capital} onto ${name}'s chain and use its main app at least once.`;
    case 'yield': return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
    default: return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The family's weekly action: the repeatable step that keeps the position qualifying. */
function weeklyAction(family: FarmFamily, name: string): string {
  switch (family) {
    case 'stake': return `Restake or compound the staking rewards ${name} pays you, so the position keeps growing.`;
    case 'bridge': return `Bridge a small amount back, or to a second chain, through ${name} once a week so the bridge sees repeat use.`;
    case 'lend': return `Borrow a small amount against your deposit on ${name}, then repay it the same week.`;
    case 'dex': return `Route one swap through ${name}'s pool each week instead of another exchange.`;
    case 'derivatives': return `Open and close one small hedged position on ${name} each week.`;
    case 'prediction': return `Place one small position on a new market on ${name} each week.`;
    case 'vault': return `Top up the ${name} vault with a small amount each week and check the vault's yield.`;
    case 'rwa': return `Reinvest the yield ${name} pays into the same asset once a week.`;
    case 'insurance': return `Renew or top up your cover on ${name} when the policy nears expiry.`;
    case 'stable': return `Mint or redeem a small amount of the stable asset through ${name} each week.`;
    case 'basis': return `Check ${name}'s funding-rate report each week and add to the vault when the rate is positive.`;
    case 'btc': return `Add a small amount of BTC-backed collateral to ${name} each week.`;
    case 'payments': return `Make one real payment with ${name} each week.`;
    case 'index': return `Add a small amount to the ${name} index each week.`;
    case 'otc': return `Place one small OTC order through ${name} each week.`;
    case 'governance': return `Vote on every ${name} proposal that opens, and read its forum once a week.`;
    case 'chain': return `Use ${name}'s chain at least once a week: a swap, a transfer or a contract call.`;
    case 'yield': return `Claim the yield ${name} pays you and re-deposit it once a week.`;
    default: return `Make one more deposit, swap or vote on ${name} each week.`;
  }
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain: Ethereum is dear, most chains are cheap. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $12 of gas';
  if (chain === 'Bitcoin' || chain === 'Tron') return 'about $4 of gas';
  return 'under $2 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names: the same function plans every row.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyOf(p.category);
  return [
    {
      text: 'Set up a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline on paper.',
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: mainAction(family, p.name, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyAction(family, p.name),
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Open ${p.name}'s own points or rewards page once a week and confirm your activity still shows.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so your activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When a token or points claim opens, claim only from the link ${p.name} publishes on its own page — never from a reply, a DM or an ad.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever the model thinks of it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, scored by the
  // model and taken by implied value — the strongest early finds, not just the biggest TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, calibration, model).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      multiple: s.v.multiple,
      multiple_source: s.v.multipleSource,
      base_usd: s.v.base,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isCalibrating(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: p.mcap_usd! / p.tvl_usd,
    }));
}

/** The top live peers of each category, by market cap, for the detail view. */
export function peersByCategory(snapshot: Snapshot): Record<string, PeerRow[]> {
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols.filter(isCalibrating)) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [p]);
    else list.push(p);
  }
  const out: Record<string, PeerRow[]> = {};
  for (const key of [...byCat.keys()].sort()) {
    out[key] = byCat
      .get(key)!
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, PEER_ROWS)
      .map((p) => ({ name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, ratio: p.mcap_usd! / p.tvl_usd }));
  }
  return out;
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    model: row.model,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const liveTotal = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_total: liveTotal,
    calibration,
    rows: board.map(radarRow),
    live,
    peers: peersByCategory(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
