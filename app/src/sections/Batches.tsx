import type { Batch } from "@/types/explorer";
import { ShieldCheck, Shield, ShieldQuestion } from "lucide-react";

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; cls: string; icon: typeof ShieldCheck }> = {
    executed: { label: "已执行", cls: "bg-emerald-500/15 text-emerald-300", icon: ShieldCheck },
    nothing_to_execute: { label: "已验证", cls: "bg-sky-500/15 text-sky-300", icon: ShieldCheck },
    committed: { label: "已提交 L1", cls: "bg-amber-500/15 text-amber-300", icon: Shield },
  };
  const s = status ? map[status] : undefined;
  const Icon = s?.icon ?? ShieldQuestion;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${s?.cls ?? "bg-zinc-700/40 text-zinc-400"}`}>
      <Icon className="w-3 h-3" />{s?.label ?? "打包中"}
    </span>
  );
}

function L1Link({ hash, label }: { hash?: string | null; label: string }) {
  if (!hash) return <span className="text-zinc-600">—</span>;
  return (
    <a className="font-mono text-emerald-400 hover:underline" target="_blank" rel="noreferrer"
      href={`https://etherscan.io/tx/${hash}`} title={hash}>
      {label} {hash.slice(0, 8)}…{hash.slice(-4)}
    </a>
  );
}

export function Batches({ batches }: { batches: Batch[] }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Lighter 将 L2 区块打包为批次（batch）提交到以太坊主网：先在 L1 提交（commit）状态承诺，随后用 ZK 证明验证（verify），最后执行（execute）优先队列操作。以下哈希均可点击跳转 Etherscan 验证。
      </p>
      <div className="rounded-lg border border-zinc-800 overflow-auto max-h-[560px]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">批次号</th>
              <th className="px-3 py-2 text-left">时间 (UTC)</th>
              <th className="px-3 py-2 text-right">大小</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">L1 提交交易</th>
              <th className="px-3 py-2 text-left">L1 验证交易 (ZK证明)</th>
              <th className="px-3 py-2 text-left">L1 执行交易</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.n} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                <td className="px-3 py-2 font-mono text-zinc-100">#{b.n.toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-400 text-xs">{b.time.replace("T", " ").replace("Z", "")}</td>
                <td className="px-3 py-2 text-right font-mono text-zinc-300">{b.size.toLocaleString()}</td>
                <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                <td className="px-3 py-2 text-xs"><L1Link hash={b.commit} label="commit" /></td>
                <td className="px-3 py-2 text-xs"><L1Link hash={b.verify} label="verify" /></td>
                <td className="px-3 py-2 text-xs"><L1Link hash={b.execute} label="execute" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
