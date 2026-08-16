export interface ExplTx {
  type: string;
  hash: string;
  time: string;
  ptype?: string | null;
  market?: number | null;
  price?: string | null;
  size?: string | null;
  taker?: string | null;
  maker?: string | null;
}

export interface BlockMarketSnap { i: number; px: number; oi: number; fr: number }

export interface ExplBlock {
  h: number;
  n_txs: number;
  n_logs: number;
  time: string | null;
  ts: number | null;
  types: Record<string, number>;
  txs: ExplTx[];
  markets: BlockMarketSnap[];
}

export interface Batch {
  n: number;
  time: string;
  size: number;
  status: string | null;
  commit?: string | null;
  verify?: string | null;
  execute?: string | null;
}

export interface ExplorerData {
  blocks: ExplBlock[];
  batches: Batch[];
  meta: {
    latest_height: number;
    synced_at: number;
    blocks_synced: number;
    span_sec: number;
    source: string;
  };
}

export async function loadExplorer(): Promise<ExplorerData> {
  const res = await fetch(`${import.meta.env.BASE_URL}explorer_data.json`);
  return res.json();
}

export const TX_TYPE_LABEL: Record<string, string> = {
  L2CreateOrder: "创建订单",
  InternalClaimOrder: "撮合成交",
  InternalTransfer: "内部转账",
  L2Transfer: "L2 转账",
  L2UpdateLeverage: "调整杠杆",
  L2CancelOrder: "取消订单",
  L2Deposit: "充值",
  L2Withdraw: "提现",
  L2CreatePublicPool: "创建公共池",
};

export function txLabel(t: string): string {
  return TX_TYPE_LABEL[t] ?? t;
}
