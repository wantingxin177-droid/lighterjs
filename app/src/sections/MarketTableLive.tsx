import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Input } from "@/components/ui/input";
import { fmtUsd } from "@/types/data";

type SortKey = "vol24" | "oi" | "chg24" | "price" | "trades24";

export function MarketTableLive() {
  const q = trpc.node.markets.useQuery(undefined, { refetchInterval: 60000 });
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vol24");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const markets = (q.data ?? []).map(m => ({
      symbol: m.symbol,
      marketId: m.marketId,
      price: parseFloat(m.price ?? "0"),
      vol24: parseFloat(m.vol24 ?? "0"),
      trades24: m.trades24 ?? 0,
      chg24: parseFloat(m.chg24 ?? "0"),
      high24: parseFloat(m.high24 ?? "0"),
      low24: parseFloat(m.low24 ?? "0"),
      oi: parseFloat(m.openInterest ?? "0") * parseFloat(m.price ?? "0"),
    }));
    let r = markets.filter(m => m.symbol.toLowerCase().includes(query.toLowerCase()));
    r = [...r].sort((a, b) => (asc ? 1 : -1) * (a[sortKey] - b[sortKey]));
    return r.slice(0, 100);
  }, [q.data, query, sortKey, asc]);

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-emerald-300"
      onClick={() => { if (sortKey === k) setAsc(!asc); else { setSortKey(k); setAsc(false); } }}>
      {label}{sortKey === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input placeholder="搜索交易对…" value={query} onChange={e => setQuery(e.target.value)}
          className="max-w-xs bg-zinc-900 border-zinc-800 text-zinc-200" />
        <span className="text-xs text-zinc-500 ml-auto">数据库每分钟快照 · 共 {q.data?.length ?? 0} 个市场</span>
      </div>
      <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[560px]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">交易对</th>
              <Th label="最新价" k="price" />
              <Th label="24h涨跌" k="chg24" />
              <Th label="24h成交量" k="vol24" />
              <Th label="成交笔数" k="trades24" />
              <Th label="持仓量" k="oi" />
              <th className="px-3 py-2 text-right">24h高/低</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.marketId} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                <td className="px-3 py-2 font-medium text-zinc-100">{m.symbol}<span className="text-zinc-600 text-xs ml-1">#{m.marketId}</span></td>
                <td className="px-3 py-2 text-right font-mono text-zinc-200">{m.price >= 100 ? m.price.toLocaleString(undefined, { maximumFractionDigits: 1 }) : m.price}</td>
                <td className={`px-3 py-2 text-right font-mono ${m.chg24 >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{m.chg24 >= 0 ? "+" : ""}{m.chg24.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right text-zinc-300">{fmtUsd(m.vol24)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{m.trades24.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-zinc-300">{fmtUsd(m.oi)}</td>
                <td className="px-3 py-2 text-right text-zinc-500 text-xs">{m.high24} / {m.low24}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
