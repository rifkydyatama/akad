"use client";

import { useEffect, useRef } from "react";

export default function PageTransitionClient({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // start in enter state then activate for transition
    el.classList.add("page-enter");
    // allow next tick to ensure CSS picks up the initial state
    const t = window.setTimeout(() => el.classList.add("page-enter-active"), 20);
    return () => window.clearTimeout(t);
  }, []);

  return <div ref={ref} className="page-root">{children}</div>;
}
