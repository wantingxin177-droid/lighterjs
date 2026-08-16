import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";

const MARKETS = [{ id: 1, name: "BTC" }, { id: 0, name: "ETH" }, { id: 2, name: "SOL" }];

type DiffRow = {
  id: number;
  ts: number;
  side: string;
  price: string;
  prevSize: string | null;
  newSize: string | null;
  change: string;
  wsOffset: number | null;
};

function fmt(n: number, digits = 5) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

export function OrderBookLive() {
  const [mid, setMid] = useState(1);
  const [bandView, setBandView] = useState<0 | 1>(0);
  const book = trpc.node.bookLatest.useQuery({ marketId: mid }, { refetchInterval: 1000 });
  const bands = trpc.node.bookBands.useQuery({ marketId: mid }, { refetchInterval: 1000 });
  const status = trpc.node.status.useQuery(undefined, { refetchInterval: 5000 });
  const [sinceId, setSinceId] = useState(0);
  const [diffRows, setDiffRows] = useState<DiffRow[]>([]);
  const diffs = trpc.node.bookDiffsSince.useQuery(
    { marketId: mid, sinceId, limit: 80 },
    { refetchInterval: 1500 }
  );

  useEffect(() => {
    setSinceId(0);
    setDiffRows([]);
  }, [mid]);

  useEffect(() => {
    const incoming = diffs.data ?? [];
    if (incoming.length === 0) return;
    setDiffRows((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      return [...incoming.filter((x) => !seen.has(x.id)), ...prev]
        .sort((a, b) => b.id - a.id)
        .slice(0, 80);
    });
    const latestId = incoming[0]?.id;
    if (latestId && latestId > sinceId) setSinceId(latestId);
  }, [diffs.data, sinceId]);

  const d = book.data;
  const rows = useMemo(() => {
    if (!d) return { bids: [], asks: [], maxSize: 1 };
    const bids = d.bids.slice(0, 20).map(([p, s, o]) => ({ p, s, o }));
    const asks = d.asks.slice(0, 20).map(([p, s, o]) => ({ p, s, o }));
    const maxSize = Math.max(1e-9, ...bids.map(b => b.s), ...asks.map(a => a.s));
    return { bids, asks, maxSize };
  }, [d]);

  const spread = d ? (parseFloat(d.bestAsk ?? "0") - parseFloat(d.bestBid ?? "0")) : 0;
  const range = bands.data?.ranges[bandView];
  const totalBid = range?.bids.reduce((a, x) => a + x.quote, 0) ?? 0;
  const totalAsk = range?.asks.reduce((a, x) => a + x.quote, 0) ?? 0;
  const pressure = totalBid + totalAsk > 0 ? totalBid / (totalBid + totalAsk) : 0.5;
  const maxBandQuote = Math.max(1, ...(range?.bids.map(x => x.quote) ?? []), ...(range?.asks.map(x => x.quote) ?? []));

  const LevelRow = ({ p, s, o, side, max }: { p: string; s: number; o?: string; side: "bid" | "ask"; max: number }) => {
    const pct = Math.min(100, (s / max) * 100);
    return (
      <div className="relative flex justify-between text-[11px] font-mono py-[3px] px-2">
        <div className={`absolute inset-y-0 ${side === "bid" ? "right-0 bg-emerald-500/15" : "left-0 bg-rose-500/15"}`} style={{ width: `${pct}%` }} />
        <span className={`relative z-10 ${side === "bid" ? "text-emerald-400" : "text-rose-400"}`}>{parseFloat(p).toLocaleString()}</span>
        <span className="relative z-10 text-zinc-300">{fmt(s)}</span>
        <span className="relative z-10 text-zinc-600 text-[10px]">{o ? `#${o.slice(-6)}` : ""}</span>
      </div>
    );
  };

  const BandRows = ({ side }: { side: "bid" | "ask" }) => {
    if (!range) return null;
    const list = range[side === "bid" ? "bids" : "asks"];
    return (
      <div className="divide-y divide-zinc-800/60">
        {list.map((r) => {
          const width = Math.max(1.5, (r.quote / maxBandQuote) * 100);
          const near = side === "bid" ? r.toPrice : r.fromPrice;
          const far = side === "bid" ? r.fromPrice : r.toPrice;
          return (
            <div key={r.index} className="relative grid grid-cols-[64px_1fr_76px_78px] gap-2 px-3 py-2 text-[11px] font-mono">
              <div className={`absolute inset-y-1 ${side === "bid" ? "right-2 bg-emerald-500/12" : "left-2 bg-rose-500/12"} rounded`} style={{ width: `${width}%` }} />
              <span className={`relative z-10 ${side === "bid" ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(r.index * range.widthPct)} → {fmtPct((r.index + 1) * range.widthPct)}</span>
              <span className="relative z-10 text-zinc-400 truncate">{fmt(near, 1)} – {fmt(far, 1)}</span>
              <span className="relative z-10 text-right text-zinc-100">{fmtUsd(r.quote)}</span>
              <span className="relative z-10 text-right text-zinc-500">{r.levels}档</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {MARKETS.map(m => (
          <Button key={m.id} size="sm" variant={mid === m.id ? "default" : "outline"} onClick={() => setMid(m.id)}
            className={mid === m.id ? "bg-emerald-600 hover:bg-emerald-500" : "border-zinc-700 text-zinc-400"}>{m.name}</Button>
        ))}
        <span className="ml-auto text-xs text-zinc-400">
          <span className={`inline-flex items-center gap-1 mr-2 px-1.5 py-0.5 rounded ${status.data?.ws.connected ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
            {status.data?.ws.connected ? "WS 实时" : "REST 回退"}
          </span>
          价差 <span className="font-mono text-zinc-100">{spread.toFixed(mid === 1 ? 1 : 3)}</span> · 快照 {d ? new Date(d.ts).toLocaleTimeString("zh-CN", { hour12: false }) : "…"} · {d?.source?.startsWith("websocket") ? "WS 内存直读" : "10s 轮询"}
        </span>
      </div>

      {/* 中间价深度带：普通交易所通常只给固定百分比累计深度，这里直接展示等宽切片结构 */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 overflow-hidden">
        <div className="flex items-center gap-3 flex-wrap border-b border-cyan-500/10 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-cyan-200">中间价深度切片</h3>
            <p className="text-[11px] text-zinc-500">以买一/卖一中间价为 0，把价格区间等宽切成 10 段，显示每段真实挂单额与原始档数</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant={bandView === 0 ? "default" : "outline"} onClick={() => setBandView(0)}
              className={bandView === 0 ? "bg-cyan-600 hover:bg-cyan-500" : "border-zinc-700 text-zinc-400"}>±6‰ · 每档 0.06%</Button>
            <Button size="sm" variant={bandView === 1 ? "default" : "outline"} onClick={() => setBandView(1)}
              className={bandView === 1 ? "bg-cyan-600 hover:bg-cyan-500" : "border-zinc-700 text-zinc-400"}>±2.2% · 每档 0.22%</Button>
          </div>
        </div>

        {bands.data && range ? (
          <>
            <div className="grid md:grid-cols-4 gap-3 px-4 py-3 border-b border-zinc-800/70 text-xs">
              <div><p className="text-zinc-500">中间价</p><p className="font-mono text-lg text-zinc-100">{fmt(bands.data.mid, 1)}</p></div>
              <div><p className="text-zinc-500">买侧深度</p><p className="font-mono text-lg text-emerald-300">{fmtUsd(totalBid)}</p></div>
              <div><p className="text-zinc-500">卖侧深度</p><p className="font-mono text-lg text-rose-300">{fmtUsd(totalAsk)}</p></div>
              <div><p className="text-zinc-500">买侧压力</p><p className="font-mono text-lg text-cyan-200">{(pressure * 100).toFixed(1)}%</p></div>
            </div>
            <div className="px-4 py-3 border-b border-zinc-800/70">
              <div className="h-2 rounded-full overflow-hidden bg-rose-500/30 flex">
                <div className="bg-emerald-500/80" style={{ width: `${pressure * 100}%` }} />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-zinc-500"><span>买方 {fmtUsd(totalBid)}</span><span>卖方 {fmtUsd(totalAsk)}</span></div>
            </div>
            <div className="grid lg:grid-cols-2">
              <div className="border-r border-zinc-800/70">
                <div className="grid grid-cols-[64px_1fr_76px_78px] gap-2 px-3 py-2 text-[10px] text-zinc-500 border-b border-zinc-800"><span>偏离</span><span>价格区间</span><span className="text-right">挂单额</span><span className="text-right">原始档</span></div>
                <BandRows side="bid" />
              </div>
              <div>
                <div className="grid grid-cols-[64px_1fr_76px_78px] gap-2 px-3 py-2 text-[10px] text-zinc-500 border-b border-zinc-800"><span>偏离</span><span>价格区间</span><span className="text-right">挂单额</span><span className="text-right">原始档</span></div>
                <BandRows side="ask" />
              </div>
            </div>
            <p className="px-4 py-2 text-[10px] text-zinc-600 border-t border-zinc-800">当前使用 WebSocket 内存全量盘口：买盘 {bands.data.bookLevels.bids.toLocaleString()} 档、卖盘 {bands.data.bookLevels.asks.toLocaleString()} 档 · WS 偏移 {bands.data.wsOffset.toLocaleString()} · {new Date(bands.data.ts).toLocaleTimeString("zh-CN", { hour12: false })}</p>
          </>
        ) : (
          <p className="p-4 text-xs text-zinc-500">等待 WebSocket 全量盘口…</p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="grid grid-cols-2">
            <div className="border-r border-zinc-800">
              <p className="text-center text-xs text-emerald-400 py-1.5 border-b border-zinc-800">买盘 (前20档)</p>
              <div className="max-h-[420px] overflow-y-auto">
                {rows.bids.map((b, i) => <LevelRow key={i} p={b.p} s={b.s} o={b.o} side="bid" max={rows.maxSize} />)}
              </div>
            </div>
            <div>
              <p className="text-center text-xs text-rose-400 py-1.5 border-b border-zinc-800">卖盘 (前20档)</p>
              <div className="max-h-[420px] overflow-y-auto">
                {rows.asks.map((a, i) => <LevelRow key={i} p={a.p} s={a.s} o={a.o} side="ask" max={rows.maxSize} />)}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 px-2 py-1.5 border-t border-zinc-800">盘口主体由 WebSocket 增量维护；每档右侧 # 后缀为 REST 补充的公开挂单账户尾号（账户归属约 10s 校准一次）</p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <p className="text-xs text-zinc-300 py-1.5 px-2 border-b border-zinc-800">逐档变化 diff（WebSocket 增量 · ID 游标增量拉取 · 最新80条）</p>
          <div className="max-h-[440px] overflow-y-auto">
            {diffRows.length === 0 && <p className="text-xs text-zinc-600 p-3">暂无变化…</p>}
            <table className="w-full text-[11px]">
              <thead className="bg-zinc-900 text-zinc-500 sticky top-0">
                <tr><th className="px-2 py-1 text-left">时间</th><th className="px-2 py-1 text-left">侧</th><th className="px-2 py-1 text-right">价格</th><th className="px-2 py-1 text-right">变化</th><th className="px-2 py-1 text-right">旧→新</th><th className="px-2 py-1 text-right">WS偏移</th></tr>
              </thead>
              <tbody>
                {diffRows.map(x => (
                  <tr key={x.id} className="border-t border-zinc-800/50">
                    <td className="px-2 py-1 text-zinc-500">{new Date(x.ts).toLocaleTimeString("zh-CN", { hour12: false })}</td>
                    <td className={`px-2 py-1 font-mono ${x.side === "bid" ? "text-emerald-400" : "text-rose-400"}`}>{x.side === "bid" ? "买" : "卖"}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-300">{parseFloat(x.price).toLocaleString()}</td>
                    <td className={`px-2 py-1 text-right font-mono ${x.change === "add" ? "text-emerald-400" : x.change === "remove" ? "text-zinc-500" : "text-amber-300"}`}>{x.change === "add" ? "新增" : x.change === "remove" ? "撤掉" : "改量"}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-400">{x.prevSize ?? "—"} → {x.newSize ?? "0"}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-600">{x.wsOffset ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
