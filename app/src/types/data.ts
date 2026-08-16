export interface Market {
  symbol: string;
  market_id: number;
  price: number;
  mark: number;
  index: number;
  vol24: number;
  trades24: number;
  chg24: number;
  high24: number;
  low24: number;
  oi_base: number;
  oi_usd: number;
  funding_clamp_small?: string;
  base_interest?: string;
}

export interface FundingPoint { t: number; rate: number }
export interface DepthSide { bids: [number, number][]; asks: [number, number][] }
export interface TapeTrade { t: number; px: number; sz: number; usd: number; buy: boolean }

export interface LitDaily { day: string; count: number; volume: number; active: number }
export interface Whale { t: number; from: string; to: string; v: number; tx: string }
export interface AddrVol { addr: string; v: number }

export interface LighterData {
  markets: Market[];
  fundings: Record<string, FundingPoint[]>;
  depth: Record<string, DepthSide>;
  trades: Record<string, TapeTrade[]>;
  lit: {
    supply: number;
    daily: LitDaily[];
    whales: Whale[];
    top_senders: AddrVol[];
    top_receivers: AddrVol[];
    contract: string;
    period_days: number;
  };
  meta: {
    collected_at: number;
    source_api: string;
    lit_contract: string;
    eth_block: number;
    note: string;
  };
}

export async function loadData(): Promise<LighterData> {
  const res = await fetch(`${import.meta.env.BASE_URL}lighter_data.json`);
  return res.json();
}

export function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

export function fmtNum(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeStr(t: number): string {
  return new Date(t * 1000).toLocaleString("zh-CN", { hour12: false });
}
