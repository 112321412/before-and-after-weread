import { useEffect, useRef } from "react";
import { bookStatusLabel, type ShelfBook } from "../types";

// 降级书架：prefers-reduced-motion 或 WebGL 不可用时替代三维场景。
// 封面网格 + 主题色仍然跟随 CSS 变量（点击换焦点书即换全站调色板）。
interface StaticShelfProps {
  books: ShelfBook[];
  focusIndex: number;
  onFocus: (index: number) => void;
  onActivate: (index: number) => void;
}

export function StaticShelf({ books, focusIndex, onFocus, onActivate }: StaticShelfProps) {
  const focusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [focusIndex]);

  return (
    <div className="static-shelf-wrap">
      <div className="static-shelf" role="listbox" aria-label="书架">
        {books.map((book, index) => (
          <button
            key={book.bookId}
            ref={index === focusIndex ? focusRef : undefined}
            type="button"
            className={`static-book${index === focusIndex ? " focused" : ""}`}
            style={{ ["--book-dominant" as string]: book.dominant, ["--book-accent" as string]: book.palette.accent }}
            role="option"
            aria-selected={index === focusIndex}
            onClick={() => (index === focusIndex ? onActivate(index) : onFocus(index))}
          >
            <img src={book.cover} alt={`${book.title} 封面`} loading="lazy" />
            <span className="static-book-title">{book.title}</span>
            <span className="static-book-status">{bookStatusLabel(book)}</span>
          </button>
        ))}
      </div>
      <p className="static-shelf-note">已按系统偏好切换为静态书架；点击书籍切换主题色，再次点击查看详情提示。</p>
    </div>
  );
}
