import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fmtNum, shortAddr, timeStr } from "@/types/data";

const LIT_CONTRACT = "0x232CE3bd40fCd6f80f3d55A522d03f25Df784Ee2";

export function LitLive() {
  const q = trpc.node.litStats.useQuery(undefined, { refetchInterval: 60000 });
  const data = q.data;

  const daily = useMemo(() => ((data?.daily as any[]) ?? []).map((d: any) => ({
    day: d.day, count: Number(d.count), volume: Math.round(Number(d.volume)), active: Number(d.active),
  })), [data]);

  if (q.isLoading) return <p className="text-zinc-500 text-sm">LIT 链上数据加载中…（节点正在持续同步 L1 事件）</p>;
  if (!data) return <p className="text-zinc-500 text-sm">暂无数据</p>;

  const whales = data.whales ?? [];
  const senders = (data.topSenders as any[]) ?? [];
  const receivers = (data.topReceivers as any[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-zinc-400 font-normal">已索引转账事件</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold text-zinc-50">{fmtNum(whales.length ? daily.reduce((s: number, d: any) => s + d.count, 0) : 0)}</CardContent>
        </Card>
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-zinc-400 font-normal">最大单笔转账</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold text-amber-300">{whales[0] ? fmtNum(parseFloat(whales[0].valueLit)) : 0} LIT</CardContent>
        </Card>
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-zinc-400 font-normal">已覆盖天数</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold text-zinc-50">{daily.length}</CardContent>
        </Card>
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-zinc-400 font-normal">LIT 合约</CardTitle></CardHeader>
          <CardContent>
            <a className="text-sm text-emerald-400 font-mono hover:underline" target="_blank" rel="noreferrer"
              href={`https://etherscan.io/address/${LIT_CONTRACT}`}>{shortAddr(LIT_CONTRACT)}</a>
          </CardContent>
        </Card>
      </div>

      <div className="h-[320px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
        <ResponsiveContainer>
          <ComposedChart data={daily}>
            <XAxis dataKey="day" stroke="#52525b" fontSize={11} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis yAxisId="l" stroke="#52525b" fontSize={11} tickFormatter={fmtNum} />
            <YAxis yAxisId="r" orientation="right" stroke="#52525b" fontSize={11} tickFormatter={fmtNum} />
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
            <Legend />
            <Bar yAxisId="l" dataKey="volume" name="转账量 (LIT)" fill="#a78bfa" />
            <Line yAxisId="r" dataKey="count" name="转账笔数" stroke="#34d399" dot={false} strokeWidth={1.5} />
            <Line yAxisId="r" dataKey="active" name="活跃地址数" stroke="#60a5fa" dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm text-zinc-300 mb-2">最大转账 TOP 15（鲸鱼监控）</h4>
          <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[320px]">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left">时间</th>
                  <th className="px-2 py-2 text-left">从 → 到</th>
                  <th className="px-2 py-2 text-right">数量 (LIT)</th>
                </tr>
              </thead>
              <tbody>
                {whales.slice(0, 15).map((w) => (
                  <tr key={w.id} className="border-t border-zinc-800/60">
                    <td className="px-2 py-1.5 text-zinc-400 whitespace-nowrap">{timeStr(w.ts)}</td>
                    <td className="px-2 py-1.5 font-mono text-zinc-300">
                      <a className="hover:text-emerald-400" target="_blank" rel="noreferrer" href={`https://etherscan.io/tx/${w.txHash}`}>
                        {shortAddr(w.fromAddr)} → {shortAddr(w.toAddr)}
                      </a>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-amber-300">{fmtNum(parseFloat(w.valueLit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid gap-4 content-start">
          <div>
            <h4 className="text-sm text-zinc-300 mb-2">发送量最大地址 TOP 10</h4>
            <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[150px]">
              <table className="w-full text-xs">
                <tbody>
                  {senders.slice(0, 10).map((a: any, i: number) => (
                    <tr key={i} className="border-t border-zinc-800/60 first:border-0">
                      <td className="px-2 py-1.5 font-mono text-zinc-300">
                        <a className="hover:text-emerald-400" target="_blank" rel="noreferrer" href={`https://etherscan.io/address/${a.addr}`}>{shortAddr(a.addr)}</a>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-rose-300">{fmtNum(Number(a.v))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="text-sm text-zinc-300 mb-2">接收量最大地址 TOP 10</h4>
            <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[150px]">
              <table className="w-full text-xs">
                <tbody>
                  {receivers.slice(0, 10).map((a: any, i: number) => (
                    <tr key={i} className="border-t border-zinc-800/60 first:border-0">
                      <td className="px-2 py-1.5 font-mono text-zinc-300">
                        <a className="hover:text-emerald-400" target="_blank" rel="noreferrer" href={`https://etherscan.io/address/${a.addr}`}>{shortAddr(a.addr)}</a>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-300">{fmtNum(Number(a.v))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
