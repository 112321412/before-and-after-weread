import { useEffect, useState } from "react";
import { api } from "../api";
import { toast } from "../components/Toast";
import { resolveFollowupIntent } from "../intent";
import {
  GOAL_LABELS,
  type Candidate,
  type CandidatesResult,
  type DecisionCard,
  type DecisionHistoryItem,
  type IntentResult,
  type Quote,
  type ThemeBlock
} from "../types";

const VERDICT_LABELS: Record<string, string> = { read_now: "现在读", shelve: "放入待读", skip: "排除" };
const EXAMPLE_INPUT = "我想理解组织为什么失灵，但不想读太学术的书";
const MAX_DECISION_CANDIDATES = 3;

type Stage = "input" | "chips" | "candidates" | "generating" | "cards";

export function DecidePage() {
  const [stage, setStage] = useState<Stage>("input");
  const [input, setInput] = useState("");
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [candidates, setCandidates] = useState<CandidatesResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<DecisionCard[]>([]);
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<DecisionHistoryItem[]>([]);

  function refreshHistory() {
    api.decisionHistory().then((result) => setHistory(result.decisions)).catch(() => undefined);
  }

  async function rejudge(item: DecisionHistoryItem, action: "read_now" | "shelve" | "skip") {
    try {
      await api.rejudgeDecision({
        recordId: item.id,
        action,
        trigger: action === "shelve" ? item.trigger ?? "时间宽裕时再读" : undefined
      });
      refreshHistory();
      toast(`已追加改判：${item.title} · ${VERDICT_LABELS[action]}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "改判失败");
    }
  }

  useEffect(() => {
    refreshHistory();
  }, [stage]);

  async function runIntent(text: string, followup?: { previous: IntentResult; chip: string }) {
    setBusy(true);
    try {
      const parsed = await api.decideIntent(text);
      const result = followup ? resolveFollowupIntent(parsed, followup.previous, followup.chip) : parsed;
      setIntent(result);
      if (result.mode === "ambiguous") {
        setStage("chips");
        return;
      }
      if (result.mode === "book" && result.resolvedBookId) {
        await generateCards([result.resolvedBookId]);
        return;
      }
      await loadCandidates(result, 0);
    } catch (err) {
      toast(err instanceof Error ? err.message : "意图解析失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates(currentIntent: IntentResult, offset: number) {
    setBusy(true);
    try {
      const result = await api.decideCandidates(currentIntent, offset);
      setCandidates(result);
      setSelected(new Set(result.preselected));
      setStage("candidates");
    } catch (err) {
      toast(err instanceof Error ? err.message : "候选生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function generateCards(bookIds: string[]) {
    setBusy(true);
    setGenerateProgress({ current: 0, total: bookIds.length });
    setStage("generating");
    const generated: DecisionCard[] = [];
    try {
      for (const bookId of bookIds) {
        const card = await api.decideCard(bookId, intent!, bookIds);
        generated.push(card);
        setGenerateProgress({ current: generated.length, total: bookIds.length });
      }
      setCards(generated);
      setStage("cards");
    } catch (err) {
      toast(err instanceof Error ? err.message : "决策卡生成失败");
      if (generated.length > 0) {
        setCards(generated);
        setStage("cards");
      } else {
        setStage("candidates");
      }
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStage("input");
    setIntent(null);
    setCandidates(null);
    setCards([]);
  }

  return (
    <div className="decide-page">
      <header className="decide-header">
        <h1>选书决策</h1>
        <p className="decide-lede">
          一句话进，可解释的「读 / 不读」出——判定附证据，动作留档。
          {intent && (
            <span className="decide-goal-tag">
              目标：{GOAL_LABELS[intent.goalType]} · {intent.topic}
            </span>
          )}
        </p>
      </header>

      {stage === "input" && (
        <form
          className="decide-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (input.trim()) runIntent(input.trim());
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`例如：${EXAMPLE_INPUT}`}
          />
          <button type="submit" disabled={busy || input.trim() === ""}>
            {busy ? "解析中…" : "开始"}
          </button>
          <button type="button" className="decide-example" onClick={() => setInput(EXAMPLE_INPUT)}>
            用示例试一试
          </button>
        </form>
      )}

      {stage === "chips" && intent && (
        <div className="decide-chips">
          <p>你想做的是哪一种？（选一个，只问这一轮）</p>
          <div className="chip-row">
            {intent.followupChips?.map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip"
                onClick={() => runIntent(`${intent.verbatim}，${chip}`, { previous: intent, chip })}
              >
                {chip}
              </button>
            ))}
          </div>
          <button type="button" className="decide-link-btn" onClick={restart}>
            换个说法
          </button>
        </div>
      )}

      {stage === "candidates" && candidates && (
        <CandidateStep
          result={candidates}
          selected={selected}
          onToggle={(bookId) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(bookId)) next.delete(bookId);
              else if (next.size < MAX_DECISION_CANDIDATES) next.add(bookId);
              return next;
            })
          }
          onRefresh={() => loadCandidates(intent!, candidates.offset + 1)}
          onBack={restart}
          onConfirm={() => generateCards([...selected])}
          busy={busy}
        />
      )}

      {stage === "generating" && (
        <div className="decide-generating">
          <p>
            正在生成决策卡 {generateProgress.current} / {generateProgress.total}
          </p>
          <p className="decide-sub">拉取书评三档、归纳主题、跑判定闸门…</p>
        </div>
      )}

      {stage === "cards" && (
        <>
          <div className="decide-cards">
            {cards.map((card) => (
              <DecisionCardView key={card.cardId} card={card} onActed={refreshHistory} />
            ))}
          </div>
          <CompareRow cards={cards} />
          <div className="decide-restart">
            <button type="button" onClick={restart}>
              重新开始一轮
            </button>
          </div>
        </>
      )}

      <section className="decide-history">
        <h2>决策档案</h2>
        {history.length === 0 ? (
          <p className="decide-history-empty">还没有决策记录。每次「现在读 / 放入待读 / 排除」都会归档在这里，供回测判定准确率。</p>
        ) : (
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <span className={`verdict verdict-${item.verdict}`}>{VERDICT_LABELS[item.verdict] ?? item.verdict}</span>
                <span className="history-topic">{item.title || item.topic || "未命名书目"}</span>
                <span className="history-action">你的动作：{item.action ? VERDICT_LABELS[item.action] ?? item.action : "未记录"}</span>
                {item.trigger && <span className="history-action">触发条件：{item.trigger}</span>}
                <span className="history-date">{formatDate(item.createdAt)}</span>
                <span className="history-actions">
                  {(["read_now", "shelve", "skip"] as const)
                    .filter((action) => action !== item.action)
                    .map((action) => (
                      <button key={action} type="button" onClick={() => rejudge(item, action)}>
                        改为{VERDICT_LABELS[action]}
                      </button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CandidateStep({
  result,
  selected,
  onToggle,
  onRefresh,
  onBack,
  onConfirm,
  busy
}: {
  result: CandidatesResult;
  selected: Set<string>;
  onToggle: (bookId: string) => void;
  onRefresh: () => void;
  onBack: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="decide-candidates">
      <p className="candidates-meta">
        搜索词：{result.keywords.join("、")}　·　已按评分人数与已读去重过滤 {result.filteredCount} 本　·　圈选 1-3 本
        {selected.size >= MAX_DECISION_CANDIDATES && <span>　已达上限，最多选择 3 本</span>}
      </p>
      <div className="candidate-grid">
        {result.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.bookId}
            candidate={candidate}
            checked={selected.has(candidate.bookId)}
            onToggle={() => onToggle(candidate.bookId)}
            disabled={!selected.has(candidate.bookId) && selected.size >= MAX_DECISION_CANDIDATES}
          />
        ))}
      </div>
      <div className="candidate-actions">
        <button type="button" className="primary" disabled={busy || selected.size === 0} onClick={onConfirm}>
          {busy ? "生成中…" : `生成决策卡（${selected.size} 本）`}
        </button>
        <button type="button" onClick={onRefresh} disabled={busy || !result.hasMore}>
          换一批
        </button>
        <button type="button" onClick={onBack} disabled={busy}>
          换个说法
        </button>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  checked,
  onToggle,
  disabled
}: {
  candidate: Candidate;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={`candidate-card${checked ? " checked" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      title={disabled ? "最多选择 3 本候选" : undefined}
    >
      <div className="candidate-title-row">
        <strong>{candidate.title}</strong>
        <span className="candidate-rating">
          {candidate.rating > 0 ? `${candidate.rating}%` : "暂无评分"}
        </span>
      </div>
      <p className="candidate-intro">{candidate.intro}</p>
      <div className="candidate-foot">
        <span className="candidate-source">{candidate.source === "similar" ? "相似推荐" : "搜索"}</span>
        {candidate.ratingCount > 0 && <span>{candidate.ratingCount} 人评分</span>}
        {candidate.dupNote && <span className="candidate-dup">{candidate.dupNote}</span>}
      </div>
    </button>
  );
}

function DecisionCardView({ card, onActed }: { card: DecisionCard; onActed: () => void }) {
  const [acted, setActed] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [reason, setReason] = useState("");

  async function act(action: "read_now" | "shelve" | "skip") {
    if (action === "read_now") {
      if (card.book.deepLink) window.open(card.book.deepLink, "_blank", "noopener");
      else toast("演示书目无 deepLink，真实模式会跳转微信读书开始阅读");
    }
    try {
      await api.postDecision({
        cardId: card.cardId,
        action,
        trigger: action === "shelve" && trigger.trim() ? trigger.trim() : undefined,
        reason: action === "skip" && reason.trim() ? reason.trim() : undefined
      });
      setActed(action);
      onActed();
      toast(`已归档：${card.book.title} · ${VERDICT_LABELS[action]}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "归档失败");
    }
  }

  const majorDivergence =
    card.reviewDivergence.controversy ??
    (card.reviewDivergence.negativeThemes[0]
      ? `差评集中谈「${card.reviewDivergence.negativeThemes[0].theme}」`
      : "无主题级分歧");

  return (
    <article className={`decision-card verdict-${card.verdict.action}`}>
      <header className="dc-header">
        <div className="dc-title-row">
          <h3>{card.book.title}</h3>
          <span className={`verdict verdict-${card.verdict.action}`}>{VERDICT_LABELS[card.verdict.action]}</span>
        </div>
        <p className="dc-one-liner">{card.verdict.oneLiner}</p>
        <div className="dc-trio">
          <div>
            <span className="dc-trio-label">预计时长</span>
            <strong>{estimatedHoursLabel(card.readingCost.estimatedHours)}</strong>
            <span className="dc-trio-sub">{card.readingCost.calendarEstimate}</span>
          </div>
          <div>
            <span className="dc-trio-label">最大分歧</span>
            <strong className="dc-divergence">{majorDivergence}</strong>
            <span className="dc-trio-sub">
              置信 {confidenceLabel(card.verdict.confidence)}
              {card.llm === "rules" && " · 未接入 LLM，判定仅含闸门规则"}
            </span>
          </div>
        </div>
        {card.verdict.action === "shelve" && card.verdict.shelveTrigger && (
          <p className="dc-trigger">触发条件：{card.verdict.shelveTrigger}</p>
        )}
      </header>

      <details className="dc-block" open>
        <summary>内容匹配 {card.contentMatch.matchScore}/5</summary>
        <div className="dc-body">
          <p>{card.contentMatch.coreQuestion}</p>
          <p className="dc-meta">论证方式：{card.contentMatch.argumentStyle}　·　{card.contentMatch.styleEvidence}</p>
          {card.contentMatch.mismatchWarning && <p className="dc-warning">错配警告：{card.contentMatch.mismatchWarning}</p>}
        </div>
      </details>

      <details className="dc-block">
        <summary>评论分歧 · {card.book.rating}%（{formatCount(card.book.ratingCount)} 人评分）</summary>
        <div className="dc-body">
          {card.reviewDivergence.snapshotDate && (
            <p className="dc-meta">书评快照于 {formatSnapshotDate(card.reviewDivergence.snapshotDate)}</p>
          )}
          {card.reviewDivergence.deepVRecommend && <p className="dc-meta">资深会员推荐率 {card.reviewDivergence.deepVRecommend}</p>}
          <ThemeList label="好评主题" themes={card.reviewDivergence.positiveThemes} />
          <ThemeList label="差评主题" themes={card.reviewDivergence.negativeThemes} negative />
          {card.reviewDivergence.singles.length > 0 && (
            <div className="dc-singles">
              <span className="dc-meta">个别提及（不足成主题）：</span>
              {card.reviewDivergence.singles.map((quote, index) => (
                <QuoteView key={index} quote={quote} />
              ))}
            </div>
          )}
        </div>
      </details>

      <details className="dc-block">
        <summary>个人关联</summary>
        <div className="dc-body">
          {card.personalLink.alreadyIn && <p className="dc-recall">{card.personalLink.alreadyIn}</p>}
          {card.personalLink.authorHistory && <p>{card.personalLink.authorHistory}</p>}
          {card.personalLink.relations.map((relation) => (
            <p key={relation.book}>
              <span className={`relation relation-${relation.type}`}>{relation.type}</span>《{relation.book}》 — {relation.note}
            </p>
          ))}
          {card.personalLink.relations.length === 0 && !card.personalLink.alreadyIn && !card.personalLink.authorHistory && (
            <p className="dc-meta">书架中暂无同主题已读书，无个人关联信号。</p>
          )}
        </div>
      </details>

      <details className="dc-block">
        <summary>阅读成本</summary>
        <div className="dc-body">
          <p>
            {estimatedHoursLabel(card.readingCost.estimatedHours)}（{card.readingCost.speedBasis === "own" ? "按你自己的速度" : "按群体均值估算"}） · {card.readingCost.calendarEstimate}
          </p>
          {card.readingCost.wordCountSource === "chapters" && <p className="dc-meta">书目信息缺字数，已按章节字数回退。</p>}
          {card.readingCost.wordCountSource === "unknown" && <p className="dc-warning">暂无有效字数，预计时长待校准。</p>}
          <p>{card.readingCost.difficulty}</p>
          {card.readingCost.versionNote && <p className="dc-warning">{card.readingCost.versionNote}</p>}
        </div>
      </details>

      {card.contentSample.bookmarks.length > 0 && (
        <details className="dc-block">
          <summary>内容样本（热门划线）</summary>
          <div className="dc-body">
            {card.contentSample.note && <p className="dc-meta">{card.contentSample.note}</p>}
            {card.contentSample.bookmarks.map((bookmark, index) =>
              bookmark.kind === "结论" ? (
                <details key={index} className="dc-foldable-mark">
                  <summary>结论型划线（{bookmark.totalCount} 人划线）— 默认折叠防剧透</summary>
                  <QuoteView quote={{ text: bookmark.text, star: 0, isFinish: false, highWeight: false }} />
                </details>
              ) : (
                <QuoteView key={index} quote={{ text: bookmark.text, star: 0, isFinish: false, highWeight: false }} />
              )
            )}
          </div>
        </details>
      )}
      {card.contentSample.bookmarksHidden && card.contentSample.note && (
        <p className="dc-spoiler-note">{card.contentSample.note}</p>
      )}

      {card.alternative.length > 0 && (
        <details className="dc-block">
          <summary>替代方案</summary>
          <div className="dc-body">
            {card.alternative.map((option) => (
              <p key={option.title}>
                《{option.title}》 — {option.why}
              </p>
            ))}
          </div>
        </details>
      )}

      <details className="dc-block">
        <summary>判定依据（闸门）</summary>
        <div className="dc-body">
          {card.gatesHit.length === 0 && <p className="dc-meta">未命中硬闸门，判定来自闸门内的综合裁量。</p>}
          {card.gatesHit.map((gate) => (
            <p key={gate} className="dc-gate">
              {gate}
            </p>
          ))}
        </div>
      </details>

      {card.openQuestions.length > 0 && (
        <div className="dc-open-questions">
          <strong>存疑区</strong>
          {card.openQuestions.map((question) => (
            <p key={question}>{question}</p>
          ))}
        </div>
      )}

      <footer className="dc-actions">
        <button type="button" className="act-read_now" disabled={acted !== null} onClick={() => act("read_now")}>
          现在读
        </button>
        <button type="button" className="act-shelve" disabled={acted !== null} onClick={() => act("shelve")}>
          放入待读
        </button>
        <button type="button" className="act-skip" disabled={acted !== null} onClick={() => act("skip")}>
          排除
        </button>
      </footer>
      {acted === null && (
        <div className="dc-action-inputs">
          <input value={trigger} onChange={(event) => setTrigger(event.target.value)} placeholder="放入待读的触发条件（可选），如：读完《制度的心跳》后" />
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="排除理由（可选，一句话）" />
        </div>
      )}
      {acted !== null && <p className="dc-acted">已归档：{VERDICT_LABELS[acted]}</p>}
    </article>
  );
}

function ThemeList({ label, themes, negative = false }: { label: string; themes: ThemeBlock[]; negative?: boolean }) {
  if (themes.length === 0) return <p className="dc-meta">{label}：样本不足以归纳主题。</p>;
  return (
    <div className={`dc-themes${negative ? " negative" : ""}`}>
      <span className="dc-meta">{label}</span>
      {themes.map((theme) => (
        <details key={theme.theme} className="dc-theme">
          <summary>
            「{theme.theme}」 <span className="dc-theme-count">{theme.display}</span>
          </summary>
          {theme.quotes.map((quote, index) => (
            <QuoteView key={index} quote={quote} />
          ))}
        </details>
      ))}
    </div>
  );
}

function QuoteView({ quote }: { quote: Quote }) {
  return (
    <blockquote className="evidence-quote">
      <p>{quote.text}</p>
      {quote.star > 0 && (
        <footer>
          {"★".repeat(quote.star / 20)}
          {quote.isFinish && <span className="quote-finish">读完</span>}
          {quote.highWeight && <span className="quote-weight">读完仍差评 · 高权重</span>}
        </footer>
      )}
    </blockquote>
  );
}

function CompareRow({ cards }: { cards: DecisionCard[] }) {
  return (
    <div className="compare-row-wrap">
      <h2>横向对比</h2>
      <table className="compare-row">
        <thead>
          <tr>
            <th>书名</th>
            <th>预计时长</th>
            <th>门槛</th>
            <th>重叠度</th>
            <th>结论</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.cardId}>
              <td>{card.book.title}</td>
              <td>{estimatedHoursTableLabel(card.readingCost.estimatedHours)}</td>
              <td>{card.readingCost.difficulty.startsWith("有门槛") ? "较高" : card.readingCost.difficulty.startsWith("偏学理") ? "学理" : "适中"}</td>
              <td>
                {card.personalLink.relations.some((relation) => relation.type === "重复") || card.gatesHit.some((gate) => gate.includes("重复"))
                  ? "高"
                  : card.personalLink.relations.length > 0
                    ? "低"
                    : "无"}
              </td>
              <td>
                <span className={`verdict verdict-${card.verdict.action}`}>{VERDICT_LABELS[card.verdict.action]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function estimatedHoursLabel(value: number | null): string {
  return value === null ? "待校准" : `${value} 小时`;
}

function estimatedHoursTableLabel(value: number | null): string {
  return value === null ? "待校准" : `${value}h`;
}

function confidenceLabel(confidence: string): string {
  if (confidence === "high") return "高";
  if (confidence === "medium") return "中";
  return "低（关键证据不足，谨慎参考）";
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function formatCount(count: number): string {
  return count >= 10000 ? `${(count / 10000).toFixed(1)} 万` : String(count);
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}
