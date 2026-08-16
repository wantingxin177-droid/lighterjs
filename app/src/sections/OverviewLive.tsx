import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtUsd, fmtNum } from "@/types/data";
import { TrendingUp, TrendingDown, Activity, Coins, BarChart3, Layers } from "lucide-react";

export function OverviewLive() {
  const q = trpc.node.markets.useQuery(undefined, { refetchInterval: 60000 });
  const litQ = trpc.node.litStats.useQuery(undefined, { refetchInterval: 120000 });

  const m = useMemo(() => {
    const markets = (q.data ?? []).map(x => ({
      symbol: x.symbol,
      vol24: parseFloat(x.vol24 ?? "0"),
      chg24: parseFloat(x.chg24 ?? "0"),
      trades24: x.trades24 ?? 0,
      oi: parseFloat(x.openInterest ?? "0") * parseFloat(x.price ?? "0"),
    }));
    const totalVol = markets.reduce((s, x) => s + x.vol24, 0);
    const totalOI = markets.reduce((s, x) => s + x.oi, 0);
    const totalTrades = markets.reduce((s, x) => s + x.trades24, 0);
    const gainers = markets.filter(x => x.vol24 > 100000).sort((a, b) => b.chg24 - a.chg24).slice(0, 5);
    const losers = markets.filter(x => x.vol24 > 100000).sort((a, b) => a.chg24 - b.chg24).slice(0, 5);
    return { totalVol, totalOI, totalTrades, gainers, losers, n: markets.length };
  }, [q.data]);

  const litDaily = (litQ.data?.daily as any[]) ?? [];
  const litCount = litDaily.reduce((s: number, d: any) => s + Number(d.count), 0);

  const kpis = [
    { label: "24h 总成交量", value: fmtUsd(m.totalVol), icon: BarChart3, sub: `${m.n} 个活跃市场` },
    { label: "总持仓量 (OI)", value: fmtUsd(m.totalOI), icon: Layers, sub: "全部市场合计" },
    { label: "24h 成交笔数", value: fmtNum(m.totalTrades), icon: Activity, sub: "全站交易" },
    { label: "LIT 链上转账（已索引）", value: `${fmtNum(litCount)} 笔`, icon: Coins, sub: "以太坊主网，持续累积" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="bg-zinc-900/60 border-zinc-800">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs text-zinc-400 font-normal">{k.label}</CardTitle>
              <k.icon className="w-4 h-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-50">{k.value}</div>
              <div className="text-xs text-zinc-500 mt-1">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2 text-zinc-200"><TrendingUp className="w-4 h-4 text-emerald-400" />24h 涨幅榜（量 &gt; $100K）</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {m.gainers.map(x => (
              <div key={x.symbol} className="flex justify-between items-center text-sm">
                <span className="font-medium text-zinc-200">{x.symbol}</span>
                <span className="text-zinc-500 text-xs">{fmtUsd(x.vol24)}</span>
                <span className="text-emerald-400 font-mono">+{x.chg24.toFixed(2)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2 text-zinc-200"><TrendingDown className="w-4 h-4 text-rose-400" />24h 跌幅榜（量 &gt; $100K）</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {m.losers.map(x => (
              <div key={x.symbol} className="flex justify-between items-center text-sm">
                <span className="font-medium text-zinc-200">{x.symbol}</span>
                <span className="text-zinc-500 text-xs">{fmtUsd(x.vol24)}</span>
                <span className="text-rose-400 font-mono">{x.chg24.toFixed(2)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
