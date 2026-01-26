"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Toast = { id: string; title?: string; message: string; type?: "info" | "success" | "error" };

const ToastContext = createContext<{
  push: (t: Omit<Toast, 'id'>) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
    setToasts((s) => [...s, { id, ...t }]);
    // Auto-remove after 4s
    setTimeout(() => setToasts((s) => s.filter(x => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);
  // expose a minimal global fallback for existing code paths that still call alert
  useEffect(() => {
    try {
      (window as any).__siakad_toast = { push };
      return () => { try { delete (window as any).__siakad_toast; } catch {} };
    } catch { /* ignore */ }
  }, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed right-4 bottom-6 z-50 flex flex-col gap-3">
        {toasts.map(t => (
          <div key={t.id} className={`max-w-sm rounded-xl px-4 py-3 shadow-lg ring-1 ring-black/6 transform-gpu transition-all ${t.type==='success'?'bg-emerald-600 text-white':'', t.type==='error'?'bg-rose-600 text-white':''}`}>
            <div className="text-sm font-bold">{t.title || (t.type==='success' ? 'Berhasil' : t.type==='error' ? 'Error' : 'Info')}</div>
            <div className="mt-1 text-xs opacity-90">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
