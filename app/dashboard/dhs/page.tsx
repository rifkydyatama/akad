"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Award, Layers3 } from "lucide-react";
import DashboardShell from "../_components/DashboardShell";

type DhsPayload = { ipk?: string; totalSks?: string };

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function DhsPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setReady(true));
  }, []);

  const data = useMemo(() => {
    if (!ready) return null;
    const dhs = safeJson<DhsPayload>(localStorage.getItem("user_dhs"), {});
    const name = localStorage.getItem("user_name") || "Mahasiswa";
    const nim = localStorage.getItem("user_nim") || "-";
    const prodi = localStorage.getItem("user_prodi") || "-";

    return {
      ipk: dhs.ipk || "0.00",
      totalSks: dhs.totalSks || "0",
      name,
      nim,
      prodi,
    };
  }, [ready]);

  if (!data) return null;

  return (
    <DashboardShell title="DHS" subtitle="Ringkasan transkrip (IPK & total SKS)">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <BookOpen className="h-4 w-4 text-blue-600" />
            Mahasiswa
          </div>
          <div className="mt-2 truncate text-sm font-black text-slate-900">{data.name}</div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">
            {data.nim} • {data.prodi}
          </div>
        </div>

        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <Award className="h-4 w-4 text-emerald-600" />
            IPK
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">{data.ipk}</div>
        </div>

        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <Layers3 className="h-4 w-4 text-violet-600" />
            Total SKS
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">{data.totalSks}</div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-5">
        <div className="text-xs font-extrabold text-slate-800">Catatan</div>
        <div className="mt-2 text-xs font-semibold text-slate-600">
          Data ini diambil dari halaman DHS pada siakad.um.ac.id. Kalau angka 0, tekan Sinkronisasi untuk ambil ulang.
        </div>
      </div>
    </DashboardShell>
  );
}
