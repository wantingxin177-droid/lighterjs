// 本地 SOCKS5 代理运行时装配器。
// 优先使用 LIGHTER_SOCKS_PROXY；否则启动 .runtime 中的用户态 Xray（无需 root / TUN）。
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, copyFileSync, chmodSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";

const LOCAL_SOCKS = "socks5h://127.0.0.1:10808";
let child: ChildProcess | null = null;
let starting: Promise<string | null> | null = null;

function portOpen(port: number, host = "127.0.0.1", timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ host, port });
    const done = (ok: boolean) => {
      s.removeAllListeners();
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startBundledXray(): Promise<string | null> {
  const runtimeDir = path.join(process.cwd(), ".runtime");
  const bundledBin = path.join(runtimeDir, "xray");
  const config = path.join(runtimeDir, "xray-config.json");
  if (!existsSync(bundledBin) || !existsSync(config)) return null;

  // /mnt/agents 不支持 exec bit；复制到 /tmp 后赋可执行权限。
  const bin = "/tmp/lighteranalyzer-xray";
  copyFileSync(bundledBin, bin);
  chmodSync(bin, 0o755);

  child = spawn(bin, ["-config", config], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (d) => console.warn("[proxy]", String(d).trim().slice(0, 300)));
  child.on("exit", (code) => {
    console.warn(`[proxy] xray exited (${code})`);
    child = null;
  });

  for (let i = 0; i < 20; i++) {
    if (await portOpen(10808)) return LOCAL_SOCKS;
    await wait(250);
  }
  return null;
}

export async function ensureSocksProxy(): Promise<string | null> {
  const configured = process.env.LIGHTER_SOCKS_PROXY?.trim();
  if (configured) return configured;
  if (await portOpen(10808)) return LOCAL_SOCKS;
  if (!starting) {
    starting = startBundledXray().finally(() => { starting = null; });
  }
  return starting;
}

export async function getSocksProxyUrl(): Promise<string | null> {
  const configured = process.env.LIGHTER_SOCKS_PROXY?.trim();
  if (configured) return configured;
  if (await portOpen(10808)) return LOCAL_SOCKS;
  return ensureSocksProxy();
}
