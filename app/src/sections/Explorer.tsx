import { useMemo, useState } from "react";
import { txLabel } from "@/types/explorer";
import type { ExplorerData, ExplBlock } from "@/types/explorer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Box, Gauge, Clock, Hash } from "lucide-react";

const PIE_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#94a3b8"];

export function Explorer({ data }: { data: ExplorerData }) {
  const [selected, setSelected] = useState<ExplBlock | null>(null);
  const blocks = data.blocks;

  const stats = useMemo(() => {
    const ts = blocks.map(b => b.ts).filter((t): t is number => t != null);
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 1;
    const totalTx = blocks.reduce((s, b) => s + b.n_logs, 0);
    const typeCount: Record<string, number> = {};
    for (const b of blocks) for (const [k, v] of Object.entries(b.types)) typeCount[k] = (typeCount[k] ?? 0) + v;
    return {
      span,
      bps: blocks.length / span,
      tps: totalTx / span,
      totalTx,
      typeDist: Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name: txLabel(name), raw: name, value })),
    };
  }, [blocks]);

  const flowData = useMemo(() =>
    blocks.filter(b => b.ts != null).map(b => ({
      t: b.ts!,
      label: new Date(b.ts! * 1000).toLocaleTimeString("zh-CN", { hour12: false }),
      txs: b.n_logs,
      height: b.h,
    })), [blocks]);

  const kpis = [
    { label: "最新区块高度", value: `#${data.meta.latest_height.toLocaleString()}`, icon: Box },
    { label: "出块速度", value: `${stats.bps.toFixed(1)} 块/秒`, icon: Clock, sub: "约 160ms/块" },
    { label: "交易吞吐", value: `${stats.tps.toFixed(0)} tx/秒`, icon: Gauge, sub: `窗口内共 ${stats.totalTx.toLocaleString()} 笔` },
    { label: "已同步区块", value: data.meta.blocks_synced.toLocaleString(), icon: Hash, sub: `${data.meta.span_sec}s 时间窗` },
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

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-[260px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <p className="text-xs text-zinc-500 px-2 pt-1">逐区块交易数（点击下表任意行查看区块详情）</p>
          <ResponsiveContainer>
            <AreaChart data={flowData}>
              <XAxis dataKey="label" stroke="#52525b" fontSize={10} minTickGap={40} />
              <YAxis stroke="#52525b" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                formatter={(v: number, name: string) => [v, name === "txs" ? "交易数" : name]}
                labelFormatter={(_, p) => p?.[0] ? `区块 #${p[0].payload.height.toLocaleString()} · ${p[0].payload.label}` : ""}
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
              <th className="px-3 py-2 text-right">市场快照</th>
            </tr>
          </thead>
          <tbody>
            {[...blocks].reverse().map(b => (
              <tr key={b.h} onClick={() => setSelected(b)}
                className="border-t border-zinc-800/60 hover:bg-emerald-950/30 cursor-pointer">
                <td className="px-3 py-1.5 font-mono text-emerald-400">#{b.h.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-zinc-400 text-xs">{b.time ? b.time.replace("T", " ").replace("Z", "") : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono text-zinc-200">{b.n_logs}</td>
                <td className="px-3 py-1.5 text-xs text-zinc-400">
                  {Object.entries(b.types).slice(0, 3).map(([t, n]) => `${txLabel(t)}×${n}`).join(" · ") || "—"}
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-500 text-xs">{b.markets.length} 个市场</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BlockDetail block={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BlockDetail({ block, onClose }: { block: ExplBlock | null; onClose: () => void }) {
  if (!block) return null;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800 text-zinc-100 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">区块 #{block.h.toLocaleString()}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-zinc-500 space-y-1">
          <p>时间：{block.time} · 交易 {block.n_logs} 笔 · 市场快照 {block.markets.length} 个</p>
        </div>
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
              {block.txs.map((t, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.type === "L2CreateOrder" ? "bg-emerald-500/15 text-emerald-300" : t.type === "InternalClaimOrder" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-700/40 text-zinc-300"}`}>
                      {txLabel(t.type)}
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
        {block.markets.length > 0 && (
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
                  {block.markets.map((m, i) => (
                    <tr key={i} className="border-t border-zinc-800/60">
                      <td className="px-2 py-1 text-right font-mono text-zinc-300">{m.i}</td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-200">{m.px.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-400">{m.oi.toLocaleString()}</td>
                      <td className={`px-2 py-1 text-right font-mono ${m.fr >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{(m.fr * 100).toFixed(4)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
