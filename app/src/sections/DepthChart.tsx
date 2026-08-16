import { useMemo, useState } from "react";
import type { DepthSide } from "@/types/data";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";

export function DepthChart({ depth }: { depth: Record<string, DepthSide> }) {
  const symbols = Object.keys(depth);
  const [sym, setSym] = useState(symbols[0]);

  const { rows, mid, spread, bidDepth, askDepth } = useMemo(() => {
    const d = depth[sym];
    const bids = [...d.bids].sort((a, b) => b[0] - a[0]);
    const asks = [...d.asks].sort((a, b) => a[0] - b[0]);
    const bestBid = bids[0]?.[0] ?? 0;
    const bestAsk = asks[0]?.[0] ?? 0;
    const mid = (bestBid + bestAsk) / 2;
    const lo = mid * 0.995, hi = mid * 1.005;
    let cum = 0;
    const bidRows = bids.filter(b => b[0] >= lo).map(b => ({ px: b[0], bid: (cum += b[1] * b[0]) }));
    cum = 0;
    const askRows = asks.filter(a => a[0] <= hi).map(a => ({ px: a[0], ask: (cum += a[1] * a[0]) }));
    const rows = [...bidRows.reverse(), ...askRows];
    return {
      rows, mid,
      spread: bestAsk - bestBid,
      bidDepth: bidRows.length ? bidRows[bidRows.length - 1].bid : 0,
      askDepth: askRows.length ? askRows[askRows.length - 1].ask : 0,
    };
  }, [depth, sym]);

  const fmt = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}K`);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {symbols.map(s => (
          <Button key={s} size="sm" variant={sym === s ? "default" : "outline"}
            onClick={() => setSym(s)}
            className={sym === s ? "bg-emerald-600 hover:bg-emerald-500" : "border-zinc-700 text-zinc-400"}>{s}</Button>
        ))}
        <div className="ml-auto text-xs text-zinc-400 flex gap-4">
          <span>价差 <span className="text-zinc-100 font-mono">{spread.toFixed(sym === "ETH" ? 2 : 3)}</span></span>
          <span>±0.5% 买盘深度 <span className="text-emerald-400 font-mono">{fmt(bidDepth)}</span></span>
          <span>±0.5% 卖盘深度 <span className="text-rose-400 font-mono">{fmt(askDepth)}</span></span>
        </div>
      </div>
      <div className="h-[340px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
        <ResponsiveContainer>
          <AreaChart data={rows}>
            <XAxis dataKey="px" type="number" domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              stroke="#52525b" fontSize={11} />
            <YAxis stroke="#52525b" fontSize={11} tickFormatter={fmt} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              formatter={(v: number, name: string) => [fmt(v), name === "bid" ? "累计买盘" : "累计卖盘"]}
              labelFormatter={(px: number) => `价格 ${px.toLocaleString()}`}
            />
            <Area dataKey="bid" stroke="#34d399" fill="#34d39933" strokeWidth={1.5} />
            <Area dataKey="ask" stroke="#fb7185" fill="#fb718533" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-zinc-500">实时订单簿快照：中间价 ±0.5% 区间内的累计挂单深度（USD）。中间价 {mid.toLocaleString()}。</p>
    </div>
  );
}
