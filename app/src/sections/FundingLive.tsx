import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { Button } from "@/components/ui/button";

const COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#f97316"];

export function FundingLive() {
  const q = trpc.node.fundings.useQuery(undefined, { refetchInterval: 120000 });
  const fundings = useMemo(() => {
    const bySym: Record<string, { t: number; rate: number }[]> = {};
    for (const f of q.data ?? []) {
      (bySym[f.symbol] ??= []).push({ t: f.ts, rate: parseFloat(f.rate) });
    }
    for (const s of Object.keys(bySym)) bySym[s].sort((a, b) => a.t - b.t);
    return bySym;
  }, [q.data]);

  const symbols = Object.keys(fundings);
  const [selected, setSelected] = useState<string[]>([]);
  const sel = selected.length ? selected : symbols.slice(0, 4);

  const chartData = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    for (const s of sel) {
      for (const p of fundings[s] ?? []) {
        const row = map.get(p.t) ?? { t: p.t };
        row[s] = +(p.rate * 100).toFixed(4);
        map.set(p.t, row);
      }
    }
    return [...map.values()].sort((a, b) => (a.t as number) - (b.t as number));
  }, [fundings, sel]);

  const avg = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of symbols) {
      const pts = fundings[s];
      out[s] = pts.length ? (pts.reduce((x, p) => x + p.rate, 0) / pts.length) * 100 : 0;
    }
    return out;
  }, [fundings, symbols]);

  const toggle = (s: string) =>
    setSelected(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {symbols.map((s, i) => (
          <Button key={s} size="sm"
            variant={sel.includes(s) ? "default" : "outline"}
            onClick={() => toggle(s)}
            className={sel.includes(s) ? "text-white" : "border-zinc-700 text-zinc-400"}
            style={sel.includes(s) ? { backgroundColor: COLORS[i % COLORS.length], borderColor: "transparent" } : {}}>
            {s} <span className="ml-1 text-xs opacity-70">{(avg[s] * 8 * 365).toFixed(1)}% APR</span>
          </Button>
        ))}
      </div>
      <div className="h-[360px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <XAxis dataKey="t"
              tickFormatter={(t: number) => new Date(t * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
              stroke="#52525b" fontSize={11} />
            <YAxis stroke="#52525b" fontSize={11} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              labelFormatter={(t: number) => new Date(t * 1000).toLocaleString("zh-CN", { hour12: false })}
              formatter={(v: number, name: string) => [`${v}%`, name]} />
            <Legend />
            <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
            {sel.map(s => (
              <Line key={s} type="monotone" dataKey={s} dot={false} strokeWidth={1.5}
                stroke={COLORS[symbols.indexOf(s) % COLORS.length]} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-zinc-500">8 天逐小时资金费率（%），由本地节点持续落库。正值 = 多头付空头；按钮旁为按 8 小时结算折算的年化费率。</p>
    </div>
  );
}
