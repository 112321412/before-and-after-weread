import assert from "node:assert/strict";
import { createGateway, GatewayHttpError } from "../server/src/gateway.js";

const authMessage = "Key 无效、过期或权限不匹配，请重新生成";
const testKey = "synthetic-test-key";
const originalFetch = globalThis.fetch;

try {
  for (const statusCode of [401, 403]) {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: `upstream-body-${testKey}` }), {
        status: statusCode,
        headers: { "Content-Type": "application/json" }
      });

    await assert.rejects(
      () => createGateway(testKey).callGateway("/user/notebooks"),
      (error: unknown) => {
        assert.ok(error instanceof GatewayHttpError);
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.message, authMessage);
        assert.ok(!error.message.includes(testKey));
        assert.doesNotMatch(error.message, /Authorization|Bearer|upstream-body/);
        return true;
      }
    );
  }

  globalThis.fetch = async () => new Response("upstream-body", { status: 429 });
  await assert.rejects(
    () => createGateway(testKey).callGateway("/user/notebooks"),
    (error: unknown) => {
      assert.ok(error instanceof GatewayHttpError);
      assert.equal(error.statusCode, 429);
      assert.equal(error.message, "网关请求失败：HTTP 429");
      assert.ok(!error.message.includes(testKey));
      assert.doesNotMatch(error.message, /Authorization|Bearer|upstream-body/);
      return true;
    }
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ errcode: 123, errmsg: `upstream-body-${testKey}` }), { status: 200 });
  await assert.rejects(
    () => createGateway(testKey).callGateway("/user/notebooks"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "网关返回错误：123");
      assert.ok(!error.message.includes(testKey));
      assert.doesNotMatch(error.message, /Authorization|Bearer|upstream-body/);
      return true;
    }
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("gateway auth error checks passed");
