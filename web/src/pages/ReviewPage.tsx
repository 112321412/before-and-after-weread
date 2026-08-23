import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { toast } from "../components/Toast";
import type { RecallDraft, ReviewBookItem, ThemeResult } from "../types";

const GROUP_LABELS: Record<ReviewBookItem["group"], string> = {
  finished: "最近读完",
  abandoned: "读了一半放下",
  reading: "在读"
};

const SUGGESTED_QUESTIONS = ["我对组织的看法如何演变", "哪些观点我可以复用", "我记录过哪些分歧"];

export function ReviewPage() {
  const [books, setBooks] = useState<ReviewBookItem[]>([]);
  const [draft, setDraft] = useState<RecallDraft | null>(null);
  const [busyBookId, setBusyBookId] = useState<string | null>(null);
  const [removedEvidence, setRemovedEvidence] = useState<Set<string>>(new Set());
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [theme, setTheme] = useState<ThemeResult | null>(null);
  const [reflections, setReflections] = useState<Record<string, string>>({});
  const [themeRemoved, setThemeRemoved] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ title: string; markdown: string } | null>(null);

  useEffect(() => {
    api.reviewBooks().then((result) => setBooks(result.books)).catch(() => undefined);
  }, []);

  async function openRecall(book: ReviewBookItem) {
    if (book.highlights + book.thoughts === 0) {
      toast("这本书还没有留下痕迹——先去读一会儿，划下第一条线。");
      return;
    }
    setBusyBookId(book.bookId);
    try {
      const result = await api.reviewBook(book.bookId);
      setDraft(result);
      setRemovedEvidence(new Set());
      setParagraphs(result.sections.flatMap((section) => section.paragraphs));
      document.getElementById("recall-panel")?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "回顾生成失败");
    } finally {
      setBusyBookId(null);
    }
  }

  // 段落按 sections 顺序平铺编辑，回收时按原分段切回
  const sectionRanges = useMemo(() => {
    if (!draft) return [];
    let cursor = 0;
    return draft.sections.map((section) => {
      const start = cursor;
      cursor += section.paragraphs.length;
      return { start, end: cursor };
    });
  }, [draft]);

  function updateParagraph(index: number, value: string) {
    setParagraphs((current) => current.map((text, i) => (i === index ? value : text)));
  }

  const draftMarkdown = useMemo(() => buildRecallMarkdown(draft, paragraphs, sectionRanges, removedEvidence), [draft, paragraphs, sectionRanges, removedEvidence]);
  const themeMarkdown = useMemo(() => buildThemeMarkdown(theme, reflections, themeRemoved), [theme, reflections, themeRemoved]);

  const grouped = (group: ReviewBookItem["group"]) => books.filter((book) => book.group === group);

  return (
    <div className="review-page">
      <header className="review-header">
        <h1>读后整理</h1>
        <p className="review-lede">素材只有你自己的划线与想法——忠实整理，不评判、不挑战。</p>
      </header>

      <section className="review-books" aria-label="回顾书列表">
        {(["finished", "abandoned", "reading"] as const).map((group) =>
          grouped(group).length > 0 ? (
            <div key={group} className="review-group">
              <h2>{GROUP_LABELS[group]}</h2>
              <div className="review-book-list">
                {grouped(group).map((book) => (
                  <button
                    key={book.bookId}
                    type="button"
                    className={`review-book${book.highlights + book.thoughts === 0 ? " empty" : ""}${
                      draft?.bookId === book.bookId ? " active" : ""
                    }`}
                    onClick={() => openRecall(book)}
                    disabled={busyBookId !== null}
                  >
                    <strong>{book.title}</strong>
                    <span className="review-book-meta">
                      {book.highlights + book.thoughts === 0
                        ? "还没有留下痕迹"
                        : `划线 ${book.highlights} · 想法 ${book.thoughts}`}
                      {group === "reading" ? ` · 在读 ${book.progress}%` : ""}
                      {group === "abandoned" ? ` · 停在 ${book.progress}%` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null
        )}
      </section>

      {draft && (
        <section id="recall-panel" className="recall-panel" aria-label="单书回顾">
          <header className="recall-head">
            <h2>{draft.title} · 单书札记</h2>
            <p className="recall-meta">
              {draft.framework === "abandoned" ? "弃读回顾" : draft.framework === "reading" ? "在读阶段性回顾" : "读完回顾"}
              {draft.headlineNote ? ` · ${draft.headlineNote}` : ""}
              {draft.llm === "rules" && !draft.headlineNote ? " · 未接入 LLM，按时间线规则整理" : ""}
            </p>
          </header>

          {draft.sections.map((section, sectionIndex) => {
            const range = sectionRanges[sectionIndex];
            return (
              <div key={section.title} className="recall-section">
                <h3>{section.title}</h3>
                {paragraphs.slice(range.start, range.end).map((text, offset) => (
                  <textarea
                    key={range.start + offset}
                    className="recall-paragraph"
                    value={text}
                    onChange={(event) => updateParagraph(range.start + offset, event.target.value)}
                    rows={Math.max(2, Math.ceil(text.length / 46))}
                  />
                ))}
                {section.evidenceIds
                  .filter((id) => !removedEvidence.has(id))
                  .map((id) => {
                    const evidence = draft.evidences.find((entry) => entry.id === id);
                    if (!evidence) return null;
                    return (
                      <EvidenceQuote
                        key={id}
                        text={evidence.text}
                        meta={quoteMeta(evidence.kind, evidence.chapterUid, evidence.createTime)}
                        onRemove={() =>
                          setRemovedEvidence((current) => new Set(current).add(id))
                        }
                      />
                    );
                  })}
              </div>
            );
          })}

          {draft.evolution.length > 0 && (
            <div className="recall-evolution">
              <h3>前后对照（作为事实列出）</h3>
              {draft.evolution.map((fact) => (
                <div key={fact.note}>
                  <p>{fact.note}</p>
                  {fact.evidenceIds
                    .filter((id) => !removedEvidence.has(id))
                    .map((id) => {
                      const evidence = draft.evidences.find((entry) => entry.id === id);
                      return evidence ? (
                        <EvidenceQuote
                          key={id}
                          text={evidence.text}
                          meta={quoteMeta(evidence.kind, evidence.chapterUid, evidence.createTime)}
                          onRemove={() => setRemovedEvidence((current) => new Set(current).add(id))}
                        />
                      ) : null;
                    })}
                </div>
              ))}
            </div>
          )}

          <div className="recall-actions">
            <button type="button" className="primary" onClick={() => setPreview({ title: `${draft.title}·单书札记`, markdown: draftMarkdown })}>
              预览并导出札记
            </button>
          </div>
        </section>
      )}

      <section className="theme-panel" aria-label="跨书主题整理">
        <h2>跨书主题整理</h2>
        <p className="review-lede">提一个问题，从全部划线与想法里找主题、分歧与演变。</p>
        <div className="theme-input-row">
          <input
            value={question}
            placeholder="例如：我对组织的看法如何演变"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            type="button"
            disabled={question.trim() === ""}
            onClick={async () => {
              try {
                const result = await api.reviewTheme(question.trim());
                setTheme(result);
                setReflections({});
                setThemeRemoved(new Set());
              } catch (err) {
                toast(err instanceof Error ? err.message : "主题整理失败");
              }
            }}
          >
            整理
          </button>
        </div>
        <div className="chip-row">
          {SUGGESTED_QUESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" className="chip" onClick={() => setQuestion(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>

        {theme && theme.insufficient && <p className="theme-insufficient">{theme.note}</p>}
        {theme && !theme.insufficient && (
          <div className="theme-result">
            <p className="theme-summary">
              「{theme.question}」共命中 {theme.totalMatches} 条痕迹，来自《{theme.books.slice(0, 4).join("》《")}
              {theme.books.length > 4 ? " 等" : ""}》
              {theme.llm === "rules" ? " · 未接入 LLM，按命中词元聚类" : ""}
            </p>
            <div className="theme-cards">
              {theme.themes.map((group) => (
                <article key={group.title} className="theme-card">
                  <h3>{group.title}</h3>
                  <p className="theme-card-summary">{group.summary}</p>
                  <span className="theme-card-label">证据（只读，可删除）</span>
                  {group.evidenceIds
                    .filter((id) => !themeRemoved.has(id))
                    .map((id) => {
                      const evidence = theme.evidences.find((entry) => entry.id === id);
                      return evidence ? (
                        <EvidenceQuote
                          key={id}
                          text={evidence.text}
                          meta={`《${evidence.bookTitle}》 · ${formatMonthDay(evidence.createTime)}`}
                          onRemove={() => setThemeRemoved((current) => new Set(current).add(id))}
                        />
                      ) : null;
                    })}
                  <span className="theme-card-label">反思（可编辑）</span>
                  <textarea
                    className="recall-paragraph"
                    value={reflections[group.title] ?? ""}
                    placeholder="写下你现在的想法——它是这三段里唯一属于未来的部分。"
                    onChange={(event) => setReflections((current) => ({ ...current, [group.title]: event.target.value }))}
                  />
                </article>
              ))}
            </div>
            {theme.evolution.length > 0 && (
              <div className="recall-evolution">
                <h3>分歧与演变（作为事实列出）</h3>
                {theme.evolution.map((fact) => (
                  <p key={fact.note}>{fact.note}</p>
                ))}
              </div>
            )}
            <div className="recall-actions">
              <button
                type="button"
                className="primary"
                onClick={() => setPreview({ title: `观点卡片组·${theme.question}`, markdown: themeMarkdown })}
              >
                预览并导出卡片组
              </button>
            </div>
          </div>
        )}
      </section>

      {preview && (
        <div className="export-modal" role="dialog" aria-label="导出预览">
          <div className="export-modal-body">
            <h3>导出预览 · Markdown</h3>
            <pre>{preview.markdown}</pre>
            <div className="export-modal-actions">
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  try {
                    await api.reviewExport(preview.title, preview.markdown);
                    toast("已导出 Markdown");
                    setPreview(null);
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "导出失败");
                  }
                }}
              >
                确认导出
              </button>
              <button type="button" onClick={() => setPreview(null)}>
                返回编辑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceQuote({ text, meta, onRemove }: { text: string; meta: string; onRemove: () => void }) {
  return (
    <blockquote className="evidence-quote">
      <p>{text}</p>
      <footer>
        {meta}
        <button type="button" className="quote-remove" onClick={onRemove}>
          删除
        </button>
      </footer>
    </blockquote>
  );
}

function quoteMeta(kind: "highlight" | "thought", chapterUid: number | null, createTime: number): string {
  const date = formatMonthDay(createTime);
  return kind === "thought" ? `想法 · ${date}` : `第 ${chapterUid} 章 · ${date}`;
}

function formatMonthDay(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildRecallMarkdown(
  draft: RecallDraft | null,
  paragraphs: string[],
  sectionRanges: { start: number; end: number }[],
  removed: Set<string>
): string {
  if (!draft) return "";
  const evidenceLine = (id: string) => {
    const evidence = draft.evidences.find((entry) => entry.id === id);
    if (!evidence || removed.has(id)) return null;
    const meta = quoteMeta(evidence.kind, evidence.chapterUid, evidence.createTime);
    return `> ${evidence.text}\n> —— ${meta}${evidence.context ? `（针对划线：${evidence.context}）` : ""}`;
  };
  const lines = [`# ${draft.title} · 单书札记`, ""];
  lines.push(
    `> ${draft.framework === "abandoned" ? "弃读回顾" : draft.framework === "reading" ? `在读 ${draft.meta.progress}% · 阶段性回顾` : "读完回顾"} · 划线 ${draft.meta.highlightCount} 条 / 想法 ${draft.meta.thoughtCount} 条${
      draft.meta.finishedAt ? ` · 读完于 ${draft.meta.finishedAt}` : ""
    }`,
    ""
  );
  draft.sections.forEach((section, index) => {
    lines.push(`## ${section.title}`, "");
    paragraphs.slice(sectionRanges[index].start, sectionRanges[index].end).forEach((text) => {
      if (text.trim()) lines.push(text, "");
    });
    section.evidenceIds.forEach((id) => {
      const line = evidenceLine(id);
      if (line) lines.push(line, "");
    });
  });
  if (draft.evolution.length > 0) {
    lines.push("## 前后对照（作为事实列出）", "");
    draft.evolution.forEach((fact) => lines.push(`- ${fact.note}`));
    lines.push("");
  }
  return lines.join("\n");
}

function buildThemeMarkdown(theme: ThemeResult | null, reflections: Record<string, string>, removed: Set<string>): string {
  if (!theme) return "";
  const lines = [`# 观点卡片组 · ${theme.question}`, "", `素材：${theme.totalMatches} 条痕迹 · ${theme.books.length} 本书`, ""];
  theme.themes.forEach((group) => {
    lines.push(`## ${group.title}`, "", group.summary, "");
    group.evidenceIds.forEach((id) => {
      const evidence = theme.evidences.find((entry) => entry.id === id);
      if (!evidence || removed.has(id)) return;
      lines.push(`> ${evidence.text}`, `> —— 《${evidence.bookTitle}》${evidence.context ? `（针对划线：${evidence.context}）` : ""}`, "");
    });
    const reflection = reflections[group.title]?.trim();
    if (reflection) lines.push(`**反思**：${reflection}`, "");
  });
  if (theme.evolution.length > 0) {
    lines.push("## 分歧与演变（作为事实列出）", "");
    theme.evolution.forEach((fact) => lines.push(`- ${fact.note}`));
    lines.push("");
  }
  return lines.join("\n");
}
