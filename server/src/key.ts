import { createHash } from "node:crypto";

export function isWeReadKey(value: string): boolean {
  return Boolean(value.trim());
}

// 仅作为本地表的稳定命名空间；原始 Key 不落盘、不进入响应或日志。
export function accountVidFromKey(value: string): string {
  return `account-${createHash("sha256").update(value).digest("hex")}`;
}
