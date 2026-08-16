import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { fmtUsd } from "@/types/data";

const WHALE_THRESHOLD = 10000;

export function TradesLive() {
  const q = trpc.node.recentTxs.useQuery({ limit: 200 }, { refetchInterval: 10000 });
  const txs = q.data ?? [];
  const [minUsd, setMinUsd] = useState(0);

  const filtered = useMemo(() => {
    return txs.filter(t => {
      const usd = parseFloat(t.price ?? "0") * parseFloat(t.size ?? "0");
      return usd >= minUsd;
    });
  }, [txs, minUsd]);

  const claimTxs = useMemo(() => txs.filter(t => t.txType === "InternalClaimOrder"), [txs]);
  const whaleTxs = useMemo(() =>
    txs.filter(t => parseFloat(t.price ?? "0") * parseFloat(t.size ?? "0") >= WHALE_THRESHOLD),
    [txs]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">本地节点数据库中最近 {txs.length} 笔 L2 交易（每 10 秒自动刷新，历史持续累积）。</p>
      <div className="flex gap-2 text-xs">
        {[0, 1000, 10000, 50000].map(v => (
          <button key={v} onClick={() => setMinUsd(v)}
            className={`px-2.5 py-1 rounded border ${minUsd === v ? "bg-emerald-600 border-emerald-600 text-white" : "border-zinc-700 text-zinc-400"}`}>
            {v === 0 ? "全部" : `≥ $${v / 1000}K`}
          </button>
        ))}
        <span className="ml-auto text-zinc-500 self-center">大额（≥$10K）：{whaleTxs.length} 笔 · 撮合成交：{claimTxs.length} 笔</span>
      </div>
      <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[520px]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">时间 (UTC)</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-right">区块</th>
              <th className="px-3 py-2 text-right">市场</th>
              <th className="px-3 py-2 text-right">价格</th>
              <th className="px-3 py-2 text-right">数量</th>
              <th className="px-3 py-2 text-right">金额估算</th>
              <th className="px-3 py-2 text-right">账户 (吃/挂)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => {
              const usd = parseFloat(t.price ?? "0") * parseFloat(t.size ?? "0");
              return (
                <tr key={t.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                  <td className="px-3 py-1.5 text-zinc-400 text-xs whitespace-nowrap">{t.time ? t.time.replace("T", " ").replace("Z", "").slice(5, 23) : "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.txType === "L2CreateOrder" ? "bg-emerald-500/15 text-emerald-300" : t.txType === "InternalClaimOrder" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-700/40 text-zinc-300"}`}>
                      {t.txType}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-500 text-xs">#{t.blockHeight.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-300">{t.market ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-200">{t.price ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-200">{t.size ?? "—"}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${usd >= WHALE_THRESHOLD ? "text-amber-300" : "text-zinc-400"}`}>{usd > 0 ? fmtUsd(usd) : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-500 text-xs">{t.taker ?? "—"} / {t.maker ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
