import type { NextFunction, Request, Response } from "express";
import type { Session } from "./sync.js";

// 会话存取与鉴权中间件：key 封闭在 Session.gateway 内，仅存内存
export const sessions = new Map<string, Session>();

export interface AuthedRequest extends Request {
  session: Session;
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = sessions.get(req.header("x-sid") ?? "");
  if (!session) {
    res.status(401).json({ error: "会话已失效，请重新配置 Key" });
    return;
  }
  (req as AuthedRequest).session = session;
  next();
}
