import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Box, Clock, Hash, Database, CheckCircle2, XCircle } from "lucide-react";

const PIE_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#94a3b8"];

const TX_TYPE_LABEL: Record<string, string> = {
  L2CreateOrder: "创建订单",
  InternalClaimOrder: "撮合成交",
  InternalTransfer: "内部转账",
  L2Transfer: "L2 转账",
  L2UpdateLeverage: "调整杠杆",
  L2CancelOrder: "取消订单",
  L2Deposit: "充值",
  L2Withdraw: "提现",
};
const txLabel = (t: string) => TX_TYPE_LABEL[t] ?? t;

export function ExplorerLive() {
  const status = trpc.node.status.useQuery(undefined, { refetchInterval: 8000 });
  const recent = trpc.node.recentBlocks.useQuery({ limit: 120 }, { refetchInterval: 8000 });
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const detail = trpc.node.blockDetail.useQuery(
    { height: selectedHeight ?? 0 },
    { enabled: selectedHeight != null }
  );

  const blocks = useMemo(() => [...(recent.data ?? [])].sort((a, b) => a.height - b.height), [recent.data]);

  const detailBlocks = useMemo(() => blocks.filter(b => b.nLogs >= 0), [blocks]);
  const stats = useMemo(() => {
    const ts = detailBlocks.map(b => b.ts).filter((t): t is number => t != null);
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 1;
    const totalTx = detailBlocks.reduce((s, b) => s + b.nLogs, 0);
    const typeCount: Record<string, number> = {};
    for (const b of detailBlocks) for (const [k, v] of Object.entries(b.types as Record<string, number>)) typeCount[k] = (typeCount[k] ?? 0) + v;
    return {
      bps: detailBlocks.length / Math.max(span, 1),
      tps: totalTx / Math.max(span, 1),
      totalTx,
      typeDist: Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name: txLabel(name), value })),
    };
  }, [detailBlocks]);

  const flowData = useMemo(() =>
    blocks.filter(b => b.ts != null).map(b => ({
      label: new Date(b.ts! * 1000).toLocaleTimeString("zh-CN", { hour12: false }),
      txs: b.nLogs, height: b.height,
    })), [blocks]);

  const s = status.data;

  const kpis = [
    { label: "最新区块高度", value: s ? `#${s.counts.latestHeight.toLocaleString()}` : "…", icon: Box },
    { label: "出块速度", value: `${stats.bps.toFixed(1)} 块/秒`, icon: Clock, sub: `吞吐 ${stats.tps.toFixed(0)} tx/秒` },
    { label: "数据库已存区块", value: (s?.counts.blocks ?? 0).toLocaleString(), icon: Database, sub: `含完整详情 ${(s?.counts.blocksWithDetail ?? 0).toLocaleString()} 块 · 交易 ${(s?.counts.txs ?? 0).toLocaleString()} 笔` },
    { label: "节点运行时长", value: s ? `${Math.floor(s.uptimeSec / 60)} 分钟` : "…", icon: Hash, sub: "持续同步中" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="bg-zinc-900/60 border-zinc-800">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs text-zinc-400 font-normal">{k.label}</CardTitle>
              <k.icon className="w-4 h-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-50">{k.value}</div>
              {k.sub && <div className="text-xs text-zinc-500 mt-1">{k.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 同步任务状态 */}
      <Card className="bg-zinc-900/60 border-zinc-800">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">同步任务（持久化到数据库，断点续拉）</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {s && Object.entries(s.jobs).map(([name, j]) => (
            <div key={name} className="flex items-center gap-1.5">
              {j.lastOk ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              <span className="text-zinc-300 font-mono">{name}</span>
              <span className="text-zinc-500">{j.detail} · 第 {j.runs} 轮</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-[260px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <p className="text-xs text-zinc-500 px-2 pt-1">逐区块交易数（每 8 秒自动刷新）</p>
          <ResponsiveContainer>
            <AreaChart data={flowData}>
              <XAxis dataKey="label" stroke="#52525b" fontSize={10} minTickGap={40} />
              <YAxis stroke="#52525b" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                formatter={(v: number) => [v, "交易数"]}
                labelFormatter={(_, p) => p?.[0] ? `区块 #${(p[0].payload.height as number).toLocaleString()} · ${p[0].payload.label}` : ""}
              />
              <Area dataKey="txs" stroke="#34d399" fill="#34d39922" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="h-[260px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <p className="text-xs text-zinc-500 px-2 pt-1">交易类型分布</p>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={stats.typeDist} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} strokeWidth={1}>
                {stats.typeDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[480px]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left">高度</th>
              <th className="px-3 py-2 text-left">时间 (UTC)</th>
              <th className="px-3 py-2 text-right">交易数</th>
              <th className="px-3 py-2 text-left">交易构成</th>
              <th className="px-3 py-2 text-right">入库时间</th>
            </tr>
          </thead>
          <tbody>
            {[...blocks].reverse().map(b => (
              <tr key={b.height} onClick={() => setSelectedHeight(b.height)}
                className="border-t border-zinc-800/60 hover:bg-emerald-950/30 cursor-pointer">
                <td className="px-3 py-1.5 font-mono text-emerald-400">#{b.height.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-zinc-400 text-xs">{b.time ? b.time.replace("T", " ").replace("Z", "") : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono text-zinc-200">{b.nLogs >= 0 ? b.nLogs : b.nTxs}</td>
                <td className="px-3 py-1.5 text-xs text-zinc-400">
                  {b.nLogs >= 0
                    ? Object.entries(b.types as Record<string, number>).slice(0, 3).map(([t, n]) => `${txLabel(t)}×${n}`).join(" · ") || "—"
                    : <span className="text-zinc-600">详情回填中，点击查看</span>}
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-600 text-xs">{new Date(b.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={selectedHeight != null} onOpenChange={() => setSelectedHeight(null)}>
        <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800 text-zinc-100 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">区块 #{selectedHeight?.toLocaleString()}</DialogTitle>
          </DialogHeader>
          {detail.isLoading && <p className="text-zinc-500 text-sm">正在从链上实时拉取该区块详情…</p>}
          {detail.data?.pending && <p className="text-amber-400/80 text-sm">该区块详情正在后台回填，稍后自动可见。</p>}
          {detail.data && (
            <>
              <p className="text-xs text-zinc-500">时间：{detail.data.block.time} · 交易 {detail.data.txs.length} 笔 · 市场快照 {detail.data.markets.length} 个</p>
              <h4 className="text-sm text-zinc-300 mt-3">区块内交易</h4>
              <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[300px]">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left">类型</th>
                      <th className="px-2 py-2 text-left">哈希</th>
                      <th className="px-2 py-2 text-right">市场</th>
                      <th className="px-2 py-2 text-right">价格</th>
                      <th className="px-2 py-2 text-right">数量</th>
                      <th className="px-2 py-2 text-right">账户 (吃单/挂单)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.txs.map((t) => (
                      <tr key={t.id} className="border-t border-zinc-800/60">
                        <td className="px-2 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.txType === "L2CreateOrder" ? "bg-emerald-500/15 text-emerald-300" : t.txType === "InternalClaimOrder" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-700/40 text-zinc-300"}`}>
                            {txLabel(t.txType)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-zinc-400">{t.hash.slice(0, 12)}…</td>
                        <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{t.market ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-zinc-200">{t.price ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-zinc-200">{t.size ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-zinc-500">{t.taker ?? "—"} / {t.maker ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.data.markets.length > 0 && (
                <>
                  <h4 className="text-sm text-zinc-300 mt-3">区块内市场状态快照</h4>
                  <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[200px]">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-right">市场ID</th>
                          <th className="px-2 py-2 text-right">标记价</th>
                          <th className="px-2 py-2 text-right">持仓量</th>
                          <th className="px-2 py-2 text-right">当期资金费率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.markets.map((m) => {
                          const fr = parseFloat(m.fundingRate ?? "0");
                          return (
                            <tr key={m.id} className="border-t border-zinc-800/60">
                              <td className="px-2 py-1 text-right font-mono text-zinc-300">{m.marketIndex}</td>
                              <td className="px-2 py-1 text-right font-mono text-zinc-200">{parseFloat(m.price ?? "0").toLocaleString()}</td>
                              <td className="px-2 py-1 text-right font-mono text-zinc-400">{parseFloat(m.openInterest ?? "0").toLocaleString()}</td>
                              <td className={`px-2 py-1 text-right font-mono ${fr >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{(fr * 100).toFixed(4)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
