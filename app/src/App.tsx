import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/providers/trpc";
import { ExplorerLive } from "@/sections/ExplorerLive";
import { BatchesLive } from "@/sections/BatchesLive";
import { OverviewLive } from "@/sections/OverviewLive";
import { MarketTableLive } from "@/sections/MarketTableLive";
import { FundingLive } from "@/sections/FundingLive";
import { TradesLive } from "@/sections/TradesLive";
import { OrderBookLive } from "@/sections/OrderBookLive";
import { OrdersLive } from "@/sections/OrdersLive";
import { TwapLive } from "@/sections/TwapLive";
import { LitLive } from "@/sections/LitLive";
import { Zap, Radio, Database } from "lucide-react";

export default function App() {
  const status = trpc.node.status.useQuery(undefined, { refetchInterval: 10000 });
  const s = status.data;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/80 sticky top-0 z-10 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">LighterAnalyzer</h1>
            <p className="text-xs text-zinc-500">Lighter 轻节点 · 区块浏览器 + 数据分析面板</p>
          </div>
          <div className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
            <span className="hidden md:flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-sky-400" />
              已持久化 {s ? `${s.counts.blocks.toLocaleString()} 块 / ${s.counts.txs.toLocaleString()} 笔交易` : "…"}
            </span>
            <span className="flex items-center gap-1.5">
              <Radio className={`w-3.5 h-3.5 ${s?.ws.connected ? "text-emerald-400 animate-pulse" : "text-amber-400"}`} />
              {s ? `L2 #${s.counts.latestHeight.toLocaleString()} · ${s.ws.connected ? "WS实时" : "REST回退"}` : "连接节点中…"}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="explorer">
          <TabsList className="bg-zinc-900 border border-zinc-800 flex-wrap h-auto">
            <TabsTrigger value="explorer">区块浏览器</TabsTrigger>
            <TabsTrigger value="book">盘口 / Diff</TabsTrigger>
            <TabsTrigger value="orders">订单流 / 账户</TabsTrigger>
            <TabsTrigger value="twap">TWAP 检测</TabsTrigger>
            <TabsTrigger value="txs">交易流</TabsTrigger>
            <TabsTrigger value="batches">L1 结算批次</TabsTrigger>
            <TabsTrigger value="overview">市场总览</TabsTrigger>
            <TabsTrigger value="markets">市场行情</TabsTrigger>
            <TabsTrigger value="funding">资金费率</TabsTrigger>
            <TabsTrigger value="lit">LIT 链上数据</TabsTrigger>
          </TabsList>
          <div className="mt-5">
            <TabsContent value="explorer"><ExplorerLive /></TabsContent>
            <TabsContent value="book"><OrderBookLive /></TabsContent>
            <TabsContent value="orders"><OrdersLive /></TabsContent>
            <TabsContent value="twap"><TwapLive /></TabsContent>
            <TabsContent value="txs"><TradesLive /></TabsContent>
            <TabsContent value="batches"><BatchesLive /></TabsContent>
            <TabsContent value="overview"><OverviewLive /></TabsContent>
            <TabsContent value="markets"><MarketTableLive /></TabsContent>
            <TabsContent value="funding"><FundingLive /></TabsContent>
            <TabsContent value="lit"><LitLive /></TabsContent>
          </div>
        </Tabs>

        <footer className="mt-10 pt-4 border-t border-zinc-800 text-xs text-zinc-600 space-y-1">
          <p>LighterAnalyzer 轻节点：后台协程持续同步 L2 区块、L1 批次、市场行情与链上事件；WebSocket 实时盘口/账户流经本地代理接入，全部持久化并断点续拉。</p>
          <p>数据不构成投资建议。Lighter 为应用专用 zkRollup，无公开全节点软件；本服务即只读轻节点 + 索引器。</p>
        </footer>
      </main>
    </div>
  );
}
