// F1.4 硬闸门：规则做上下限，LLM（或规则裁量）只在闸门允许的集合内选 verdict。
// 每条命中都写入 gatesHit，供决策档案回测（闸门错改规则，裁量错调 prompt）。
export interface GateInput {
  matchScore: number; // 1-5
  mismatch: boolean; // 内容与目标严重错配
  estimatedHours: number;
  timeBudgetHours: number; // 窗口总预算（默认每周 3h × 3 周 = 9h）
  duplicationHigh: boolean; // 与书架在读书/已读书主题高度重复
  themeNegativeMajor: boolean; // 存在主题级负面
}

export interface GateResult {
  allowed: ("read_now" | "shelve" | "skip")[];
  floorReadNow: boolean;
  gatesHit: string[];
}

export function applyGates(input: GateInput): GateResult {
  const gatesHit: string[] = [];
  let capped = false;

  if (input.mismatch) {
    capped = true;
    gatesHit.push(`内容与目标错配（匹配 ${input.matchScore}/5）→ 上限「放入待读」`);
  }
  if (input.estimatedHours > 3 * input.timeBudgetHours) {
    capped = true;
    gatesHit.push(
      `预计 ${input.estimatedHours.toFixed(1)} 小时，超过时间预算（${input.timeBudgetHours}h）3 倍 → 上限「放入待读」`
    );
  }
  if (input.duplicationHigh) {
    capped = true;
    gatesHit.push("与书架上同主题在读/已读书重复度高 → 上限「放入待读」");
  }

  // “成本合预算”允许约半程上浮（默认 3 周 9h 的窗口，读到第 4-5 周仍算合预算）。
  // 硬闸门是绝对上限：任何封顶命中时保底不再解锁 read_now
  const floorReadNow =
    !capped && input.matchScore >= 4 && input.estimatedHours <= input.timeBudgetHours * 1.5 && !input.themeNegativeMajor;
  if (floorReadNow) {
    gatesHit.push("匹配 ≥4、成本接近预算、无主题级负面 → 保底「现在读」");
  }

  const allowed: GateResult["allowed"] = capped ? ["shelve", "skip"] : ["read_now", "shelve", "skip"];
  return { allowed, floorReadNow, gatesHit };
}

// 规则裁量（mock 模式与 degraded 共用）：闸门内按确定性策略选 verdict。
// 重复 + 主题级负面 → 排除；保底 → 现在读；其余 → 放入待读。
export function ruleVerdict(
  gates: GateResult,
  context: { duplicationHigh: boolean; themeNegativeMajor: boolean; estimatedHours: number }
): { action: "read_now" | "shelve" | "skip"; oneLiner: string; shelveTrigger: string | null } {
  if (gates.floorReadNow) {
    return { action: "read_now", oneLiner: "匹配你的目标且成本可控，现在读收益最大", shelveTrigger: null };
  }
  if (context.duplicationHigh && context.themeNegativeMajor && gates.allowed.includes("skip")) {
    return { action: "skip", oneLiner: "与你在读的书重复，且口碑存在主题级硬伤", shelveTrigger: null };
  }
  const trigger =
    context.estimatedHours > 8 ? "时间宽裕、想要体系梳理时" : "读完手头同主题的书之后";
  return { action: "shelve", oneLiner: "此刻不是读它的最佳时机，先放入待读", shelveTrigger: trigger };
}
