import { useCallback, useEffect, useState } from "react";

// 极简 hash 路由：#/shelf /#/decide /#/review /#/settings
export function useHashRoute(): [string, (to: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/shelf");
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1) || "/shelf");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);
  return [route, navigate];
}
