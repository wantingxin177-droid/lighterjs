import { useMemo, useState } from "react";
import type { TapeTrade } from "@/types/data";
import { fmtUsd, timeStr } from "@/types/data";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const WHALE_THRESHOLD = 10000;

export function TradesPanel({ trades }: { trades: Record<string, TapeTrade[]> }) {
  const symbols = Object.keys(trades);
  const [sym, setSym] = useState(symbols[0]);
  const tape = trades[sym] ?? [];

  const { cvd, buyUsd, sellUsd, whales } = useMemo(() => {
    let cum = 0;
    const cvd = [...tape]
      .sort((a, b) => a.t - b.t)
      .map(t => {
        cum += t.buy ? t.usd : -t.usd;
        return { t: t.t, cvd: +cum.toFixed(0) };
      });
    const buyUsd = tape.filter(t => t.buy).reduce((s, t) => s + t.usd, 0);
    const sellUsd = tape.filter(t => !t.buy).reduce((s, t) => s + t.usd, 0);
    const whales = tape.filter(t => t.usd >= WHALE_THRESHOLD).sort((a, b) => b.usd - a.usd);
    return { cvd, buyUsd, sellUsd, whales };
  }, [tape]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {symbols.map(s => (
          <Button key={s} size="sm" variant={sym === s ? "default" : "outline"} onClick={() => setSym(s)}
            className={sym === s ? "bg-emerald-600 hover:bg-emerald-500" : "border-zinc-700 text-zinc-400"}>{s}</Button>
        ))}
        <span className="ml-auto text-xs text-zinc-400">
          最近 {tape.length} 笔 · 主动买入 <span className="text-emerald-400 font-mono">{fmtUsd(buyUsd)}</span> /
          主动卖出 <span className="text-rose-400 font-mono">{fmtUsd(sellUsd)}</span>
        </span>
      </div>
      <div className="h-[280px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
        <ResponsiveContainer>
          <BarChart data={cvd}>
            <XAxis dataKey="t" tickFormatter={(t: number) => new Date(t * 1000).toLocaleTimeString("zh-CN", { hour12: false })} stroke="#52525b" fontSize={11} />
            <YAxis stroke="#52525b" fontSize={11} tickFormatter={(v: number) => fmtUsd(v)} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              labelFormatter={(t: number) => timeStr(t)}
              formatter={(v: number) => [fmtUsd(v), "CVD"]}
            />
            <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
            <Bar dataKey="cvd" fill="#60a5fa" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h4 className="text-sm text-zinc-300 mb-2">大额成交（≥ $10K，大户监控）</h4>
        {whales.length === 0 ? (
          <p className="text-xs text-zinc-500">该快照区间内无 ≥$10K 的成交。</p>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[240px]">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">时间</th>
                  <th className="px-3 py-2 text-right">价格</th>
                  <th className="px-3 py-2 text-right">数量</th>
                  <th className="px-3 py-2 text-right">金额</th>
                  <th className="px-3 py-2 text-right">方向</th>
                </tr>
              </thead>
              <tbody>
                {whales.map((t, i) => (
                  <tr key={i} className="border-t border-zinc-800/60">
                    <td className="px-3 py-1.5 text-zinc-400 text-xs">{timeStr(t.t)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-zinc-200">{t.px.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-zinc-300">{t.sz}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-amber-300">{fmtUsd(t.usd)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${t.buy ? "text-emerald-400" : "text-rose-400"}`}>{t.buy ? "买入" : "卖出"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
