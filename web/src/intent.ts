import type { IntentResult } from "./types";

const CHIP_GOALS: Record<string, IntentResult["goalType"]> = {
  解决具体问题: "solve_problem",
  系统了解一个领域: "systematic",
  找反方观点: "counter_view",
  消遣放松: "relax",
  跟上话题: "follow_topic",
  重读某本书: "revisit"
};

export function resolveFollowupIntent(parsed: IntentResult, previous: IntentResult, chip: string): IntentResult {
  if (parsed.mode !== "ambiguous") return parsed;
  return {
    ...parsed,
    mode: "topic",
    goalType: CHIP_GOALS[chip] ?? previous.goalType,
    topic: parsed.topic || previous.topic || previous.verbatim,
    followupChips: undefined
  };
}
