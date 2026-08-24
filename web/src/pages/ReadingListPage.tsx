import { useEffect, useState } from "react";
import { api } from "../api";
import { toast } from "../components/Toast";
import type { ReadingListItem } from "../types";

export function ReadingListPage() {
  const [items, setItems] = useState<ReadingListItem[]>([]);

  useEffect(() => {
    api
      .readingList()
      .then((result) => setItems(result.items))
      .catch((error) => toast(error instanceof Error ? error.message : "待读列表加载失败"));
  }, []);

  return (
    <div className="decide-page reading-list-page">
      <header className="decide-header">
        <h1>我的待读</h1>
        <p className="decide-lede">只保留每本书最近一次仍为「放入待读」的决定，不会写回微信读书。</p>
      </header>
      <section className="decide-history">
        {items.length === 0 ? (
          <p className="decide-history-empty">还没有待读书目。你在决策卡里放入待读的书会出现在这里。</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.bookId}>
                <span className="history-topic">{item.title}</span>
                <span className="history-action">{item.author}</span>
                <span className="history-action">触发条件：{item.trigger ?? "未填写"}</span>
                <span className="history-date">{formatDate(item.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}
