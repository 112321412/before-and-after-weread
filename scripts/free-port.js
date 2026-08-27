// dev 工具：启动前清掉占住端口的残留 node 进程（Windows 上 tsx watch 异常退出时端口不释放）。
// 只杀监听目标端口的 node.exe，其他进程不碰。
import { execSync } from "node:child_process";

const port = process.argv[2];
if (!port) {
  console.error("用法: node scripts/free-port.js <port>");
  process.exit(1);
}

let lines;
try {
  lines = execSync(`netstat -ano`, { encoding: "utf8" }).split("\n");
} catch {
  process.exit(0);
}

const pids = new Set();
for (const line of lines) {
  if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
  const pid = line.trim().split(/\s+/).pop();
  if (pid && /^\d+$/.test(pid)) pids.add(pid);
}

for (const pid of pids) {
  try {
    const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8" });
    if (!info.toLowerCase().includes("node.exe")) continue;
    execSync(`taskkill /PID ${pid} /F`, { encoding: "utf8" });
    console.log(`[free-port] 已清理端口 ${port} 上的残留进程 ${pid}`);
  } catch {
    // 进程已自行退出
  }
}
