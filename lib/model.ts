// Signal Radar model: one sealed DefiLlama snapshot in, one ranked pre-token board out.
//
// The board never names a protocol by hand. Every row is scored by the same function of the
// snapshot's own figures: TVL, seven-day TVL change, and how long the record has run with no token
// (listed_at). Protocols whose index entry already records a token are set aside for the live view,
// so the ranking compares only pre-token candidates with each other.
//
//   base     = tvl_usd x BASE
//   growth   = 1 + clamp(change_7d, -60, 120) / 100 x GROWTH_WEIGHT
//   overdue  = 0.80 + min(age_days, 1095) / 1095 x 0.40   (a long record with no token scores higher)
//   implied  = max(1, round(base x growth x overdue))
//
// The constants are stated on the dashboard and changeable here. No slug, name or chain is
// special-cased anywhere: the same arithmetic scores all 758 records before the gate filters them.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  overdue_floor: number;
  overdue_range: number;
  overdue_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base: 0.30,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  overdue_floor: 0.80,
  overdue_range: 0.40,
  overdue_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'signal-radar-2';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string; }

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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base: number;
    base_value: number;
    growth_pct: number;
    growth_multiplier: number;
    overdue_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_value: number;
  growth_multiplier: number;
  overdue_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

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
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants) {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const overdueMult = model.overdue_floor + (Math.min(Math.max(ageForModel, 0), model.overdue_days) / model.overdue_days) * model.overdue_range;
  const baseValue = protocol.tvl_usd * model.base;
  const implied = Math.max(1, Math.round(baseValue * growthMult * overdueMult));
  return { implied, growthPct, growthMult, overdueMult, baseValue, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base: model.base,
      base_value: Math.round(s.baseValue),
      growth_pct: round2(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      overdue_multiplier: round4(s.overdueMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position until a snapshot records it.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }
function allChains(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains.slice(0, 3).join(', ') : 'the chain it runs on'; }
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}
function gasFor(p: SnapshotProtocol): number {
  const c = chainOf(p).toLowerCase();
  if (c.includes('ethereum') || c.includes('arbitrum') || c.includes('optimism') || c.includes('base')) return 6;
  if (c.includes('solana') || c.includes('ton') || c.includes('stellar') || c.includes('algorand')) return 1;
  return 3;
}
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain} and let the position accrue.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity')) return `Provide $${capital} of two-sided liquidity to ${name}'s main pool on ${chain} and keep the receipt.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('basis')) return `Deposit $${capital} into ${name}'s yield vault on ${chain} and keep the share tokens.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds once in its app.`;
  if (c.includes('staking') || c.includes('restak') || c.includes('pooling')) return `Stake $${capital} of the chain's liquid staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('perp')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the shares.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s on-chain yield asset on ${chain} and hold it through one distribution.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} on ${chain} and make one transaction in its native app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chains = allChains(p);
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    { text: `Open a fresh wallet funded with only the $${capital} you plan to commit; keep its seed phrase offline and never reuse it elsewhere.`, cost: `$${capital} capital, no platform fee`, time: '5 minutes' },
    { text: `Connect that wallet to ${p.name} on ${chains}; confirm you are on the protocol's own app, not a search result or a link in a DM.`, cost: `one network connection, about $${gas} of gas`, time: '10 minutes' },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes' },
    { text: `Repeat one small qualifying action each week: a deposit, a borrow, a swap or a governance vote. Uneven weeks count as real use.`, cost: `about $${Math.max(1, Math.round(gas / 2))} of gas a week`, time: '10 minutes a week' },
    { text: `Keep the first position open for at least ${hold} days so more than one weekly snapshot records the activity.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Check the protocol's own points or rewards page before you withdraw, and claim only from the link the protocol publishes itself.`, cost: 'no cost to check; never pay to claim', time: '10 minutes' },
    { text: `Record the wallet address, each date and every transaction hash in a farm log, so you can prove the activity and unwind cleanly.`, cost: 'nothing beyond the log', time: '5 minutes' },
    { text: `Set a reminder to re-check ${p.name}'s own announcements monthly; stop farming if the protocol says no token is planned.`, cost: 'no capital at risk', time: 'monthly, 5 minutes' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd, base_value: row.model.base_value,
    growth_multiplier: row.model.growth_multiplier, overdue_multiplier: row.model.overdue_multiplier,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model,
    model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: early, live_size: live.length, rows: board.map(radarRow), live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`protocol ${i} lacks a slug, name or TVL`);
    return {
      slug: p.slug, name: p.name,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all rows share one implied value ${board[0]!.implied_value_usd}`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string { return `window.RADAR=${JSON.stringify(radar)};\n`; }
