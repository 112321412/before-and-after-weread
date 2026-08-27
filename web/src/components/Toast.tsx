import { useEffect, useState } from "react";

// 轻量 toast：模块级事件总线，任何模块 toast("…") 即可，宿主挂在 App 根部
const TOAST_EVENT = "app-toast";

export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

interface ToastItem {
  id: number;
  message: string;
}

let nextToastId = 1;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      const id = nextToastId;
      nextToastId += 1;
      setItems((current) => [...current, { id, message }]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, 2600);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="toast-item">
          {item.message}
        </div>
      ))}
    </div>
  );
}
