import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { isAccessRequired, isAccessTokenValid, issueAccessToken, requireAccess } from "../server/src/access.js";
import { isAccessErrorCode, isAccessGateFailure } from "../web/src/api.js";

const PASSWORD = "synthetic-access-password";
const previousPassword = process.env.WEREAD_ACCESS_PASSWORD;

function callMiddleware(token?: string): { next: boolean; status: number; body: unknown } {
  let nextCalled = false;
  let status = 0;
  let body: unknown;
  const req = { header: () => token } as unknown as Request;
  const res = {
    status: (code: number) => {
      status = code;
      return res;
    },
    json: (value: unknown) => {
      body = value;
      return res;
    }
  } as unknown as Response;
  requireAccess(req, res, () => {
    nextCalled = true;
  });
  return { next: nextCalled, status, body };
}

try {
  delete process.env.WEREAD_ACCESS_PASSWORD;
  assert.equal(isAccessRequired(), false, "未配置访问口令时不应增加门槛");
  assert.equal(callMiddleware().next, true, "未配置访问口令时业务请求应放行");

  process.env.WEREAD_ACCESS_PASSWORD = PASSWORD;
  assert.equal(isAccessRequired(), true);
  assert.equal(issueAccessToken("wrong-password"), null, "错误口令不得换取 token");
  const firstToken = issueAccessToken(PASSWORD);
  const secondToken = issueAccessToken(PASSWORD);
  assert.ok(firstToken && secondToken, "正确口令应换取内存 token");
  assert.notEqual(firstToken, secondToken, "每次换取的 token 应随机且相互隔离");
  assert.equal(isAccessTokenValid(firstToken), true);
  assert.equal(isAccessTokenValid(secondToken), true);
  assert.equal(isAccessTokenValid("unknown-token"), false);
  assert.doesNotMatch(firstToken, new RegExp(PASSWORD));
  assert.doesNotMatch(JSON.stringify({ error: "访问口令错误" }), new RegExp(PASSWORD));

  const missingToken = callMiddleware();
  assert.equal(missingToken.status, 401, "缺少 token 应拒绝业务请求");
  assert.deepEqual(missingToken.body, { code: "ACCESS_REQUIRED", error: "需要访问口令" });
  assert.equal(isAccessGateFailure(missingToken.status, (missingToken.body as { code: string }).code), true);
  const wrongToken = callMiddleware("wrong-token");
  assert.equal(wrongToken.status, 403, "错误 token 应拒绝业务请求");
  assert.deepEqual(wrongToken.body, { code: "ACCESS_EXPIRED", error: "访问口令已失效，请重新输入" });
  assert.equal(isAccessGateFailure(wrongToken.status, (wrongToken.body as { code: string }).code), true);
  assert.equal(isAccessGateFailure(401), false, "普通 session 401 不应打开访问口令门");
  assert.equal(isAccessGateFailure(403), false, "普通网关 403 不应打开访问口令门");
  assert.equal(isAccessErrorCode("ACCESS_REQUIRED"), true);
  assert.equal(isAccessErrorCode("ACCESS_EXPIRED"), true);
  assert.equal(isAccessErrorCode("SESSION_INVALID"), false);
  assert.equal(callMiddleware(firstToken).next, true, "正确 token 应放行业务请求");

  delete process.env.WEREAD_ACCESS_PASSWORD;
  assert.equal(isAccessTokenValid(firstToken), false, "取消配置后旧 token 不应继续生效");
  console.log("access checks passed");
} finally {
  if (previousPassword === undefined) delete process.env.WEREAD_ACCESS_PASSWORD;
  else process.env.WEREAD_ACCESS_PASSWORD = previousPassword;
}
