// LighterAnalyzer 轻节点同步器
// 持续从 Lighter 浏览器 API / 主网 API / 以太坊 RPC 同步数据并持久化到数据库。
// 所有同步任务都记录游标（sync_state），重启后从上次位置继续，不重复、不丢失。
import { getDb } from "./queries/connection";
import { syncState, blocks, blockTxs, blockMarkets, batches, marketSnapshots, fundingRates, litTransfers, orderEvents, bookSnapshots, bookDiffs } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { startWsCollector, updateBookOwners, isWsBookLive } from "./wsCollector";
import { getSocksProxyUrl } from "./proxyRuntime";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const EXPLORER = "https://explorer.elliot.ai/api";
const MAINNET = "https://mainnet.zklighter.elliot.ai/api/v1";
const ETH_RPC = "https://eth.drpc.org";
const LIT_CONTRACT = "0x232CE3bd40fCd6f80f3d55A522d03f25Df784Ee2";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const syncStats = {
  startedAt: Date.now(),
  jobs: {} as Record<string, { lastRun: number; lastOk: boolean; detail: string; runs: number }>,
};

function mark(job: string, ok: boolean, detail: string) {
  syncStats.jobs[job] = { lastRun: Date.now(), lastOk: ok, detail, runs: (syncStats.jobs[job]?.runs ?? 0) + 1 };
}

async function getCursor(job: string): Promise<number> {
  const db = getDb();
  const rows = await db.select().from(syncState).where(eq(syncState.job, job)).limit(1);
  return rows.length ? rows[0].cursor : 0;
}

async function setCursor(job: string, cursor: number) {
  const db = getDb();
  const rows = await db.select().from(syncState).where(eq(syncState.job, job)).limit(1);
  if (rows.length) {
    await db.update(syncState).set({ cursor, updatedAt: new Date() }).where(eq(syncState.job, job));
  } else {
    await db.insert(syncState).values({ job, cursor, updatedAt: new Date() });
  }
}

let restProxyAgent: ProxyAgent | null = null;

// 中继服务器（43.163.242.66，即 VLESS 节点本机，可直达被地域限制的 Lighter 数据）
const RELAY_BASE = process.env.LIGHTER_RELAY_URL ?? "https://whois.goodme.xyz/lighter-relay";
const RELAY_TOKEN = process.env.LIGHTER_RELAY_TOKEN ?? "24efbdd057c3748805a72853509ed498af5ac6cf9d09c1d5";

async function fetchViaRelay(url: string): Promise<any | null> {
  // 只代理 mainnet API；其余（explorer、eth rpc）不走中继
  if (!url.startsWith(MAINNET)) return null;
  const path = url.slice("https://mainnet.zklighter.elliot.ai".length);
  const r = await fetch(`${RELAY_BASE}/api/v1/proxy?token=${RELAY_TOKEN}&path=${encodeURIComponent(path)}`, {
    headers: { "User-Agent": "LighterAnalyzer-LightNode/1.0" },
  });
  if (!r.ok) return null;
  return r.json();
}

async function fetchViaProxy(url: string): Promise<any | null> {
  // 优先走中继服务器；本地 Xray 作为回退
  const viaRelay = await fetchViaRelay(url).catch(() => null);
  if (viaRelay) return viaRelay;
  const proxy = await getSocksProxyUrl();
  if (!proxy) return null;
  restProxyAgent ??= new ProxyAgent(proxy);
  const r: any = await undiciFetch(url, {
    headers: { "User-Agent": "LighterAnalyzer-LightNode/1.0" },
    dispatcher: restProxyAgent,
  } as any);
  if (!r.ok) return null;
  return r.json();
}

async function fetchJson(url: string, tries = 4): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "LighterAnalyzer-LightNode/1.0" } });
      if (r.ok) {
        const j: any = await r.json();
        // CloudFront 地域限制会以业务码返回；自动改走中继。
        if (j?.code !== 20558 && !String(j?.message ?? "").includes("restricted jurisdiction")) return j;
      }
      const pj = await fetchViaProxy(url);
      if (pj && pj.code !== 20558 && !String(pj.message ?? "").includes("restricted jurisdiction")) return pj;
    } catch {}
    await sleep(1500 * (i + 1));
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- L2 区块同步 ----------------
// 两层设计：
// 1) headSync：批量拉取区块摘要（/blocks?limit=100），区块列表永远紧贴链头，无滞后
// 2) detailSync：独立游标并发回填详情（逐笔交易/市场快照），详情接口未命中时也可实时拉取
const BLOCK_CONCURRENCY = 24;

// 每 5 秒：同步链头摘要（nLogs = -1 表示详情待回填）
async function headSync() {
  const job = "head";
  try {
    const list = await fetchJson(`${EXPLORER}/blocks?limit=100&sort=desc`);
    if (!Array.isArray(list) || !list.length) return mark(job, false, "无法获取区块列表");
    const db = getDb();
    await db.insert(blocks).values(
      list.map((b: any) => ({
        height: b.block_height,
        time: b.updated_at ?? null,
        ts: b.updated_at ? Math.floor(Date.parse(b.updated_at) / 1000) : null,
        nTxs: b.block_size ?? 0,
        nLogs: -1, // 摘要模式，详情待回填
        typesJson: null,
      }))
    ).onDuplicateKeyUpdate({ set: { nTxs: sql`if(n_logs = -1, values(n_txs), n_txs)` } });
    const latest = Math.max(...list.map((b: any) => b.block_height));
    mark(job, true, `链头 #${latest}`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

async function fetchBlock(h: number): Promise<any | null> {
  const b = await fetchJson(`${EXPLORER}/blocks/${h}`, 3);
  return b?.block_number ? b : null;
}

async function persistBlock(db: any, b: any) {
  const logs = b.logs ?? [];
  const types: Record<string, number> = {};
  for (const l of logs) types[l.tx_type] = (types[l.tx_type] ?? 0) + 1;
  const firstTs = logs[0]?.time ? Date.parse(logs[0].time) / 1000 : null;

  await db.insert(blocks).values({
    height: b.block_number,
    time: logs[0]?.time ?? null,
    ts: firstTs ? Math.floor(firstTs) : null,
    nTxs: b.total_transactions ?? 0,
    nLogs: logs.length,
    typesJson: JSON.stringify(types),
  }).onDuplicateKeyUpdate({
    set: {
      time: sql`values(time)`,
      ts: sql`values(ts)`,
      nTxs: sql`values(n_txs)`,
      nLogs: sql`values(n_logs)`,
      typesJson: sql`values(types_json)`,
    },
  });

  if (logs.length) {
    await db.insert(blockTxs).values(
      logs.map((l: any) => {
        const tp = l.pubdata?.trade_pubdata ?? {};
        return {
          blockHeight: b.block_number,
          txType: l.tx_type,
          hash: l.hash,
          time: l.time ?? null,
          pubdataType: l.pubdata_type ?? null,
          market: tp.market_index ?? null,
          price: tp.price ?? null,
          size: tp.size ?? null,
          taker: tp.taker_account_index ?? null,
          maker: tp.maker_account_index ?? null,
          rawJson: JSON.stringify(l.pubdata ?? {}),
        };
      })
    ).onDuplicateKeyUpdate({ set: { blockHeight: b.block_number } });

    // ---- 订单生命周期事件重建 ----
    const evts: any[] = [];
    for (const l of logs) {
      const tp = l.pubdata?.trade_pubdata;
      const tms = l.time ? Math.floor(Date.parse(l.time) / 1000) : Math.floor(Date.now() / 1000);
      if (l.tx_type === "L2CreateOrder" && tp) {
        // 创建订单：maker 是挂单者（限价单进簿或立即成交）；taker 是发起方
        const side = tp.is_taker_ask === 1 ? "ask" : "bid";
        evts.push({
          blockHeight: b.block_number, ts: tms, txHash: l.hash,
          eventType: "create", ownerAccount: String(tp.taker_account_index ?? ""),
          marketIndex: tp.market_index ?? null, price: tp.price ?? null, size: tp.size ?? null,
          side, rawJson: JSON.stringify(tp),
        });
      } else if (l.tx_type === "InternalClaimOrder" && tp) {
        // 撮合成交：taker 吃单方向，maker 是被动成交的挂单账户
        const side = tp.is_taker_ask === 1 ? "ask" : "bid";
        evts.push({
          blockHeight: b.block_number, ts: tms, txHash: l.hash + ":t",
          eventType: "fill", ownerAccount: String(tp.taker_account_index ?? ""),
          marketIndex: tp.market_index ?? null, price: tp.price ?? null, size: tp.size ?? null,
          side, rawJson: JSON.stringify(tp),
        });
        evts.push({
          blockHeight: b.block_number, ts: tms, txHash: l.hash + ":m",
          eventType: "fill_maker", ownerAccount: String(tp.maker_account_index ?? ""),
          marketIndex: tp.market_index ?? null, price: tp.price ?? null, size: tp.size ?? null,
          side: side === "ask" ? "bid" : "ask", rawJson: JSON.stringify(tp),
        });
      } else if (l.tx_type === "L2CancelOrder" || l.tx_type === "L2CancelAllOrders") {
        evts.push({
          blockHeight: b.block_number, ts: tms, txHash: l.hash,
          eventType: "cancel", ownerAccount: null, marketIndex: null, price: null, size: null,
          side: null, rawJson: JSON.stringify(l.pubdata ?? {}),
        });
      }
    }
    if (evts.length) {
      await db.insert(orderEvents).values(evts)
        .onDuplicateKeyUpdate({ set: { blockHeight: sql`values(block_height)` } });
    }
  }
  if (b.markets?.length) {
    await db.insert(blockMarkets).values(
      b.markets.map((m: any) => ({
        blockHeight: b.block_number,
        marketIndex: m.market_index,
        price: m.market_price,
        indexPrice: m.index_price,
        openInterest: m.open_interest,
        fundingRate: m.last_funding_rate,
      }))
    );
  }
}

// 后台协程：并发回填详情，连续游标保证无空洞
async function detailSync() {
  const job = "blocks";
  try {
    const list = await fetchJson(`${EXPLORER}/blocks?limit=5&sort=desc`);
    if (!Array.isArray(list) || !list.length) return mark(job, false, "无法获取区块列表");
    const latest = Math.max(...list.map((b: any) => b.block_height));
    let cursor = await getCursor(job);
    if (cursor === 0) cursor = latest - 200; // 首次运行回填最近 200 块
    if (cursor >= latest) return mark(job, true, `详情已是最新 #${latest}`);

    const db = getDb();
    const done = new Map<number, any>();
    let h = cursor + 1;
    let inFlight = 0;
    let newCursor = cursor;
    let failed = false;

    while (h <= latest && !failed) {
      const batch: Promise<void>[] = [];
      while (inFlight < BLOCK_CONCURRENCY && h <= latest) {
        const height = h++;
        inFlight++;
        batch.push(
          fetchBlock(height).then((b) => {
            inFlight--;
            if (b) done.set(height, b);
            else failed = true; // 拉取失败则停下，游标不越过该块
          })
        );
      }
      await Promise.all(batch);
      while (done.has(newCursor + 1)) {
        const b = done.get(newCursor + 1)!;
        await persistBlock(db, b);
        done.delete(newCursor + 1);
        newCursor++;
      }
      if (newCursor - cursor >= 200) {
        await setCursor(job, newCursor);
        cursor = newCursor;
      }
    }
    if (newCursor > cursor) await setCursor(job, newCursor);
    const lag = latest - newCursor;
    mark(job, !failed, `详情同步至 #${newCursor}${lag > 0 ? `（回填中，落后 ${lag} 块）` : "（已追上链头）"}`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

// ---------------- L1 批次同步 ----------------
async function syncBatches() {
  const job = "batches";
  try {
    const list = await fetchJson(`${EXPLORER}/batches?limit=60`);
    if (!Array.isArray(list)) return mark(job, false, list?.message ?? "获取批次失败");
    const db = getDb();
    let n = 0;
    for (const b of list) {
      await db.insert(batches).values({
        batchNumber: b.batch_number,
        time: b.updated_at,
        size: b.batch_size ?? 0,
        status: b.batch_status ?? null,
        commitTx: b.batch_details?.commit_tx_hash ?? null,
        verifyTx: b.batch_details?.verify_tx_hash ?? null,
        executeTx: b.batch_details?.execute_tx_hash ?? null,
        updatedAt: new Date(),
      }).onDuplicateKeyUpdate({
        set: {
          status: b.batch_status ?? null,
          commitTx: b.batch_details?.commit_tx_hash ?? null,
          verifyTx: b.batch_details?.verify_tx_hash ?? null,
          executeTx: b.batch_details?.execute_tx_hash ?? null,
          updatedAt: new Date(),
        },
      });
      n++;
    }
    mark(job, true, `更新 ${n} 个批次`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

// ---------------- 市场行情快照 ----------------
const TRACKED = ["BTC", "ETH", "SOL", "HYPE", "XAU", "LIT", "ZEC", "ASTER"];

async function syncMarkets() {
  const job = "markets";
  try {
    const d = await fetchJson(`${MAINNET}/orderBookDetails`);
    if (!d?.order_book_details) return mark(job, false, "行情获取失败");
    const db = getDb();
    const active = d.order_book_details.filter((m: any) => m.status === "active");
    await db.insert(marketSnapshots).values(
      active.map((m: any) => ({
        symbol: m.symbol,
        marketId: m.market_id,
        price: String(m.last_trade_price),
        markPrice: m.mark_price,
        indexPrice: m.index_price,
        vol24: String(m.daily_quote_token_volume),
        trades24: m.daily_trades_count,
        chg24: String(m.daily_price_change),
        high24: String(m.daily_price_high),
        low24: String(m.daily_price_low),
        openInterest: String(m.open_interest),
        capturedAt: new Date(),
      }))
    );
    mark(job, true, `快照 ${active.length} 个市场`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

// ---------------- 资金费率 ----------------
async function syncFundings() {
  const job = "fundings";
  try {
    const d = await fetchJson(`${MAINNET}/orderBookDetails`);
    if (!d?.order_book_details) return mark(job, false, "市场列表获取失败");
    const idBySymbol: Record<string, number> = {};
    for (const m of d.order_book_details) idBySymbol[m.symbol] = m.market_id;
    const db = getDb();
    const now = Date.now();
    const start = now - 8 * 24 * 3600 * 1000;
    let n = 0;
    for (const sym of TRACKED) {
      const mid = idBySymbol[sym];
      if (mid == null) continue;
      const f = await fetchJson(`${MAINNET}/fundings?market_id=${mid}&resolution=1h&start_timestamp=${start}&end_timestamp=${now}&count_back=192`, 2);
      if (!f?.fundings?.length) { await sleep(1200); continue; }
      await db.insert(fundingRates).values(
        f.fundings.map((x: any) => ({
          symbol: sym, marketId: mid, ts: x.timestamp, rate: x.rate, direction: x.direction ?? null,
        }))
      ).onDuplicateKeyUpdate({ set: { rate: sql`values(rate)` } });
      n += f.fundings.length;
      await sleep(1200);
    }
    mark(job, true, `资金费率 ${n} 条`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

// ---------------- LIT 链上事件同步 ----------------
// drpc 免费层对 eth_getLogs 间歇性限流（"Request timeout on the free plan"），
// 多公共 RPC 轮询 + 失败时自动缩小区间重试。
const ETH_RPCS = [
  ETH_RPC,
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
];

async function ethRpcOnce(method: string, params: any[]): Promise<any> {
  for (const rpc of ETH_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12000),
      });
      const j: any = await r.json();
      if (j.result !== undefined) return j.result;
    } catch {}
  }
  return null;
}

async function ethRpc(method: string, params: any[]): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await ethRpcOnce(method, params);
    if (res !== null) return res;
    await sleep(1200 * (i + 1));
  }
  return null;
}

async function syncLit() {
  const job = "lit";
  try {
    const latestHex = await ethRpc("eth_blockNumber", []);
    if (!latestHex) return mark(job, false, "RPC 不可用");
    const latest = parseInt(latestHex, 16);
    let cursor = await getCursor(job);
    if (cursor === 0) cursor = latest - 3 * 7200; // 首次回填约 3 天
    if (cursor >= latest - 12) return mark(job, true, `已同步至区块 #${cursor}`);
    const to = Math.min(cursor + 9000, latest);

    // 区间自适应：失败则从 9000 逐步缩到 562，规避公共 RPC 的范围/超时限制
    let logs: any[] | null = null;
    let range = 9000;
    let effectiveTo = to;
    for (; range >= 562; range = Math.floor(range / 2)) {
      effectiveTo = Math.min(cursor + range, latest);
      logs = await ethRpc("eth_getLogs", [{
        address: LIT_CONTRACT,
        topics: [TRANSFER_TOPIC],
        fromBlock: "0x" + (cursor + 1).toString(16),
        toBlock: "0x" + effectiveTo.toString(16),
      }]);
      if (Array.isArray(logs)) break;
      await sleep(800);
    }
    if (!Array.isArray(logs)) return mark(job, false, "getLogs 失败（所有 RPC 与区间均超时）");

    // 估算时间戳（12s/块）
    const latestBlock = await ethRpc("eth_getBlockByNumber", [latestHex, false]);
    const latestTs = latestBlock ? parseInt(latestBlock.timestamp, 16) : Math.floor(Date.now() / 1000);

    const db = getDb();
    if (logs.length) {
      await db.insert(litTransfers).values(
        logs.map((l: any) => ({
          txHash: l.transactionHash,
          logIndex: parseInt(l.logIndex, 16),
          blockNumber: parseInt(l.blockNumber, 16),
          ts: latestTs - (latest - parseInt(l.blockNumber, 16)) * 12,
          fromAddr: "0x" + l.topics[1].slice(-40),
          toAddr: "0x" + l.topics[2].slice(-40),
          valueLit: (Number(BigInt(l.data)) / 1e18).toFixed(6),
        }))
      ).onDuplicateKeyUpdate({ set: { valueLit: sql`values(value_lit)` } });
    }
    await setCursor(job, effectiveTo);
    mark(job, true, `LIT 事件 ${logs.length} 条 → 区块 #${effectiveTo}`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

// ---------------- 盘口快照 + 逐档 diff ----------------
// 内存中保存上一帧盘口，每轮与当前快照对比生成逐档 diff 并落库。
const BOOK_MARKETS = [1, 0, 2]; // BTC, ETH, SOL
const BOOK_LEVELS = 60; // 保存每侧前 60 档
const prevBooks = new Map<number, { bids: Map<string, number>; asks: Map<string, number> }>();

type Level = [string, number, string?]; // price, size, owner?

async function syncBook() {
  const job = "book";
  try {
    const db = getDb();
    let diffCount = 0;
    for (const mid of BOOK_MARKETS) {
      const d = await fetchJson(`${MAINNET}/orderBookOrders?market_id=${mid}&limit=${BOOK_LEVELS}`, 2);
      if (!d) continue;
      const ts = Date.now();
      const bids: Level[] = (d.bids ?? []).map((o: any) => [o.price, parseFloat(o.remaining_base_amount), o.owner_account_index != null ? String(o.owner_account_index) : undefined]);
      const asks: Level[] = (d.asks ?? []).map((o: any) => [o.price, parseFloat(o.remaining_base_amount), o.owner_account_index != null ? String(o.owner_account_index) : undefined]);

      // REST 负责补齐每个价位背后的公开 owner 账户；WS 在线时不写轮询快照/ diff，避免与实时流互相覆盖。
      updateBookOwners(mid, bids, asks);
      if (isWsBookLive()) {
        await sleep(400);
        continue;
      }

      // WS 离线回退：存轮询快照
      await db.insert(bookSnapshots).values({
        marketId: mid, ts,
        bestBid: bids[0]?.[0] ?? null,
        bestAsk: asks[0]?.[0] ?? null,
        bidsJson: JSON.stringify(bids),
        asksJson: JSON.stringify(asks),
        source: "poll",
      });

      // 与上一帧对比生成 diff
      const curBids = new Map(bids.map(([p, s]) => [p, s]));
      const curAsks = new Map(asks.map(([p, s]) => [p, s]));
      const prev = prevBooks.get(mid);
      const diffs: any[] = [];
      if (prev) {
        for (const [p, s] of curBids) {
          if (!prev.bids.has(p)) diffs.push({ side: "bid", price: p, prevSize: null, newSize: String(s), change: "add" });
          else if (prev.bids.get(p) !== s) diffs.push({ side: "bid", price: p, prevSize: String(prev.bids.get(p)), newSize: String(s), change: "update" });
        }
        for (const [p] of prev.bids) if (!curBids.has(p)) diffs.push({ side: "bid", price: p, prevSize: String(prev.bids.get(p)), newSize: null, change: "remove" });
        for (const [p, s] of curAsks) {
          if (!prev.asks.has(p)) diffs.push({ side: "ask", price: p, prevSize: null, newSize: String(s), change: "add" });
          else if (prev.asks.get(p) !== s) diffs.push({ side: "ask", price: p, prevSize: String(prev.asks.get(p)), newSize: String(s), change: "update" });
        }
        for (const [p] of prev.asks) if (!curAsks.has(p)) diffs.push({ side: "ask", price: p, prevSize: String(prev.asks.get(p)), newSize: null, change: "remove" });
      }
      prevBooks.set(mid, { bids: curBids, asks: curAsks });

      if (diffs.length) {
        await db.insert(bookDiffs).values(diffs.map((x) => ({ marketId: mid, ts, ...x, source: "poll" })));
        diffCount += diffs.length;
      }
      await sleep(400);
    }
    mark(job, true, isWsBookLive() ? `WS 实时盘口在线 · REST 补 owner×${BOOK_MARKETS.length}` : `盘口快照×${BOOK_MARKETS.length} · diff ${diffCount} 条`);
  } catch (e: any) {
    mark(job, false, String(e?.message ?? e).slice(0, 200));
  }
}

// ---------------- 调度器 ----------------
let started = false;

export function startSyncer() {
  if (started) return;
  started = true;
  console.log("[syncer] LighterAnalyzer 轻节点同步器启动");
  startWsCollector(mark); // WS 实时盘口 + 逐账户流（自动使用本地 SOCKS 代理）

  const loop = async (fn: () => Promise<void>, intervalMs: number, name: string) => {
    for (;;) {
      try { await fn(); } catch (e) { console.error(`[syncer:${name}]`, e); }
      await sleep(intervalMs);
    }
  };

  loop(headSync, 5_000, "head");          // 每 5 秒同步链头摘要（无滞后）
  loop(detailSync, 8_000, "blocks");      // 并发回填区块详情
  loop(syncBook, 10_000, "book");         // 每 10 秒补 owner；WS 离线时回退为快照+diff
  loop(syncBatches, 60_000, "batches");    // 每分钟更新批次
  loop(syncMarkets, 60_000, "markets");    // 每分钟行情快照
  loop(syncFundings, 10 * 60_000, "fundings"); // 每 10 分钟资金费率
  loop(syncLit, 45_000, "lit");            // 每 45 秒推进 L1 事件游标
}
