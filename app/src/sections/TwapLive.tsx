import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Bot, AlertTriangle } from "lucide-react";

export function TwapLive() {
  const [windowSec, setWindowSec] = useState(3600);
  const q = trpc.node.twapDetect.useQuery({ windowSec }, { refetchInterval: 30000 });
  const rows = (q.data as any[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-zinc-500 mr-2">
          TWAP/拆单检测：识别同一账户在同一市场、同一方向上的高频连续小单（TWAP 在链上表现为一串等间隔同向单）。窗口：
        </p>
        {[1800, 3600, 7200].map(w => (
          <Button key={w} size="sm" variant={windowSec === w ? "default" : "outline"} onClick={() => setWindowSec(w)}
            className={windowSec === w ? "bg-emerald-600 hover:bg-emerald-500" : "border-zinc-700 text-zinc-400"}>
            {w / 3600}h
          </Button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">每 30s 重新计算</span>
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[560px]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">账户</th>
              <th className="px-3 py-2 text-right">市场</th>
              <th className="px-3 py-2 text-right">方向</th>
              <th className="px-3 py-2 text-right">拆单数</th>
              <th className="px-3 py-2 text-right">总数量</th>
              <th className="px-3 py-2 text-right">价位数</th>
              <th className="px-3 py-2 text-left">时间跨度</th>
              <th className="px-3 py-2 text-left">判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => {
              const spanMin = Math.round((Number(r.end_ts) - Number(r.start_ts)) / 60);
              const orders = Number(r.orders);
              const levels = Number(r.price_levels);
              // TWAP 特征：大量同向单、跨多个价位、时间跨度长 → 疑似算法拆单
              const isTwap = orders >= 12 && spanMin >= 10;
              return (
                <tr key={i} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                  <td className="px-3 py-2 font-mono text-zinc-200 text-xs">#{String(r.account).slice(-10)}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-300">{r.market}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.side === "bid" ? "text-emerald-400" : "text-rose-400"}`}>
                    {r.side === "bid" ? "买入" : "卖出"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-300">{orders}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200">{Number(r.total_size).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-400">{levels}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{spanMin} 分钟</td>
                  <td className="px-3 py-2">
                    {isTwap ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-amber-500/15 text-amber-300">
                        <Bot className="w-3 h-3" />疑似 TWAP
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-zinc-700/40 text-zinc-400">
                        <AlertTriangle className="w-3 h-3" />高频单
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-xs text-zinc-600 p-4">该时间窗内未检测到 ≥8 单的聚类，稍候自动重算…</p>}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500 space-y-1.5">
        <p className="text-zinc-300 font-medium">关于计划单 / TWAP 数据可见性说明</p>
        <p>· <span className="text-zinc-300">可检测</span>：TWAP/拆单的"执行痕迹"（同账户同向连续小单）在 L2 区块里是公开的，本页即通过聚类算法识别。</p>
        <p>· <span className="text-zinc-300">不可见</span>：计划单（trigger/TWAP 母单）的"挂单意图状态"只存在于 Lighter 排序器内存与鉴权接口中，上链前匿名无法获取。本面板不伪造这部分数据。</p>
        <p>· <span className="text-zinc-300">可补齐</span>：账户的实时挂单/撤单完整流通过 WebSocket <code className="text-zinc-300">account_all</code> 频道推送，但当前服务器区域被 CloudFront 地域限制（"restricted jurisdiction"）无法连接；一旦部署到非受限区域，接入 WS 采集器即可呈现完整账户订单流。</p>
      </div>
    </div>
  );
}
