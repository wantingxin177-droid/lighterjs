import {
  mysqlTable,
  serial,
  varchar,
  text,
  int,
  bigint,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ============ 轻节点同步状态 ============
export const syncState = mysqlTable("sync_state", {
  id: serial("id").primaryKey(),
  job: varchar("job", { length: 64 }).notNull().unique(),
  cursor: bigint("cursor", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============ L2 区块 ============
export const blocks = mysqlTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    height: bigint("height", { mode: "number" }).notNull(),
    time: varchar("time", { length: 40 }),
    ts: bigint("ts", { mode: "number" }), // unix seconds
    nTxs: int("n_txs").notNull().default(0), // total_transactions reported
    nLogs: int("n_logs").notNull().default(0), // decoded logs count
    typesJson: text("types_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("blocks_height_uq").on(t.height), index("blocks_ts_idx").on(t.ts)]
);

// ============ L2 区块内交易 ============
export const blockTxs = mysqlTable(
  "block_txs",
  {
    id: serial("id").primaryKey(),
    blockHeight: bigint("block_height", { mode: "number" }).notNull(),
    txType: varchar("tx_type", { length: 64 }).notNull(),
    hash: varchar("hash", { length: 128 }).notNull(),
    time: varchar("time", { length: 40 }),
    pubdataType: varchar("pubdata_type", { length: 64 }),
    market: int("market"),
    price: varchar("price", { length: 40 }),
    size: varchar("size", { length: 40 }),
    taker: varchar("taker", { length: 32 }),
    maker: varchar("maker", { length: 32 }),
    rawJson: text("raw_json"),
  },
  (t) => [
    uniqueIndex("block_txs_hash_uq").on(t.hash),
    index("block_txs_height_idx").on(t.blockHeight),
    index("block_txs_type_idx").on(t.txType),
  ]
);

// ============ 区块内市场快照 ============
export const blockMarkets = mysqlTable(
  "block_markets",
  {
    id: serial("id").primaryKey(),
    blockHeight: bigint("block_height", { mode: "number" }).notNull(),
    marketIndex: int("market_index").notNull(),
    price: varchar("price", { length: 40 }),
    indexPrice: varchar("index_price", { length: 40 }),
    openInterest: varchar("open_interest", { length: 40 }),
    fundingRate: varchar("funding_rate", { length: 40 }),
  },
  (t) => [index("block_markets_height_idx").on(t.blockHeight)]
);

// ============ L1 结算批次 ============
export const batches = mysqlTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    batchNumber: bigint("batch_number", { mode: "number" }).notNull(),
    time: varchar("time", { length: 40 }),
    size: int("size").notNull().default(0),
    status: varchar("status", { length: 64 }),
    commitTx: varchar("commit_tx", { length: 80 }),
    verifyTx: varchar("verify_tx", { length: 80 }),
    executeTx: varchar("execute_tx", { length: 80 }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("batches_number_uq").on(t.batchNumber)]
);

// ============ 市场快照（行情） ============
export const marketSnapshots = mysqlTable(
  "market_snapshots",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    marketId: int("market_id").notNull(),
    price: varchar("price", { length: 40 }),
    markPrice: varchar("mark_price", { length: 40 }),
    indexPrice: varchar("index_price", { length: 40 }),
    vol24: varchar("vol24", { length: 40 }),
    trades24: int("trades24"),
    chg24: varchar("chg24", { length: 40 }),
    high24: varchar("high24", { length: 40 }),
    low24: varchar("low24", { length: 40 }),
    openInterest: varchar("open_interest", { length: 40 }),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
  },
  (t) => [index("market_snap_symbol_idx").on(t.symbol), index("market_snap_time_idx").on(t.capturedAt)]
);

// ============ 资金费率历史 ============
export const fundingRates = mysqlTable(
  "funding_rates",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    marketId: int("market_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(), // unix seconds (hour)
    rate: varchar("rate", { length: 40 }).notNull(),
    direction: varchar("direction", { length: 16 }),
  },
  (t) => [uniqueIndex("funding_uq").on(t.marketId, t.ts), index("funding_symbol_idx").on(t.symbol)]
);

// ============ LIT 链上转账事件 ============
export const litTransfers = mysqlTable(
  "lit_transfers",
  {
    id: serial("id").primaryKey(),
    txHash: varchar("tx_hash", { length: 80 }).notNull(),
    logIndex: int("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(), // estimated unix seconds
    fromAddr: varchar("from_addr", { length: 64 }).notNull(),
    toAddr: varchar("to_addr", { length: 64 }).notNull(),
    valueLit: varchar("value_lit", { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex("lit_tx_uq").on(t.txHash, t.logIndex),
    index("lit_block_idx").on(t.blockNumber),
    index("lit_ts_idx").on(t.ts),
  ]
);

// ============ 订单生命周期事件（从 L2 区块重建） ============
export const orderEvents = mysqlTable(
  "order_events",
  {
    id: serial("id").primaryKey(),
    blockHeight: bigint("block_height", { mode: "number" }).notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    txHash: varchar("tx_hash", { length: 128 }).notNull(),
    eventType: varchar("event_type", { length: 40 }).notNull(), // create / fill / partial_fill / cancel / expire / claim
    ownerAccount: varchar("owner_account", { length: 32 }),
    marketIndex: int("market_index"),
    price: varchar("price", { length: 40 }),
    size: varchar("size", { length: 40 }),
    side: varchar("side", { length: 8 }), // bid/ask 若可判定
    rawJson: text("raw_json"),
  },
  (t) => [
    uniqueIndex("order_events_uq").on(t.txHash, t.eventType),
    index("order_events_owner_idx").on(t.ownerAccount),
    index("order_events_height_idx").on(t.blockHeight),
    index("order_events_ts_owner_idx").on(t.ts, t.ownerAccount),
  ]
);

// ============ 盘口快照（全档位） ============
export const bookSnapshots = mysqlTable(
  "book_snapshots",
  {
    id: serial("id").primaryKey(),
    marketId: int("market_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(), // ms
    bestBid: varchar("best_bid", { length: 40 }),
    bestAsk: varchar("best_ask", { length: 40 }),
    bidsJson: text("bids_json"), // [[price,size,owner],...] 前 N 档
    asksJson: text("asks_json"),
    wsOffset: bigint("ws_offset", { mode: "number" }),
    source: varchar("source", { length: 16 }).notNull().default("poll"), // poll / websocket
  },
  (t) => [index("book_snap_idx").on(t.marketId, t.ts)]
);

// ============ 盘口逐档 diff ============
export const bookDiffs = mysqlTable(
  "book_diffs",
  {
    id: serial("id").primaryKey(),
    marketId: int("market_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(), // ms
    side: varchar("side", { length: 8 }).notNull(), // bid/ask
    price: varchar("price", { length: 40 }).notNull(),
    prevSize: varchar("prev_size", { length: 40 }),
    newSize: varchar("new_size", { length: 40 }),
    change: varchar("change_type", { length: 12 }).notNull(), // add/update/remove
    wsOffset: bigint("ws_offset", { mode: "number" }),
    source: varchar("source", { length: 16 }).notNull().default("poll"), // poll / websocket
  },
  (t) => [
    index("book_diffs_idx").on(t.marketId, t.ts),
    index("book_diffs_market_id_idx").on(t.marketId, t.id),
  ]
);

// ============ WebSocket 逐账户实时快照 ============
export const accountSnapshots = mysqlTable(
  "account_snapshots",
  {
    id: serial("id").primaryKey(),
    account: varchar("account", { length: 32 }).notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(), // ms
    dailyTrades: int("daily_trades"),
    dailyVolume: varchar("daily_volume", { length: 64 }),
    weeklyTrades: int("weekly_trades"),
    weeklyVolume: varchar("weekly_volume", { length: 64 }),
    monthlyTrades: int("monthly_trades"),
    monthlyVolume: varchar("monthly_volume", { length: 64 }),
    totalTrades: int("total_trades"),
    totalVolume: varchar("total_volume", { length: 64 }),
    assetsJson: text("assets_json"),
    positionsJson: text("positions_json"),
  },
  (t) => [index("account_snap_idx").on(t.account, t.ts)]
);

// ============ WebSocket 逐账户实时成交 ============
export const accountTrades = mysqlTable(
  "account_trades",
  {
    id: serial("id").primaryKey(),
    account: varchar("account", { length: 32 }).notNull(),
    tradeId: varchar("trade_id", { length: 48 }).notNull(),
    marketId: int("market_id"),
    txHash: varchar("tx_hash", { length: 128 }),
    blockHeight: bigint("block_height", { mode: "number" }),
    ts: bigint("ts", { mode: "number" }).notNull(), // ms
    side: varchar("side", { length: 8 }), // 该账户视角 bid/ask
    role: varchar("role", { length: 8 }), // maker/taker
    size: varchar("size", { length: 40 }),
    price: varchar("price", { length: 40 }),
    usdAmount: varchar("usd_amount", { length: 40 }),
    counterpartyAccount: varchar("counterparty_account", { length: 32 }),
    rawJson: text("raw_json"),
  },
  (t) => [
    uniqueIndex("account_trades_uq").on(t.account, t.tradeId),
    index("account_trades_account_idx").on(t.account, t.ts),
    index("account_trades_market_idx").on(t.marketId, t.ts),
  ]
);
