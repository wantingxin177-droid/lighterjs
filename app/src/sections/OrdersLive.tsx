import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { fmtNum, fmtUsd } from "@/types/data";

const EVT_LABEL: Record<string, { label: string; cls: string }> = {
  create: { label: "挂单创建", cls: "bg-emerald-500/15 text-emerald-300" },
  fill: { label: "吃单成交", cls: "bg-sky-500/15 text-sky-300" },
  fill_maker: { label: "挂单成交", cls: "bg-violet-500/15 text-violet-300" },
  cancel: { label: "撤单", cls: "bg-zinc-600/40 text-zinc-300" },
};

export function OrdersLive() {
  const events = trpc.node.recentOrderEvents.useQuery({ limit: 120 }, { refetchInterval: 8000 });
  const activeWindows = trpc.node.activeAccountWindows.useQuery({ limit: 30 }, { refetchInterval: 30000 });
  const [windowKey, setWindowKey] = useState("30m");
  const [pairHours, setPairHours] = useState(24);
  const orderPairs = trpc.node.orderPairs.useQuery({ hours: pairHours, limit: 60 }, { refetchInterval: 30000 });
  const marketsQ = trpc.node.markets.useQuery(undefined, { refetchInterval: 60000 });
  const symbolById = useMemo(() => {
    const m: Record<number, string> = {};
    for (const x of marketsQ.data ?? []) m[x.marketId] = x.symbol;
    return m;
  }, [marketsQ.data]);
  const [account, setAccount] = useState<string | null>(null);
  const accountOrders = trpc.node.accountOrders.useQuery(
    { account: account ?? "", limit: 150 },
    { enabled: account != null }
  );
  const live = trpc.node.accountLive.useQuery(
    { account: account ?? "", limit: 40 },
    { enabled: account != null, refetchInterval: 3000 }
  );
  const track = trpc.node.trackAccount.useMutation({
    onSuccess: () => live.refetch(),
  });

  useEffect(() => {
    if (account) track.mutate({ account });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const list = account ? (accountOrders.data ?? []) : (events.data ?? []);
  const livePositions = useMemo(() => {
    const p = live.data?.snapshot?.positions ?? {};
    return Object.values(p as Record<string, any>)
      .filter((x) => Math.abs(parseFloat(x.position ?? "0")) > 0 || Number(x.open_order_count ?? 0) > 0)
      .sort((a, b) => Math.abs(parseFloat(b.position_value ?? "0")) - Math.abs(parseFloat(a.position_value ?? "0")))
      .slice(0, 8);
  }, [live.data]);
  const liveAssets = useMemo(() => {
    const a = live.data?.snapshot?.assets ?? {};
    return Object.values(a as Record<string, any>)
      .filter((x) => Math.abs(parseFloat(x.balance ?? "0")) > 0 || Math.abs(parseFloat(x.margin_balance ?? "0")) > 0 || Math.abs(parseFloat(x.locked_balance ?? "0")) > 0)
      .slice(0, 6);
  }, [live.data]);
  const windows = activeWindows.data?.windows ?? [];
  const selectedWindow = windows.find((w) => w.key === windowKey) ?? windows[0];
  const activityRows = selectedWindow?.accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs text-zinc-500">
          从 L2 区块事件重建订单生命周期；点击账户后自动加入 WS 实时跟踪，补充逐账户仓位与成交流。
        </p>
        {account && (
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${live.data?.tracking ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-700/40 text-zinc-400"}`}>
              {live.data?.tracking ? "WS 跟踪中" : "等待 WS"}
            </span>
            <button onClick={() => setAccount(null)}
              className="text-xs px-2.5 py-1 rounded bg-amber-600/20 text-amber-300 border border-amber-600/40">
              账户 #{account.slice(-8)} · 返回全部
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        {windows.map((w) => (
          <button
            key={w.key}
            onClick={() => setWindowKey(w.key)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              selectedWindow?.key === w.key
                ? "border-emerald-500/60 bg-emerald-950/30"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            <p className="text-[11px] text-zinc-400">{w.label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{fmtNum(w.activeAccounts)}</p>
            <p className="text-[10px] text-zinc-500">
              {fmtNum(w.totalEvents)} 事件 · {fmtUsd(w.fillNotional)}
            </p>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>按订单创建 / 撤单 / 成交事件统计，成交名义额只计入 fill 类事件。</span>
        <span>{activeWindows.data ? `数据截至 ${new Date(activeWindows.data.anchorTs * 1000).toLocaleTimeString("zh-CN", { hour12: false })} · 更新于 ${new Date(activeWindows.data.generatedAt).toLocaleTimeString("zh-CN", { hour12: false })} · API 缓存 30 秒` : "正在聚合时间窗…"}</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* 订单事件流 */}
        <div className="lg:col-span-2 rounded-lg border border-zinc-800 overflow-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left">时间</th>
                <th className="px-2 py-2 text-left">事件</th>
                <th className="px-2 py-2 text-right">账户</th>
                <th className="px-2 py-2 text-right">市场</th>
                <th className="px-2 py-2 text-right">方向</th>
                <th className="px-2 py-2 text-right">价格</th>
                <th className="px-2 py-2 text-right">数量</th>
                <th className="px-2 py-2 text-right">金额</th>
              </tr>
            </thead>
            <tbody>
              {list.map(e => {
                const usd = parseFloat(e.price ?? "0") * parseFloat(e.size ?? "0");
                const ev = EVT_LABEL[e.eventType] ?? { label: e.eventType, cls: "bg-zinc-700/40 text-zinc-300" };
                return (
                  <tr key={e.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                    <td className="px-2 py-1.5 text-zinc-400 text-xs whitespace-nowrap">{new Date(e.ts * 1000).toLocaleTimeString("zh-CN", { hour12: false })}</td>
                    <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] ${ev.cls}`}>{ev.label}</span></td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-400 text-xs cursor-pointer hover:text-emerald-400"
                      onClick={() => e.ownerAccount && setAccount(e.ownerAccount)}>
                      {e.ownerAccount ? `#${e.ownerAccount.slice(-8)}` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{e.marketIndex ?? "—"}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${e.side === "bid" ? "text-emerald-400" : e.side === "ask" ? "text-rose-400" : "text-zinc-500"}`}>
                      {e.side === "bid" ? "买" : e.side === "ask" ? "卖" : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-200">{e.price ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-200">{e.size ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-400">{usd > 0 ? fmtUsd(usd) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <p className="text-xs text-zinc-600 p-4">订单事件回填中，稍候自动出现…</p>}
        </div>

        {/* WS 实时账户面板 + 活跃账户榜 */}
        <div className="space-y-4">
          {account && (
            <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/10 overflow-hidden">
              <div className="flex justify-between items-center py-2 px-3 border-b border-emerald-900/50">
                <p className="text-xs text-emerald-300">WS 实时账户 #{account.slice(-10)}</p>
                <span className="text-[10px] text-zinc-500">{live.data?.snapshot ? new Date(live.data.snapshot.ts).toLocaleTimeString("zh-CN", { hour12: false }) : "等待快照"}</span>
              </div>
              <div className="p-3 space-y-3">
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">非零仓位 / 挂单计数</p>
                  {livePositions.length === 0 && <p className="text-xs text-zinc-600">暂无实时仓位快照</p>}
                  {livePositions.map((p: any) => (
                    <div key={p.market_id} className="flex justify-between text-xs py-1 border-b border-zinc-800/40 last:border-0">
                      <span className="text-zinc-300">{p.symbol ?? `市场${p.market_id}`}</span>
                      <span className={`font-mono ${parseFloat(p.position ?? "0") >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{p.position}</span>
                      <span className="font-mono text-zinc-500">PnL {fmtUsd(parseFloat(p.unrealized_pnl ?? "0"))}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">资产 / 保证金</p>
                  <div className="flex flex-wrap gap-1.5">
                    {liveAssets.map((a: any) => (
                      <span key={a.asset_id} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                        {a.symbol} {parseFloat(a.margin_balance ?? a.balance ?? "0").toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">实时成交（account_all）</p>
                  {(live.data?.trades ?? []).slice(0, 5).map((t) => (
                    <div key={t.id} className="flex justify-between text-[11px] py-1 border-b border-zinc-800/40 last:border-0">
                      <span className="text-zinc-500">{new Date(t.ts).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                      <span className={t.side === "bid" ? "text-emerald-400" : "text-rose-400"}>{t.side === "bid" ? "买" : "卖"}</span>
                      <span className="font-mono text-zinc-300">{t.size} @ {t.price}</span>
                      <span className="text-zinc-600">{t.role ?? ""}</span>
                    </div>
                  ))}
                  {(live.data?.trades ?? []).length === 0 && <p className="text-xs text-zinc-600">等待该账户下一笔成交…</p>}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <div className="flex justify-between items-center py-2 px-3 border-b border-zinc-800">
              <p className="text-xs text-zinc-300">{selectedWindow?.label ?? "时间窗"}活跃账户</p>
              <span className="text-[10px] text-zinc-500">Top {activityRows.length}</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {activityRows.map((a, index) => (
                <div key={a.account}
                  onClick={() => setAccount(String(a.account))}
                  className={`px-3 py-2 border-b border-zinc-800/50 cursor-pointer hover:bg-emerald-950/30 ${account === String(a.account) ? "bg-emerald-950/40" : ""}`}>
                  <div className="flex justify-between items-center gap-2">
                    <span className="font-mono text-xs text-zinc-200">
                      <span className="text-zinc-600 mr-1.5">{index + 1}.</span>#{String(a.account).slice(-10)}
                    </span>
                    <span className="text-[10px] text-zinc-500">{fmtNum(a.events)} 事件 · {fmtUsd(a.fillNotional)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 text-[10px]">
                    <span className="text-emerald-400">挂 {fmtNum(a.creates)}</span>
                    <span className="text-zinc-400">撤 {fmtNum(a.cancels + a.expires)}</span>
                    <span className="text-sky-400">吃 {fmtNum(a.takerFills)}</span>
                    <span className="text-violet-400">成 {fmtNum(a.makerFills)}</span>
                    <span className="text-zinc-600">市场 {a.markets}</span>
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-zinc-600">
                    <span>买 {fmtNum(a.buyEvents)} / 卖 {fmtNum(a.sellEvents)}</span>
                    <span>{new Date(a.lastTs * 1000).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                  </div>
                </div>
              ))}
              {activityRows.length === 0 && (
                <p className="text-xs text-zinc-600 p-4">该时间窗暂无账户事件，等待区块详情回填。</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 创建/减仓配对标记 */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="flex flex-wrap justify-between items-center gap-2 py-2 px-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <p className="text-xs text-zinc-300">创建/减仓配对标记 <span className="text-zinc-500">同账户 · 同市场 · 同数量 · 反向挂单两两配对</span></p>
            <div className="flex gap-1">
              {[1, 6, 24].map((h) => (
                <button key={h} onClick={() => setPairHours(h)}
                  className={`text-[10px] px-2 py-0.5 rounded border ${pairHours === h ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"}`}>
                  近{h}小时
                </button>
              ))}
            </div>
          </div>
          <span className="text-[10px] text-zinc-500">
            {orderPairs.data ? `候选组 ${fmtNum(orderPairs.data.stats.groups)} · 配对 ${fmtNum(orderPairs.data.stats.pairs)} · 账户 ${fmtNum(orderPairs.data.stats.accounts)} · 疑似对倒 ${fmtNum(orderPairs.data.stats.washLike)}` : "配对计算中…"}
          </span>
        </div>
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left">标记</th>
                <th className="px-2 py-2 text-right">账户</th>
                <th className="px-2 py-2 text-right">市场</th>
                <th className="px-2 py-2 text-right">数量</th>
                <th className="px-2 py-2 text-center">方向</th>
                <th className="px-2 py-2 text-right">创建单</th>
                <th className="px-2 py-2 text-right">对应减仓单</th>
                <th className="px-2 py-2 text-right">间隔</th>
              </tr>
            </thead>
            <tbody>
              {(orderPairs.data?.pairs ?? []).map((p, i) => (
                <tr key={`${p.close.txHash}-${i}`} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.washLike ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>
                      {p.washLike ? "疑似对倒" : `${p.direction}减仓`}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-zinc-400 text-xs cursor-pointer hover:text-emerald-400"
                    onClick={() => setAccount(p.account)}>
                    #{p.account.slice(-8)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-zinc-300 text-xs">{symbolById[p.market] ?? `市场${p.market}`}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-zinc-200">{p.size}</td>
                  <td className="px-2 py-1.5 text-center text-xs whitespace-nowrap">
                    <span className={p.open.side === "bid" ? "text-emerald-400" : "text-rose-400"}>{p.open.side === "bid" ? "买" : "卖"}</span>
                    <span className="text-zinc-600 mx-1">→</span>
                    <span className={p.close.side === "bid" ? "text-emerald-400" : "text-rose-400"}>{p.close.side === "bid" ? "买" : "卖"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-zinc-400 whitespace-nowrap">
                    {new Date(p.open.ts * 1000).toLocaleTimeString("zh-CN", { hour12: false })} @ {p.open.price}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-zinc-300 whitespace-nowrap">
                    {new Date(p.close.ts * 1000).toLocaleTimeString("zh-CN", { hour12: false })} @ {p.close.price}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-zinc-500">
                    {p.gapSec < 60 ? `${p.gapSec}s` : p.gapSec < 3600 ? `${Math.floor(p.gapSec / 60)}m` : `${(p.gapSec / 3600).toFixed(1)}h`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(orderPairs.data?.pairs ?? []).length === 0 && (
            <p className="text-xs text-zinc-600 p-4">该时间窗内未发现同账户同数量的反向挂单对。</p>
          )}
        </div>
        <p className="text-[10px] text-zinc-600 px-3 py-2 border-t border-zinc-800">
          判定规则：同一账户在同一市场挂出数量完全相同的反向创建订单，按时间先后 FIFO 配对；间隔 ≤60 秒且价差 &lt;0.1% 标为「疑似对倒」，其余按先手方向标为「平多/平空减仓」。
        </p>
      </div>
    </div>
  );
}
