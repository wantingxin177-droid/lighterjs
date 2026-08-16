import type { LighterData } from "@/types/data";
import { fmtUsd, fmtNum } from "@/types/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Activity, Coins, BarChart3, Layers } from "lucide-react";

export function Overview({ data }: { data: LighterData }) {
  const totalVol = data.markets.reduce((s, m) => s + m.vol24, 0);
  const totalOI = data.markets.reduce((s, m) => s + m.oi_usd, 0);
  const totalTrades = data.markets.reduce((s, m) => s + m.trades24, 0);
  const gainers = [...data.markets].filter(m => m.vol24 > 100000).sort((a, b) => b.chg24 - a.chg24).slice(0, 5);
  const losers = [...data.markets].filter(m => m.vol24 > 100000).sort((a, b) => a.chg24 - b.chg24).slice(0, 5);
  const litVol = data.lit.daily.reduce((s, d) => s + d.volume, 0);

  const kpis = [
    { label: "24h 总成交量", value: fmtUsd(totalVol), icon: BarChart3, sub: `${data.markets.length} 个活跃市场` },
    { label: "总持仓量 (OI)", value: fmtUsd(totalOI), icon: Layers, sub: "全部市场合计" },
    { label: "24h 成交笔数", value: fmtNum(totalTrades), icon: Activity, sub: "全站交易" },
    { label: `LIT 链上转账量 (${data.lit.period_days}天)`, value: `${fmtNum(litVol)} LIT`, icon: Coins, sub: "以太坊主网" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
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
            {gainers.map(m => (
              <div key={m.symbol} className="flex justify-between items-center text-sm">
                <span className="font-medium text-zinc-200">{m.symbol}</span>
                <span className="text-zinc-500 text-xs">{fmtUsd(m.vol24)}</span>
                <span className="text-emerald-400 font-mono">+{m.chg24.toFixed(2)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2 text-zinc-200"><TrendingDown className="w-4 h-4 text-rose-400" />24h 跌幅榜（量 &gt; $100K）</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {losers.map(m => (
              <div key={m.symbol} className="flex justify-between items-center text-sm">
                <span className="font-medium text-zinc-200">{m.symbol}</span>
                <span className="text-zinc-500 text-xs">{fmtUsd(m.vol24)}</span>
                <span className="text-rose-400 font-mono">{m.chg24.toFixed(2)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
