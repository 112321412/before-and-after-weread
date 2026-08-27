import type { Constraints, GoalType, IntentResult } from "./types.js";

// 规则版意图解析与关键词扩展：mock 模式与 real-未配-LLM（degraded）共用。
// demo 主路径“我想理解组织为什么失灵，但不想读太学术的书”在这里得到确定性结果。
const AMBIGUOUS_PATTERN = /^(这|那)?(本)?(书)?(怎么样|如何|好不好|值得读吗|推荐几本书?|有什么书)[?？。!！]*$/;

const GOAL_KEYWORDS: [GoalType, RegExp][] = [
  ["revisit", /重读|再看一遍|复读|重新读/],
  ["counter_view", /反方|反面|反驳|对立|另一边|唱反调/],
  ["relax", /放松|消遣|轻松|解压|打发时间/],
  ["follow_topic", /跟上|最新|热点|大家都在|刷到|出圈/],
  // “理解 X 为什么/怎么”是带着具体困惑来的（PRD 场景一原例），先于泛“理解/了解”匹配
  ["solve_problem", /理解.{0,10}(为什么|怎么|如何)|想搞明白|解决|怎么办|实操|上手|落地|应用|处理/],
  ["systematic", /系统|入门|了解|搞懂|学习|明白|理解/]
];

const FOLLOWUP_CHIPS = ["解决具体问题", "系统了解一个领域", "找反方观点", "消遣放松", "跟上话题", "重读某本书"];

export function parseIntentRules(input: string): IntentResult {
  const verbatim = input.trim();
  const constraints = parseConstraints(verbatim);

  const bookMatch = verbatim.match(/《(.+?)》/);
  if (bookMatch) {
    return {
      mode: "book",
      goalType: classifyGoal(verbatim),
      topic: bookMatch[1],
      verbatim,
      constraints,
      llm: "rules"
    };
  }

  if (verbatim.length < 6 || AMBIGUOUS_PATTERN.test(verbatim)) {
    return {
      mode: "ambiguous",
      goalType: "solve_problem",
      topic: "",
      verbatim,
      constraints,
      followupChips: FOLLOWUP_CHIPS,
      llm: "rules"
    };
  }

  return {
    mode: "topic",
    goalType: classifyGoal(verbatim),
    topic: extractTopic(verbatim),
    verbatim,
    constraints,
    llm: "rules"
  };
}

function classifyGoal(text: string): GoalType {
  for (const [goal, pattern] of GOAL_KEYWORDS) {
    if (pattern.test(text)) return goal;
  }
  return "solve_problem";
}

// 主题抽取：去掉引导语，截到转折/逗号为止
function extractTopic(text: string): string {
  let topic = text.replace(/^我想(理解|要|搞懂|明白|了解)?/, "").trim();
  topic = topic.split(/，|,|但|不过|可是/)[0].trim();
  topic = topic
    .replace(/为什么/, "")
    .replace(/怎么|如何/, "")
    .trim();
  return topic || text.trim();
}

function parseConstraints(text: string): Constraints {
  const constraints: Constraints = {};
  if (/不想.{0,6}学术|太学术|别太学术/.test(text)) constraints.difficulty = "低学术门槛";
  const weekly = text.match(/每周\s*(\d+(?:\.\d+)?)\s*个?小时/);
  if (weekly) constraints.weeklyHours = Number(weekly[1]);
  const total = text.match(/(?:预算|总共|一共|以内)\s*(\d+(?:\.\d+)?)\s*个?小时|(\d+(?:\.\d+)?)\s*个?小时(?:以内|预算)/);
  if (total) constraints.timeBudgetHours = Number(total[1] ?? total[2]);
  if (/两周内|半个月|这个月|月底|下个月/.test(text)) constraints.deadline = text.match(/两周内|半个月|这个月|月底|下个月/)![0];
  return constraints;
}

// 关键词扩展（规则版）：常用主题的同义/下位词表 + 通用兜底
const KEYWORD_MAP: [RegExp, string[]][] = [
  [/组织|公司|官僚|科层/, ["组织失灵", "组织失效", "大公司病", "官僚制", "流程管理"]],
  [/流程|效率|管理/, ["流程管理", "效率", "管理实操"]],
  [/决策|选择/, ["决策", "慢决策", "选择的心理"]],
  [/城市/, ["城市", "城市的算法"]],
  [/环境|环保/, ["环境史", "环保运动"]],
  [/心理|记忆/, ["记忆", "认知心理"]],
  [/经济/, ["经济学", "迁徙经济学"]]
];

export function expandKeywordsRules(topic: string): string[] {
  for (const [pattern, keywords] of KEYWORD_MAP) {
    if (pattern.test(topic)) return keywords;
  }
  return [topic, `${topic}入门`, `${topic}实践`];
}
