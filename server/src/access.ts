import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const accessTokens = new Map<string, number>();

export function isAccessRequired(): boolean {
  return Boolean(process.env.WEREAD_ACCESS_PASSWORD);
}

function passwordMatches(password: string): boolean {
  const expected = Buffer.from(process.env.WEREAD_ACCESS_PASSWORD ?? "", "utf8");
  const actual = Buffer.from(password, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function pruneExpiredTokens(now: number): void {
  for (const [token, expiresAt] of accessTokens) {
    if (expiresAt <= now) accessTokens.delete(token);
  }
}

export function issueAccessToken(password: string): string | null {
  if (!isAccessRequired() || !passwordMatches(password)) return null;
  const now = Date.now();
  pruneExpiredTokens(now);
  const token = randomUUID();
  accessTokens.set(token, now + ACCESS_TOKEN_TTL_MS);
  return token;
}

export function isAccessTokenValid(token: string | null | undefined): boolean {
  if (!isAccessRequired() || !token) return false;
  const expiresAt = accessTokens.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    accessTokens.delete(token);
    return false;
  }
  return true;
}

export function requireAccess(req: Request, res: Response, next: NextFunction): void {
  if (!isAccessRequired()) {
    next();
    return;
  }
  const token = req.header("x-access-token");
  if (!token) {
    res.status(401).json({ code: "ACCESS_REQUIRED", error: "需要访问口令" });
    return;
  }
  if (!isAccessTokenValid(token)) {
    res.status(403).json({ code: "ACCESS_EXPIRED", error: "访问口令已失效，请重新输入" });
    return;
  }
  next();
}
