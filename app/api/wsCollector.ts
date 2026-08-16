// Lighter WebSocket 实时采集器（经本地 SOCKS5 代理绕过地域限制）。
// 订阅 order_book/{market} 获取逐档实时增量；订阅 account_all/{account} 获取逐账户仓位与成交。
import WebSocket from "ws";
import { SocksProxyAgent } from "socks-proxy-agent";
import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { bookDiffs, bookSnapshots, accountSnapshots, accountTrades } from "@db/schema";
import { getSocksProxyUrl } from "./proxyRuntime";

const WS_URL = "wss://mainnet.zklighter.elliot.ai/stream";
const BOOK_MARKETS = [1, 0, 2]; // BTC, ETH, SOL
const BOOK_LEVELS = 60;
const AUTO_ACCOUNT_LIMIT = 3;
const ACCOUNT_SNAPSHOT_INTERVAL = 15_000;
const RECONNECT_DELAY = 6_000;

type MarkFn = (job: string, ok: boolean, detail: string) => void;
type WsLevel = { price: string; size: number; owner?: string };
type BookState = { bids: Map<string, WsLevel>; asks: Map<string, WsLevel>; offset: number; updates: number; diffs: number; lastSnapshot: number };

export const wsRuntime = {
  connected: false,
  proxyUrl: null as string | null,
  lastConnect: 0,
  lastMessage: 0,
  lastError: null as string | null,
  reconnects: 0,
  accounts: [] as string[],
  markets: {} as Record<number, { offset: number; updates: number; diffs: number; lastSnapshot: number }>,
};

const books = new Map<number, BookState>();
const ownerMaps = new Map<number, Map<string, string>>(); // `${side}:${price}` -> owner account
const manualAccounts = new Set<string>();
let autoAccounts: string[] = [];
let ws: WebSocket | null = null;
let started = false;
let markFn: MarkFn | null = null;
let lastBookMark = 0;
let lastAccountMark = 0;
let accountRefreshAt = 0;

const pendingDiffs: any[] = [];
const pendingSnapshots = new Map<number, any>();
const pendingAccountSnaps = new Map<string, any>();
const accountSnapAt = new Map<string, number>();
const pendingAccountTrades: any[] = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function activeAccounts(): string[] {
  return [...new Set([...manualAccounts, ...autoAccounts])].slice(0, 12);
}

function updateMarketRuntime(mid: number) {
  const b = books.get(mid);
  if (b) wsRuntime.markets[mid] = { offset: b.offset, updates: b.updates, diffs: b.diffs, lastSnapshot: b.lastSnapshot };
}

function ensureBook(mid: number): BookState {
  let b = books.get(mid);
  if (!b) {
    b = { bids: new Map(), asks: new Map(), offset: 0, updates: 0, diffs: 0, lastSnapshot: 0 };
    books.set(mid, b);
  }
  return b;
}

function levelFromWire(x: any): WsLevel {
  return { price: String(x.price), size: parseFloat(x.size ?? "0") };
}

function ownerKey(side: "bid" | "ask", price: string) {
  return `${side}:${price}`;
}

function applyOwners(mid: number, b: BookState) {
  const owners = ownerMaps.get(mid);
  if (!owners) return;
  for (const side of ["bid", "ask"] as const) {
    const map = side === "bid" ? b.bids : b.asks;
    for (const [price, level] of map) {
      const owner = owners.get(ownerKey(side, price));
      if (owner) level.owner = owner;
    }
  }
}

function queueBookSnapshot(mid: number, force = false) {
  const b = ensureBook(mid);
  const now = Date.now();
  if (!force && now - b.lastSnapshot < 1800) return;
  b.lastSnapshot = now;
  applyOwners(mid, b);
  const bids = [...b.bids.values()]
    .filter((x) => x.size > 0)
    .sort((a, z) => parseFloat(z.price) - parseFloat(a.price))
    .slice(0, BOOK_LEVELS)
    .map((x) => [x.price, x.size, x.owner]);
  const asks = [...b.asks.values()]
    .filter((x) => x.size > 0)
    .sort((a, z) => parseFloat(a.price) - parseFloat(z.price))
    .slice(0, BOOK_LEVELS)
    .map((x) => [x.price, x.size, x.owner]);
  pendingSnapshots.set(mid, {
    marketId: mid,
    ts: now,
    bestBid: bids[0]?.[0] ?? null,
    bestAsk: asks[0]?.[0] ?? null,
    bidsJson: JSON.stringify(bids),
    asksJson: JSON.stringify(asks),
    wsOffset: b.offset,
    source: "websocket",
  });
  updateMarketRuntime(mid);
}

function applyBookLevels(mid: number, side: "bid" | "ask", levels: any[], ts: number, offset: number | null) {
  const b = ensureBook(mid);
  const map = side === "bid" ? b.bids : b.asks;
  for (const raw of levels ?? []) {
    const next = levelFromWire(raw);
    const prev = map.get(next.price);
    const owner = prev?.owner ?? ownerMaps.get(mid)?.get(ownerKey(side, next.price));
    let change: "add" | "update" | "remove";
    if (!prev && next.size > 0) change = "add";
    else if (prev && next.size <= 0) change = "remove";
    else if (prev && Math.abs(prev.size - next.size) > 1e-12) change = "update";
    else continue;

    pendingDiffs.push({
      marketId: mid,
      ts,
      side,
      price: next.price,
      prevSize: prev ? String(prev.size) : null,
      newSize: next.size > 0 ? String(next.size) : null,
      change,
      wsOffset: offset,
      source: "websocket",
    });
    b.diffs++;

    if (next.size <= 0) map.delete(next.price);
    else map.set(next.price, { ...next, owner });
  }
  if (pendingDiffs.length > 100_000) pendingDiffs.splice(0, 20_000);
}

function handleOrderBookMessage(m: any) {
  const mid = Number(String(m.channel ?? "").split(":")[1]);
  if (!Number.isFinite(mid)) return;
  const b = ensureBook(mid);
  const ts = Number(m.timestamp ?? Date.now());
  const book = m.order_book ?? {};
  const offset = Number(book.offset ?? m.offset ?? 0) || null;

  if (m.type === "subscribed/order_book") {
    b.bids.clear();
    b.asks.clear();
    for (const x of book.bids ?? []) {
      const l = levelFromWire(x);
      if (l.size > 0) b.bids.set(l.price, l);
    }
    for (const x of book.asks ?? []) {
      const l = levelFromWire(x);
      if (l.size > 0) b.asks.set(l.price, l);
    }
    if (offset) b.offset = offset;
    queueBookSnapshot(mid, true);
    return;
  }

  if (m.type === "update/order_book") {
    b.updates++;
    if (offset) b.offset = offset;
    applyBookLevels(mid, "bid", book.bids ?? [], ts, offset);
    applyBookLevels(mid, "ask", book.asks ?? [], ts, offset);
    queueBookSnapshot(mid);
    updateMarketRuntime(mid);
  }
}

function tradeRowsFromMessage(account: string, tradesObj: any): any[] {
  const rows: any[] = [];
  for (const list of Object.values(tradesObj ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const t of list as any[]) {
      const tradeId = String(t.trade_id_str ?? t.trade_id ?? "");
      if (!tradeId) continue;
      const askAccount = String(t.ask_account_id ?? "");
      const bidAccount = String(t.bid_account_id ?? "");
      const side = account === askAccount ? "ask" : account === bidAccount ? "bid" : null;
      const isMaker = side === "ask" ? t.is_maker_ask === true : side === "bid" ? t.is_maker_ask === false : null;
      rows.push({
        account,
        tradeId,
        marketId: t.market_id ?? null,
        txHash: t.tx_hash ?? null,
        blockHeight: t.block_height ?? null,
        ts: Number(t.timestamp ?? Date.now()),
        side,
        role: isMaker == null ? null : isMaker ? "maker" : "taker",
        size: t.size != null ? String(t.size) : null,
        price: t.price != null ? String(t.price) : null,
        usdAmount: t.usd_amount != null ? String(t.usd_amount) : null,
        counterpartyAccount: side === "ask" ? bidAccount : side === "bid" ? askAccount : null,
        rawJson: JSON.stringify(t),
      });
    }
  }
  return rows;
}

function handleAccountMessage(m: any) {
  const account = String(m.account ?? "");
  if (!account) return;
  const now = Date.now();

  if (m.type === "subscribed/account_all" || now - (accountSnapAt.get(account) ?? 0) >= ACCOUNT_SNAPSHOT_INTERVAL) {
    accountSnapAt.set(account, now);
    pendingAccountSnaps.set(account, {
      account,
      ts: now,
      dailyTrades: m.daily_trades_count ?? null,
      dailyVolume: m.daily_volume != null ? String(m.daily_volume) : null,
      weeklyTrades: m.weekly_trades_count ?? null,
      weeklyVolume: m.weekly_volume != null ? String(m.weekly_volume) : null,
      monthlyTrades: m.monthly_trades_count ?? null,
      monthlyVolume: m.monthly_volume != null ? String(m.monthly_volume) : null,
      totalTrades: m.total_trades_count ?? null,
      totalVolume: m.total_volume != null ? String(m.total_volume) : null,
      assetsJson: JSON.stringify(m.assets ?? {}),
      positionsJson: JSON.stringify(m.positions ?? {}),
    });
  }

  const rows = tradeRowsFromMessage(account, m.trades);
  if (rows.length) pendingAccountTrades.push(...rows);
  if (pendingAccountTrades.length > 50_000) pendingAccountTrades.splice(0, 10_000);
}

async function flushQueues() {
  const db = getDb();
  const diffs = pendingDiffs.splice(0, 3000);
  if (diffs.length) await db.insert(bookDiffs).values(diffs);

  const snaps = [...pendingSnapshots.entries()];
  pendingSnapshots.clear();
  for (const [, row] of snaps) await db.insert(bookSnapshots).values(row);

  const accountRows = [...pendingAccountSnaps.values()];
  pendingAccountSnaps.clear();
  if (accountRows.length) await db.insert(accountSnapshots).values(accountRows);

  const trades = pendingAccountTrades.splice(0, 2000);
  if (trades.length) {
    await db.insert(accountTrades).values(trades)
      .onDuplicateKeyUpdate({ set: { ts: sql`values(ts)` } });
  }

  const now = Date.now();
  if ((diffs.length || snaps.length) && markFn && now - lastBookMark > 10_000) {
    lastBookMark = now;
    const totalDiffs = Object.values(wsRuntime.markets).reduce((a, x) => a + x.diffs, 0);
    markFn("ws-book", true, `WS 盘口已连接 · 增量 ${totalDiffs.toLocaleString()} 条`);
  }
  if ((accountRows.length || trades.length) && markFn && now - lastAccountMark > 10_000) {
    lastAccountMark = now;
    markFn("ws-account", true, `WS 账户 ${wsRuntime.accounts.length} 个 · 成交队列已落库`);
  }
}

async function refreshAutoAccounts() {
  try {
    const db = getDb();
    const rows = await db.execute(sql`
      select owner_account as account, count(*) as events
      from order_events
      where ts >= unix_timestamp() - 21600
        and owner_account is not null and owner_account <> ''
      group by owner_account
      order by events desc
      limit ${AUTO_ACCOUNT_LIMIT}
    `);
    const list = (((rows as any)[0] ?? rows) as any[]).map((x) => String(x.account)).filter(Boolean);
    const changed = list.join(",") !== autoAccounts.join(",");
    autoAccounts = list;
    wsRuntime.accounts = activeAccounts();
    if (changed && ws?.readyState === WebSocket.OPEN) {
      for (const account of activeAccounts()) {
        ws.send(JSON.stringify({ type: "subscribe", channel: `account_all/${account}` }));
      }
    }
  } catch {}
}

function subscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const mid of BOOK_MARKETS) {
    ws.send(JSON.stringify({ type: "subscribe", channel: `order_book/${mid}` }));
  }
  for (const account of activeAccounts()) {
    ws.send(JSON.stringify({ type: "subscribe", channel: `account_all/${account}` }));
  }
}

// 中继服务器（可直达 Lighter），其 WS 入口转发官方实时流
const RELAY_WS_URL = process.env.LIGHTER_RELAY_WS_URL
  ?? "wss://whois.goodme.xyz/lighter-relay/stream?token=24efbdd057c3748805a72853509ed498af5ac6cf9d09c1d5";
const USE_RELAY_WS = (process.env.LIGHTER_RELAY_WS ?? "1") !== "0";

async function connectLoop() {
  for (;;) {
    try {
      const proxy = await getSocksProxyUrl();
      wsRuntime.proxyUrl = USE_RELAY_WS ? "relay(43.163.242.66)" : proxy;
      if (!USE_RELAY_WS && !proxy) {
        wsRuntime.lastError = "SOCKS 代理不可用，等待本地代理启动";
        markFn?.("ws-book", false, wsRuntime.lastError);
        await sleep(RECONNECT_DELAY * 5);
        continue;
      }

      const agent = USE_RELAY_WS ? undefined : new SocksProxyAgent(proxy!);
      ws = new WebSocket(USE_RELAY_WS ? RELAY_WS_URL : WS_URL, {
        agent,
        handshakeTimeout: 15_000,
        headers: { "User-Agent": "LighterAnalyzer-LightNode/1.0" },
      });

      await new Promise<void>((resolve) => {
        ws!.once("open", () => {
          wsRuntime.connected = true;
          wsRuntime.lastConnect = Date.now();
          wsRuntime.lastError = null;
          wsRuntime.accounts = activeAccounts();
          markFn?.("ws-book", true, `WS 已连接 ${BOOK_MARKETS.length} 个盘口`);
          subscribeAll();
          resolve();
        });
        ws!.once("error", () => resolve());
      });

      if (!wsRuntime.connected) throw new Error("WebSocket 握手失败");

      await new Promise<void>((resolve) => {
        ws!.on("message", (raw) => {
          wsRuntime.lastMessage = Date.now();
          try {
            const m = JSON.parse(String(raw));
            // 中继封装格式：{ channel, type, data: <上游原始消息> } —— 解包后走原逻辑
            const inner = (USE_RELAY_WS && m && m.data && typeof m.data === "object") ? m.data : m;
            if (m.type === "ping") {
              ws?.send(JSON.stringify({ type: "pong" }));
            } else if (inner.type === "subscribed/order_book" || inner.type === "update/order_book") {
              handleOrderBookMessage(inner);
            } else if (inner.type === "subscribed/account_all" || inner.type === "update/account_all") {
              handleAccountMessage(inner);
            }
          } catch {}
        });
        ws!.on("close", () => resolve());
        ws!.on("error", (e) => {
          wsRuntime.lastError = String(e.message ?? e).slice(0, 200);
          resolve();
        });
      });
    } catch (e: any) {
      wsRuntime.lastError = String(e?.message ?? e).slice(0, 200);
    } finally {
      wsRuntime.connected = false;
      wsRuntime.reconnects++;
      try { ws?.close(); } catch {}
      ws = null;
      markFn?.("ws-book", false, `WS 断开，${RECONNECT_DELAY / 1000}s 后重连${wsRuntime.lastError ? `：${wsRuntime.lastError}` : ""}`);
      await sleep(RECONNECT_DELAY);
    }
  }
}

async function accountRefreshLoop() {
  await refreshAutoAccounts();
  accountRefreshAt = Date.now();
  for (;;) {
    await sleep(60_000);
    if (Date.now() - accountRefreshAt >= 10 * 60_000) {
      await refreshAutoAccounts();
      accountRefreshAt = Date.now();
    }
  }
}

export function subscribeAccount(account: string) {
  const clean = account.trim();
  if (!/^\d+$/.test(clean)) return false;
  manualAccounts.add(clean);
  wsRuntime.accounts = activeAccounts();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "subscribe", channel: `account_all/${clean}` }));
  }
  return true;
}

export function updateBookOwners(marketId: number, bids: [string, number, string?][], asks: [string, number, string?][]) {
  let owners = ownerMaps.get(marketId);
  if (!owners) {
    owners = new Map();
    ownerMaps.set(marketId, owners);
  }
  for (const [price, , owner] of bids) if (owner) owners.set(ownerKey("bid", price), owner);
  for (const [price, , owner] of asks) if (owner) owners.set(ownerKey("ask", price), owner);
  const b = books.get(marketId);
  if (b) applyOwners(marketId, b);
}

export function isWsBookLive() {
  return wsRuntime.connected && Date.now() - wsRuntime.lastMessage < 15_000;
}

export function getLiveBook(marketId: number) {
  const b = books.get(marketId);
  if (!b || !isWsBookLive()) return null;
  return {
    offset: b.offset,
    bids: [...b.bids.values()].filter((x) => x.size > 0),
    asks: [...b.asks.values()].filter((x) => x.size > 0),
  };
}

export function startWsCollector(mark?: MarkFn) {
  if (started) return;
  started = true;
  markFn = mark ?? null;
  void connectLoop();
  void accountRefreshLoop();
  setInterval(() => {
    void flushQueues().catch((e) => markFn?.("ws-book", false, String(e?.message ?? e).slice(0, 200)));
  }, 1000);
}
