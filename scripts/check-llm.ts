import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { generateJSON, llmState } from "../server/src/llm.js";

const syntheticApiKey = "local-test-only-llm-key";
const syntheticUpstreamBody = "synthetic-upstream-body-must-not-leak";
const previousEnv = new Map(
  ["WEREAD_MODE", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].map((name) => [name, process.env[name]])
);

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server did not expose a port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

let server: Server | undefined;

try {
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  process.env.WEREAD_MODE = "real";
  assert.equal(llmState(), "degraded", "缺少 LLM 配置时应保持 degraded");

  let requestCount = 0;
  let alwaysFail = false;
  let authorization: string | undefined;
  server = createServer((request, response) => {
    requestCount += 1;
    authorization = request.headers.authorization;
    if (alwaysFail) {
      response.statusCode = 502;
      response.end(JSON.stringify({ error: syntheticUpstreamBody }));
      return;
    }
    if (requestCount === 1) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: syntheticUpstreamBody }));
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }] }));
  });
  const port = await listen(server);
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.LLM_API_KEY = syntheticApiKey;
  process.env.LLM_MODEL = "local-test-model";
  assert.equal(llmState(), "real", "配置齐全时应进入 real");

  const parsed = await generateJSON<{ ok: boolean }>("system", "user");
  assert.deepEqual(parsed, { ok: true }, "应解析兼容接口返回的 JSON 内容");
  assert.equal(requestCount, 2, "一次上游失败后应自动重试一次");
  assert.equal(authorization, `Bearer ${syntheticApiKey}`, "Authorization 只在测试进程内按预期发送");

  requestCount = 0;
  alwaysFail = true;
  await assert.rejects(
    () => generateJSON("system", "user"),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message, "LLM 请求失败：HTTP 502");
      assert.equal(error.message.includes(syntheticUpstreamBody), false);
      assert.equal(error.message.includes(syntheticApiKey), false);
      return true;
    }
  );
  assert.equal(requestCount, 2, "最终失败也应只重试一次");

  console.log("llm checks passed");
} finally {
  if (server?.listening) await close(server);
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
