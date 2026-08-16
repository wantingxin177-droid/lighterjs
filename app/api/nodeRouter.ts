import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { blocks, blockTxs, blockMarkets, batches, marketSnapshots, fundingRates, litTransfers, syncState, orderEvents, bookSnapshots, bookDiffs, accountSnapshots, accountTrades } from "@db/schema";
import { desc, eq, sql, gte, and, gt, inArray } from "drizzle-orm";
import { syncStats } from "./syncer";
import { getLiveBook, subscribeAccount, wsRuntime } from "./wsCollector";

const ACTIVE_WINDOWS = [
  { key: "30m", label: "近30分钟", seconds: 30 * 60 },
  { key: "1h", label: "近1小时", seconds: 60 * 60 },
  { key: "2h", label: "近2小时", seconds: 2 * 60 * 60 },
  { key: "3h", label: "近3小时", seconds: 3 * 60 * 60 },
  { key: "4h", label: "近4小时", seconds: 4 * 60 * 60 },
  { key: "5h", label: "近5小时", seconds: 5 * 60 * 60 },
  { key: "10h", label: "近10小时", seconds: 10 * 60 * 60 },
  { key: "24h", label: "近24小时", seconds: 24 * 60 * 60 },
] as const;

type ActiveAccountRow = {
  account: string;
  events: number;
  creates: number;
  cancels: number;
  expires: number;
  takerFills: number;
  makerFills: number;
  buyEvents: number;
  sellEvents: number;
  markets: number;
  fillNotional: number;
  firstTs: number;
  lastTs: number;
};

type ActiveWindowResult = {
  key: string;
  label: string;
  seconds: number;
  sinceTs: number;
  activeAccounts: number;
  totalEvents: number;
  fillNotional: number;
  accounts: ActiveAccountRow[];
};

let activeWindowsCache: { expiresAt: number; generatedAt: number; anchorTs: number; windows: ActiveWindowResult[] } | null = null;

function toNumber(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export const nodeRouter = createRouter({
  // 节点状态：各同步任务健康度 + 数据统计
  status: publicQuery.query(async () => {
    const db = getDb();
    const [b] = await db.select({ n: sql<number>`count(*)`, maxH: sql<number>`max(height)` }).from(blocks);
    const [dt] = await db.select({ n: sql<number>`count(*)` }).from(blocks).where(sql`n_logs >= 0`);
    const [t] = await db.select({ n: sql<number>`count(*)` }).from(blockTxs);
    const [ba] = await db.select({ n: sql<number>`count(*)` }).from(batches);
    const [m] = await db.select({ n: sql<number>`count(*)` }).from(marketSnapshots);
    const [f] = await db.select({ n: sql<number>`count(*)` }).from(fundingRates);
    const [l] = await db.select({ n: sql<number>`count(*)` }).from(litTransfers);
    const [as] = await db.select({ n: sql<number>`count(*)` }).from(accountSnapshots);
    const [at] = await db.select({ n: sql<number>`count(*)` }).from(accountTrades);
    const cursors = await db.select().from(syncState);
    return {
      uptimeSec: Math.floor((Date.now() - syncStats.startedAt) / 1000),
      jobs: syncStats.jobs,
      cursors,
      ws: {
        connected: wsRuntime.connected,
        lastConnect: wsRuntime.lastConnect,
        lastMessage: wsRuntime.lastMessage,
        lastError: wsRuntime.lastError,
        reconnects: wsRuntime.reconnects,
        accounts: wsRuntime.accounts,
        markets: wsRuntime.markets,
      },
      counts: { blocks: b?.n ?? 0, latestHeight: b?.maxH ?? 0, blocksWithDetail: dt?.n ?? 0, txs: t?.n ?? 0, batches: ba?.n ?? 0, marketSnaps: m?.n ?? 0, fundings: f?.n ?? 0, litTransfers: l?.n ?? 0, accountSnaps: as?.n ?? 0, accountTrades: at?.n ?? 0 },
    };
  }),

  // 最近区块列表
  recentBlocks: publicQuery
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(blocks).orderBy(desc(blocks.height)).limit(input.limit);
      return rows.map((b) => ({ ...b, types: b.typesJson ? JSON.parse(b.typesJson) : {} }));
    }),

  // 区块详情（含逐笔交易与市场快照）；DB 未回填时实时从上游拉取并落库
  blockDetail: publicQuery
    .input(z.object({ height: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      let [b] = await db.select().from(blocks).where(eq(blocks.height, input.height)).limit(1);
      if (!b || b.nLogs < 0) {
        // 详情未回填：实时拉取
        const r = await fetch(`https://explorer.elliot.ai/api/blocks/${input.height}`, {
          headers: { "User-Agent": "LighterAnalyzer-LightNode/1.0" },
        });
        if (!r.ok) return b ? { block: { ...b, types: {} }, txs: [], markets: [], pending: true } : null;
        const d: any = await r.json();
        const logs = d.logs ?? [];
        const types: Record<string, number> = {};
        for (const l of logs) types[l.tx_type] = (types[l.tx_type] ?? 0) + 1;
        const firstTs = logs[0]?.time ? Math.floor(Date.parse(logs[0].time) / 1000) : null;
        await db.insert(blocks).values({
          height: d.block_number,
          time: logs[0]?.time ?? null,
          ts: firstTs,
          nTxs: d.total_transactions ?? 0,
          nLogs: logs.length,
          typesJson: JSON.stringify(types),
        }).onDuplicateKeyUpdate({
          set: { time: sql`values(time)`, ts: sql`values(ts)`, nTxs: sql`values(n_txs)`, nLogs: sql`values(n_logs)`, typesJson: sql`values(types_json)` },
        });
        if (logs.length) {
          await db.insert(blockTxs).values(
            logs.map((l: any) => {
              const tp = l.pubdata?.trade_pubdata ?? {};
              return {
                blockHeight: d.block_number, txType: l.tx_type, hash: l.hash, time: l.time ?? null,
                pubdataType: l.pubdata_type ?? null, market: tp.market_index ?? null,
                price: tp.price ?? null, size: tp.size ?? null,
                taker: tp.taker_account_index ?? null, maker: tp.maker_account_index ?? null,
                rawJson: JSON.stringify(l.pubdata ?? {}),
              };
            })
          ).onDuplicateKeyUpdate({ set: { blockHeight: d.block_number } });
        }
        if (d.markets?.length) {
          await db.insert(blockMarkets).values(
            d.markets.map((m: any) => ({
              blockHeight: d.block_number, marketIndex: m.market_index, price: m.market_price,
              indexPrice: m.index_price, openInterest: m.open_interest, fundingRate: m.last_funding_rate,
            }))
          );
        }
        [b] = await db.select().from(blocks).where(eq(blocks.height, input.height)).limit(1);
      }
      if (!b) return null;
      const txs = await db.select().from(blockTxs).where(eq(blockTxs.blockHeight, input.height));
      const mkts = await db.select().from(blockMarkets).where(eq(blockMarkets.blockHeight, input.height));
      return { block: { ...b, types: b.typesJson ? JSON.parse(b.typesJson) : {} }, txs, markets: mkts, pending: false };
    }),

  // 最近交易（跨区块）
  recentTxs: publicQuery
    .input(z.object({ limit: z.number().min(1).max(200).default(80) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.select().from(blockTxs).orderBy(desc(blockTxs.id)).limit(input.limit);
    }),

  // L1 结算批次
  batches: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(batches).orderBy(desc(batches.batchNumber)).limit(60);
  }),

  // 最新市场行情
  markets: publicQuery.query(async () => {
    const db = getDb();
    const [latest] = await db.select().from(marketSnapshots)
      .orderBy(desc(marketSnapshots.capturedAt)).limit(1);
    if (!latest) return [];
    return db.select().from(marketSnapshots).where(eq(marketSnapshots.capturedAt, latest.capturedAt));
  }),

  // 资金费率历史
  fundings: publicQuery.query(async () => {
    const db = getDb();
    const since = Math.floor(Date.now() / 1000) - 8 * 24 * 3600;
    return db.select().from(fundingRates).where(gte(fundingRates.ts, since)).orderBy(fundingRates.ts);
  }),

  // ---- 盘口：最新快照（WS 在线时直读内存，避免浏览器每秒扫描数据库） ----
  bookLatest: publicQuery
    .input(z.object({ marketId: z.number() }))
    .query(async ({ input }) => {
      const live = getLiveBook(input.marketId);
      if (live) {
        const bids = live.bids
          .filter((x) => x.size > 0)
          .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
          .slice(0, 60)
          .map((x): [string, number, string?] => [x.price, x.size, x.owner]);
        const asks = live.asks
          .filter((x) => x.size > 0)
          .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
          .slice(0, 60)
          .map((x): [string, number, string?] => [x.price, x.size, x.owner]);
        return {
          marketId: input.marketId,
          ts: Date.now(),
          bestBid: bids[0]?.[0] ?? null,
          bestAsk: asks[0]?.[0] ?? null,
          wsOffset: live.offset,
          source: "websocket-memory",
          bids,
          asks,
        };
      }
      const db = getDb();
      const [s] = await db.select().from(bookSnapshots)
        .where(eq(bookSnapshots.marketId, input.marketId))
        .orderBy(desc(bookSnapshots.ts)).limit(1);
      if (!s) return null;
      return {
        marketId: s.marketId, ts: s.ts, bestBid: s.bestBid, bestAsk: s.bestAsk,
        wsOffset: s.wsOffset, source: s.source,
        bids: JSON.parse(s.bidsJson ?? "[]") as [string, number, string?][],
        asks: JSON.parse(s.asksJson ?? "[]") as [string, number, string?][],
      };
    }),

  // ---- 盘口：某时间/游标之后的逐档 diff ----
  bookDiffsSince: publicQuery
    .input(z.object({
      marketId: z.number(),
      sinceTs: z.number().default(0),
      sinceId: z.number().default(0),
      limit: z.number().min(1).max(500).default(120),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(bookDiffs.marketId, input.marketId)];
      if (input.sinceId > 0) conditions.push(gt(bookDiffs.id, input.sinceId));
      else if (input.sinceTs > 0) conditions.push(gt(bookDiffs.ts, input.sinceTs));
      return db.select().from(bookDiffs)
        .where(and(...conditions))
        .orderBy(desc(bookDiffs.id)).limit(input.limit);
    }),

  // ---- 盘口深度带：以中间价为 0，将 ±6‰ / ±2.2% 各等分 10 档聚合 ----
  bookBands: publicQuery
    .input(z.object({ marketId: z.number() }))
    .query(({ input }) => {
      const live = getLiveBook(input.marketId);
      if (!live) return null;
      const bids = live.bids
        .map((x) => ({ price: parseFloat(x.price), size: x.size }))
        .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size) && x.size > 0)
        .sort((a, b) => b.price - a.price);
      const asks = live.asks
        .map((x) => ({ price: parseFloat(x.price), size: x.size }))
        .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size) && x.size > 0)
        .sort((a, b) => a.price - b.price);
      const bestBid = bids[0]?.price;
      const bestAsk = asks[0]?.price;
      if (!bestBid || !bestAsk) return null;
      const mid = (bestBid + bestAsk) / 2;

      const buildRange = (pct: number) => {
        const width = pct / 10;
        const buildSide = (side: "bid" | "ask") => {
          const levels = side === "bid" ? bids : asks;
          const rows = Array.from({ length: 10 }, (_, i) => ({
            index: i,
            fromPct: -(pct - i * width),
            toPct: -(pct - (i + 1) * width),
            fromPrice: 0,
            toPrice: 0,
            size: 0,
            quote: 0,
            levels: 0,
            avgPrice: 0,
            cumulative: 0,
          }));
          for (const l of levels) {
            const distance = side === "bid" ? (mid - l.price) / mid : (l.price - mid) / mid;
            if (distance < 0 || distance >= pct) continue;
            const idx = Math.min(9, Math.floor(distance / width));
            const r = rows[idx];
            r.size += l.size;
            r.quote += l.size * l.price;
            r.levels++;
          }
          let cumulative = 0;
          for (const r of rows) {
            const inner = side === "bid" ? 1 - r.index * width : 1 + r.index * width;
            const outer = side === "bid" ? 1 - (r.index + 1) * width : 1 + (r.index + 1) * width;
            r.fromPrice = mid * (side === "bid" ? outer : inner);
            r.toPrice = mid * (side === "bid" ? inner : outer);
            r.fromPct = side === "bid" ? -((r.index + 1) * width) : r.index * width;
            r.toPct = side === "bid" ? -(r.index * width) : (r.index + 1) * width;
            r.avgPrice = r.quote > 0 ? r.quote / r.size : 0;
            cumulative += r.size;
            r.cumulative = cumulative;
          }
          return rows;
        };
        return { pct, widthPct: width, bids: buildSide("bid"), asks: buildSide("ask") };
      };

      return {
        marketId: input.marketId,
        ts: Date.now(),
        wsOffset: live.offset,
        mid,
        bestBid,
        bestAsk,
        spread: bestAsk - bestBid,
        spreadBps: ((bestAsk - bestBid) / mid) * 10_000,
        bookLevels: { bids: bids.length, asks: asks.length },
        ranges: [buildRange(0.006), buildRange(0.022)],
      };
    }),

  // ---- 订单事件：按账户聚合的活动 ----
  accountActivity: publicQuery
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = getDb();
      // 活跃账户榜（按事件数）
      const top = await db.execute(sql`
        select owner_account as account,
               count(*) as events,
               sum(event_type='create') as creates,
               sum(event_type='fill') as taker_fills,
               sum(event_type='fill_maker') as maker_fills,
               max(ts) as last_ts
        from order_events
        where owner_account is not null and owner_account <> ''
        group by owner_account order by events desc limit ${input.limit}
      `);
      return ((top as any)[0] ?? top) as any[];
    }),

  // ---- 活跃账户：30m / 1h / ... / 24h 八个时间窗，一次返回并短缓存 ----
  activeAccountWindows: publicQuery
    .input(z.object({ limit: z.number().min(5).max(100).default(30) }))
    .query(async ({ input }) => {
      const nowMs = Date.now();
      if (activeWindowsCache && activeWindowsCache.expiresAt > nowMs) {
        return {
          generatedAt: activeWindowsCache.generatedAt,
          anchorTs: activeWindowsCache.anchorTs,
          cacheTtlMs: 30_000,
          windows: activeWindowsCache.windows.map((w) => ({ ...w, accounts: w.accounts.slice(0, input.limit) })),
        };
      }

      const db = getDb();
      const nowSec = Math.floor(nowMs / 1000);
      const [latestEvent] = await db.select({ ts: sql<number>`max(ts)` }).from(orderEvents);
      const anchorTs = Math.floor(toNumber(latestEvent?.ts) || nowSec);
      const windows: ActiveWindowResult[] = await Promise.all(ACTIVE_WINDOWS.map(async (w) => {
        const sinceTs = anchorTs - w.seconds;
        const result = await db.execute(sql`
          select owner_account as account,
                 count(*) as events,
                 sum(event_type = 'create') as creates,
                 sum(event_type = 'cancel') as cancels,
                 sum(event_type = 'expire') as expires,
                 sum(event_type in ('fill', 'partial_fill')) as taker_fills,
                 sum(event_type in ('fill_maker', 'partial_fill_maker')) as maker_fills,
                 sum(side = 'bid') as buy_events,
                 sum(side = 'ask') as sell_events,
                 count(distinct market_index) as market_count,
                 coalesce(sum(case
                   when event_type in ('fill', 'partial_fill', 'fill_maker', 'partial_fill_maker')
                   then cast(nullif(price, '') as double) * cast(nullif(size, '') as double)
                   else 0
                 end), 0) as fill_notional,
                 min(ts) as first_ts,
                 max(ts) as last_ts
          from order_events
          where ts >= ${sinceTs}
            and owner_account is not null
            and owner_account <> ''
          group by owner_account
        `);
        const raw = (((result as any)[0] ?? result) as any[]).map((r) => ({
          account: String(r.account),
          events: toNumber(r.events),
          creates: toNumber(r.creates),
          cancels: toNumber(r.cancels),
          expires: toNumber(r.expires),
          takerFills: toNumber(r.taker_fills),
          makerFills: toNumber(r.maker_fills),
          buyEvents: toNumber(r.buy_events),
          sellEvents: toNumber(r.sell_events),
          markets: toNumber(r.market_count),
          fillNotional: toNumber(r.fill_notional),
          firstTs: toNumber(r.first_ts),
          lastTs: toNumber(r.last_ts),
        })) as ActiveAccountRow[];
        raw.sort((a, b) => b.events - a.events || b.fillNotional - a.fillNotional);
        const accounts = raw.slice(0, 100);
        return {
          key: w.key,
          label: w.label,
          seconds: w.seconds,
          sinceTs,
          activeAccounts: raw.length,
          totalEvents: raw.reduce((sum, r) => sum + r.events, 0),
          fillNotional: raw.reduce((sum, r) => sum + r.fillNotional, 0),
          accounts,
        };
      }));

      activeWindowsCache = { expiresAt: nowMs + 30_000, generatedAt: nowMs, anchorTs, windows };
      return {
        generatedAt: nowMs,
        anchorTs,
        cacheTtlMs: 30_000,
        windows: windows.map((w) => ({ ...w, accounts: w.accounts.slice(0, input.limit) })),
      };
    }),

  // ---- 订单事件：单账户流水 ----
  accountOrders: publicQuery
    .input(z.object({ account: z.string(), limit: z.number().min(1).max(300).default(100) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.select().from(orderEvents)
        .where(eq(orderEvents.ownerAccount, input.account))
        .orderBy(desc(orderEvents.ts)).limit(input.limit);
    }),

  // ---- 订单事件：最近流（全部账户） ----
  recentOrderEvents: publicQuery
    .input(z.object({ limit: z.number().min(1).max(300).default(120) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.select().from(orderEvents).orderBy(desc(orderEvents.id)).limit(input.limit);
    }),

  // ---- 创建/减仓配对：同账户同市场同数量的反向创建订单两两标记 ----
  orderPairs: publicQuery
    .input(z.object({
      hours: z.number().min(1).max(72).default(24),
      marketId: z.number().int().optional(),
      limit: z.number().min(1).max(200).default(60),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const [a] = await db.select({ maxTs: sql<number>`max(ts)` }).from(orderEvents);
      const anchorTs = a?.maxTs ?? Math.floor(Date.now() / 1000);
      const since = anchorTs - input.hours * 3600;

      // 1) 候选组：同账户 + 同市场 + 规范化数量，窗口内双向都有挂单
      const groupsRaw = await db.execute(sql`
        select owner_account as account, market_index as market,
               cast(size as decimal(38,18)) as sz, count(*) as n
        from order_events
        where event_type = 'create' and side is not null and ts >= ${since}
        ${input.marketId != null ? sql`and market_index = ${input.marketId}` : sql``}
        group by account, market, sz
        having count(distinct side) > 1
        order by n desc
        limit 400
      `);
      const groups = ((groupsRaw as any)[0] ?? []) as Array<{ account: string; market: number; sz: string; n: number }>;

      if (!groups.length) {
        return { anchorTs, hours: input.hours, stats: { groups: 0, pairs: 0, accounts: 0, washLike: 0 }, pairs: [] };
      }

      // 2) 拉候选账户的窗口内全部 create 明细，内存里 FIFO 配对（避免 SQL 自连接笛卡尔爆炸）
      const accounts = [...new Set(groups.map((g) => g.account).filter((x): x is string => x != null))];
      const detailConds = [
        sql`event_type = 'create'`,
        sql`side is not null`,
        gte(orderEvents.ts, since),
        inArray(orderEvents.ownerAccount, accounts),
      ];
      if (input.marketId != null) detailConds.push(eq(orderEvents.marketIndex, input.marketId));
      const rows = await db.select({
        ts: orderEvents.ts,
        txHash: orderEvents.txHash,
        side: orderEvents.side,
        price: orderEvents.price,
        size: orderEvents.size,
        account: orderEvents.ownerAccount,
        market: orderEvents.marketIndex,
      }).from(orderEvents)
        .where(and(...detailConds))
        .orderBy(orderEvents.ts)
        .limit(30000);

      // 组白名单：account|market|规范化数量
      const norm = (v: string | null) => {
        const n = Number(v ?? "0");
        return Number.isFinite(n) ? n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "") : "0";
      };
      const allow = new Set(groups.map((g) => `${g.account}|${g.market}|${norm(g.sz)}`));

      type Leg = { ts: number; side: string; price: string; txHash: string };
      const pendingBid = new Map<string, Leg[]>();
      const pendingAsk = new Map<string, Leg[]>();
      const pairs: Array<{
        account: string; market: number; size: string;
        open: Leg; close: Leg; gapSec: number; direction: string; washLike: boolean;
      }> = [];

      for (const r of rows) {
        const key = `${r.account}|${r.market}|${norm(r.size)}`;
        if (!allow.has(key)) continue;
        const leg: Leg = { ts: r.ts, side: r.side ?? "", price: r.price ?? "", txHash: r.txHash };
        const oppKey = key;
        if (r.side === "bid") {
          const q = pendingAsk.get(oppKey) ?? [];
          if (q.length) {
            const open = q.shift()!;
            pairs.push(buildPair(r.account!, r.market!, r.size ?? "", open, leg));
          } else {
            const q2 = pendingBid.get(key) ?? [];
            q2.push(leg); pendingBid.set(key, q2);
          }
        } else if (r.side === "ask") {
          const q = pendingBid.get(oppKey) ?? [];
          if (q.length) {
            const open = q.shift()!;
            pairs.push(buildPair(r.account!, r.market!, r.size ?? "", open, leg));
          } else {
            const q2 = pendingAsk.get(key) ?? [];
            q2.push(leg); pendingAsk.set(key, q2);
          }
        }
      }

      function buildPair(account: string, market: number, size: string, open: Leg, close: Leg) {
        const gapSec = close.ts - open.ts;
        const po = parseFloat(open.price), pc = parseFloat(close.price);
        const priceDiffPct = po > 0 && Number.isFinite(pc) ? Math.abs(pc - po) / po * 100 : null;
        // 先买后卖 = 平多减仓；先卖后买 = 平空减仓
        const direction = open.side === "bid" ? "平多" : "平空";
        // 间隔 < 60s 且价差 < 0.1%：疑似对倒/自成交刷量
        const washLike = gapSec <= 60 && priceDiffPct != null && priceDiffPct < 0.1;
        return { account, market, size, open, close, gapSec, direction, washLike, priceDiffPct };
      }

      pairs.sort((x, y) => y.close.ts - x.close.ts);
      const stats = {
        groups: groups.length,
        pairs: pairs.length,
        accounts: new Set(pairs.map((p) => p.account)).size,
        washLike: pairs.filter((p) => p.washLike).length,
      };
      return { anchorTs, hours: input.hours, stats, pairs: pairs.slice(0, input.limit) };
    }),

  // ---- WebSocket 逐账户实时面板：最新仓位/资产 + 实时成交 ----
  accountLive: publicQuery
    .input(z.object({ account: z.string(), limit: z.number().min(1).max(200).default(80) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [snap] = await db.select().from(accountSnapshots)
        .where(eq(accountSnapshots.account, input.account))
        .orderBy(desc(accountSnapshots.ts)).limit(1);
      const trades = await db.select().from(accountTrades)
        .where(eq(accountTrades.account, input.account))
        .orderBy(desc(accountTrades.ts)).limit(input.limit);
      return {
        snapshot: snap ? {
          ...snap,
          assets: JSON.parse(snap.assetsJson ?? "{}"),
          positions: JSON.parse(snap.positionsJson ?? "{}"),
        } : null,
        trades,
        tracking: wsRuntime.accounts.includes(input.account),
      };
    }),

  // ---- 将任意账户加入 WS 实时跟踪列表 ----
  trackAccount: publicQuery
    .input(z.object({ account: z.string().regex(/^\d+$/, "账户索引必须是数字") }))
    .mutation(({ input }) => {
      const ok = subscribeAccount(input.account);
      return { ok, accounts: wsRuntime.accounts };
    }),

  // ---- TWAP 检测：同账户同市场同方向高频小单聚类 ----
  twapDetect: publicQuery
    .input(z.object({ windowSec: z.number().default(3600) }))
    .query(async ({ input }) => {
      const db = getDb();
      const since = Math.floor(Date.now() / 1000) - input.windowSec;
      const rows = await db.execute(sql`
        select owner_account as account, market_index as market, side,
               count(*) as orders,
               sum(cast(size as decimal(40,10))) as total_size,
               min(ts) as start_ts, max(ts) as end_ts,
               count(distinct price) as price_levels
        from order_events
        where event_type in ('create','fill') and ts >= ${since}
          and owner_account is not null and owner_account <> ''
        group by owner_account, market_index, side
        having orders >= 8
        order by orders desc limit 40
      `);
      return ((rows as any)[0] ?? rows) as any[];
    }),

  // LIT 链上统计：按天聚合 + 鲸鱼榜
  litStats: publicQuery.query(async () => {
    const db = getDb();
    const daily = await db.execute(sql`
      select FROM_UNIXTIME(ts, '%Y-%m-%d') as day,
             count(*) as count,
             sum(cast(value_lit as decimal(30,4))) as volume,
             count(distinct from_addr) + count(distinct to_addr) as active
      from lit_transfers group by day order by day
    `);
    const whales = await db.select().from(litTransfers)
      .orderBy(desc(sql`cast(value_lit as decimal(40,6))`)).limit(30);
    const topSenders = await db.execute(sql`
      select from_addr as addr, sum(cast(value_lit as decimal(40,6))) as v
      from lit_transfers group by from_addr order by v desc limit 15
    `);
    const topReceivers = await db.execute(sql`
      select to_addr as addr, sum(cast(value_lit as decimal(40,6))) as v
      from lit_transfers group by to_addr order by v desc limit 15
    `);
    return {
      daily: (daily as any)[0] ?? daily,
      whales,
      topSenders: (topSenders as any)[0] ?? topSenders,
      topReceivers: (topReceivers as any)[0] ?? topReceivers,
    };
  }),
});
