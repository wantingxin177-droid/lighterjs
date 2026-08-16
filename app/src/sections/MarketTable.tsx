import { useMemo, useState } from "react";
import type { Market } from "@/types/data";
import { fmtUsd } from "@/types/data";
import { Input } from "@/components/ui/input";

type SortKey = "vol24" | "oi_usd" | "chg24" | "price" | "trades24";

export function MarketTable({ markets }: { markets: Market[] }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vol24");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    let r = markets.filter(m => m.symbol.toLowerCase().includes(q.toLowerCase()));
    r = [...r].sort((a, b) => (asc ? 1 : -1) * ((a[sortKey] as number) - (b[sortKey] as number)));
    return r.slice(0, 100);
  }, [markets, q, sortKey, asc]);

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2 text-right cursor-pointer select-none hover:text-emerald-300"
      onClick={() => { if (sortKey === k) setAsc(!asc); else { setSortKey(k); setAsc(false); } }}
    >
      {label}{sortKey === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <Input
        placeholder="搜索交易对…"
        value={q}
        onChange={e => setQ(e.target.value)}
        className="max-w-xs bg-zinc-900 border-zinc-800 text-zinc-200"
      />
      <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[560px]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">交易对</th>
              <th className="px-3 py-2 text-right">最新价</th>
              <Th label="24h涨跌" k="chg24" />
              <Th label="24h成交量" k="vol24" />
              <Th label="成交笔数" k="trades24" />
              <Th label="持仓量" k="oi_usd" />
              <th className="px-3 py-2 text-right">24h高/低</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.market_id} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                <td className="px-3 py-2 font-medium text-zinc-100">{m.symbol}<span className="text-zinc-600 text-xs ml-1">#{m.market_id}</span></td>
                <td className="px-3 py-2 text-right font-mono text-zinc-200">{m.price >= 100 ? m.price.toLocaleString(undefined, { maximumFractionDigits: 1 }) : m.price}</td>
                <td className={`px-3 py-2 text-right font-mono ${m.chg24 >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{m.chg24 >= 0 ? "+" : ""}{m.chg24.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right text-zinc-300">{fmtUsd(m.vol24)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{m.trades24.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-zinc-300">{fmtUsd(m.oi_usd)}</td>
                <td className="px-3 py-2 text-right text-zinc-500 text-xs">{m.high24} / {m.low24}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
