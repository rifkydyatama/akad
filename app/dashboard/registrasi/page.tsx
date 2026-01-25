"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, BadgeCheck, BadgeAlert } from "lucide-react";
import DashboardShell from "../_components/DashboardShell";

type RegistrasiItem = { semester?: string; status?: string };
type KeuanganRiwayat = { thaka?: string; status?: string; tglBayar?: string; bank?: string; spp?: number; ukt?: number };

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isOk(status: string) {
  const s = status.toLowerCase();
  return s.includes("aktif") || s.includes("selesai") || s.includes("lunas") || s.includes("valid") || s.includes("sudah");
}

function semesterToThaka(semesterLabel: string) {
  const s = (semesterLabel || "").toLowerCase();
  const yearMatch = semesterLabel.match(/(20\d{2})\s*\/\s*(20\d{2})/);
  const yearStart = yearMatch ? Number(yearMatch[1]) : 0;
  const term = s.includes("genap") ? 2 : s.includes("gasal") ? 1 : 0;
  if (!yearStart || !term) return null;
  return `${yearStart}${term}`;
}

export default function RegistrasiPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setReady(true));
  }, []);

  const rows = useMemo(() => {
    if (!ready) return [] as RegistrasiItem[];
    const registrasi = safeJson<RegistrasiItem[]>(localStorage.getItem("user_registrasi"), []);
    return Array.isArray(registrasi) ? registrasi : [];
  }, [ready]);

  const keuRiwayat = useMemo(() => {
    if (!ready) return [] as KeuanganRiwayat[];
    const r = safeJson<KeuanganRiwayat[]>(localStorage.getItem("user_keuangan_riwayat"), []);
    return Array.isArray(r) ? r : [];
  }, [ready]);

  const keuByThaka = useMemo(() => {
    const map = new Map<string, KeuanganRiwayat>();
    for (const r of keuRiwayat) {
      const t = (r.thaka || "").trim();
      if (t) map.set(t, r);
    }
    return map;
  }, [keuRiwayat]);

  return (
    <DashboardShell title="Registrasi" subtitle="Riwayat status registrasi per semester (hasil scrape siakad.um.ac.id)">
      <div className="glass-card rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
          <FileText className="h-4 w-4 text-orange-600" />
          Riwayat Registrasi
        </div>

        <div className="mt-4 space-y-2">
          {rows.length === 0 ? (
            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Belum ada data registrasi. Tekan Sinkronisasi.</div>
          ) : (
            rows.map((r, idx) => {
              const ok = isOk(r.status || "");
              const thaka = r.semester ? semesterToThaka(r.semester) : null;
              const keu = thaka ? keuByThaka.get(thaka) : undefined;
              const keuPaid = (keu?.status || "").toLowerCase().includes("lunas") || Boolean(keu?.tglBayar);
              const registrasiAktif = (r.status || "").toLowerCase().includes("aktif");
              const mismatch = registrasiAktif && thaka && !keuPaid;
              return (
                <div key={idx} className="rounded-2xl bg-white/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-extrabold text-slate-900">{r.semester || "-"}</div>
                      <div className="mt-1 text-[11px] font-semibold text-slate-600">
                        THAKA: <span className="font-black">{thaka || "-"}</span>
                        {keu ? (
                          <>
                            {" "}• Keuangan: <span className={keuPaid ? "font-black text-emerald-700" : "font-black text-orange-700"}>{keuPaid ? "Lunas" : "Belum"}</span>
                          </>
                        ) : null}
                        {mismatch ? <span className="ml-2 font-black text-rose-600">(cek: registrasi aktif tapi riwayat belum terbaca)</span> : null}
                      </div>
                    </div>
                    <span
                      className={
                        ok
                          ? "inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-black text-white"
                          : "inline-flex items-center gap-1 rounded-full bg-orange-600 px-2.5 py-1 text-[10px] font-black text-white"
                      }
                    >
                      {ok ? <BadgeCheck className="h-3 w-3" /> : <BadgeAlert className="h-3 w-3" />}
                      {r.status || "-"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
