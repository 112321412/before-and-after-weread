// OpenAI 兼容的 LLM 适配器。
// 三态：
// - real：WEREAD_MODE=real 且 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL 配置齐全 → 真调用
// - degraded：real 模式但未配 LLM → 决策引擎退回规则判定（卡上明示），本模块不发起请求
// - mock：WEREAD_MODE=mock → 决策引擎直接用确定性 fixture，同样不经过这里
export type LlmState = "real" | "degraded";

export function llmState(): LlmState {
  const configured = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
  if (process.env.WEREAD_MODE === "real" && configured) return "real";
  return "degraded";
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

async function callOnce(system: string, user: string): Promise<string> {
  const baseUrl = process.env.LLM_BASE_URL!.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.4,
      response_format: { type: "json_object" }
    })
  });
  if (!res.ok) throw new Error(`LLM 请求失败：HTTP ${res.status} ${await res.text()}`.slice(0, 300));
  const body = (await res.json()) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 返回为空");
  return content;
}

// JSON 输出：优先 response_format，解析失败或请求失败重试 1 次，再失败抛到统一错误中间件
export async function generateJSON<T>(system: string, user: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await callOnce(system, user);
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("LLM 输出中未找到 JSON");
      return JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM 调用失败");
}
