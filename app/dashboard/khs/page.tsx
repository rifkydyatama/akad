"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, GraduationCap } from "lucide-react";
import DashboardShell from "../_components/DashboardShell";

type KhsItem = { matkul?: string; sks?: number; nilai?: string };
type KhsPayload = { semester?: string; ips?: string; matkul?: KhsItem[] };

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function KhsPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setReady(true));
  }, []);

  const data = useMemo(() => {
    if (!ready) return null;
    const khs = safeJson<KhsPayload>(localStorage.getItem("user_khs"), {});
    const prodi = localStorage.getItem("user_prodi") || "-";

    const matkul = Array.isArray(khs.matkul) ? khs.matkul : [];
    const totalSks = matkul.reduce((acc, m) => acc + (Number(m.sks) || 0), 0);

    return {
      semester: khs.semester || "-",
      ips: khs.ips || "0.00",
      prodi,
      totalSks,
      matkul,
    };
  }, [ready]);

  if (!data) return null;

  return (
    <DashboardShell title="KHS" subtitle="Ringkasan nilai per semester (hasil scrape siakad.um.ac.id)">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <GraduationCap className="h-4 w-4 text-blue-600" />
            Semester
          </div>
          <div className="mt-2 text-sm font-black text-slate-900">{data.semester}</div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">{data.prodi}</div>
        </div>

        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
            IPS
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{data.ips}</div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">Indeks Prestasi Semester</div>
        </div>

        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <BookOpen className="h-4 w-4 text-violet-600" />
            Total SKS
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{data.totalSks}</div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">Dari KHS yang tersimpan</div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-5">
        <div className="text-xs font-extrabold text-slate-800">Daftar Mata Kuliah</div>
        <div className="mt-4 overflow-hidden rounded-2xl bg-white/60">
          {data.matkul.length === 0 ? (
            <div className="p-4 text-xs font-semibold text-slate-600">Belum ada data KHS. Tekan tombol Sinkronisasi di atas.</div>
          ) : (
            <div className="divide-y divide-slate-200/60">
              {data.matkul.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-extrabold text-slate-900">{m.matkul || "-"}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-600">SKS: {m.sks ?? "-"}</div>
                  </div>
                  <div className="shrink-0 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white">{m.nilai || "-"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
