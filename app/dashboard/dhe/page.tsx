"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy, Sparkles } from "lucide-react";
import DashboardShell from "../_components/DashboardShell";

type DheItem = { kegiatan?: string; poin?: string };

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function DhePage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setReady(true));
  }, []);

  const rows = useMemo(() => {
    if (!ready) return [] as DheItem[];
    const dhe = safeJson<DheItem[]>(localStorage.getItem("user_dhe"), []);
    return Array.isArray(dhe) ? dhe : [];
  }, [ready]);

  return (
    <DashboardShell title="DHE" subtitle="Kegiatan & poin (ringkasan)">
      <div className="glass-card rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
          <Sparkles className="h-4 w-4 text-pink-600" />
          Ringkasan DHE
        </div>

        <div className="mt-4 space-y-2">
          {rows.length === 0 ? (
            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Belum ada data DHE. Tekan Sinkronisasi.</div>
          ) : (
            rows.map((r, idx) => (
              <div key={idx} className="rounded-2xl bg-white/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-extrabold text-slate-900">{r.kegiatan || "-"}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-600">Poin</div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black text-white">
                    <Trophy className="h-3 w-3" />
                    {r.poin || "-"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
