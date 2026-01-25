"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard, Landmark, BadgeCheck, BadgeAlert } from "lucide-react";
import DashboardShell from "../_components/DashboardShell";

type KeuanganMaster = { spp?: number; hotma?: number; spsa?: number; kpmb?: number; bpp?: number; lain?: number; total?: number };
type KeuanganRiwayat = {
  thaka?: string;
  spp?: number;
  hotma?: number;
  spsa?: number;
  kpmb?: number;
  bpp?: number;
  kkn?: number;
  ppl?: number;
  lain?: number;
  total?: number;
  tglBayar?: string;
  bank?: string;
  status?: string;
  ukt?: number;
  extra?: Record<string, number>;
};
type KeuanganTotals = { ukt?: number; totalPaid?: number; paidCount?: number; unpaidCount?: number; activeThaka?: string };

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatIdr(n: number) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 2 }).format(v);
  } catch {
    return `Rp ${v.toFixed(2)}`;
  }
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  const paid = normalized.includes("lunas");
  return (
    <span
      className={
        paid
          ? "inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-black text-white"
          : "inline-flex items-center gap-1 rounded-full bg-orange-600 px-2.5 py-1 text-[10px] font-black text-white"
      }
    >
      {paid ? <BadgeCheck className="h-3 w-3" /> : <BadgeAlert className="h-3 w-3" />}
      {status || "-"}
    </span>
  );
}

export default function KeuanganPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setReady(true));
  }, []);

  const { master, riwayat, totals } = useMemo(() => {
    if (!ready) return { master: {} as KeuanganMaster, riwayat: [] as KeuanganRiwayat[], totals: {} as KeuanganTotals };

    const master = safeJson<KeuanganMaster>(localStorage.getItem("user_keuangan_master"), {});
    // prefer the new key; fallback to legacy user_keuangan
    const riwayat =
      safeJson<KeuanganRiwayat[]>(localStorage.getItem("user_keuangan_riwayat"), []) ||
      (safeJson<KeuanganRiwayat[]>(localStorage.getItem("user_keuangan"), []) as KeuanganRiwayat[]);
    const totals = safeJson<KeuanganTotals>(localStorage.getItem("user_keuangan_totals"), {});

    return {
      master: master && typeof master === "object" ? master : {},
      riwayat: Array.isArray(riwayat) ? riwayat : [],
      totals: totals && typeof totals === "object" ? totals : {},
    };
  }, [ready]);

  const summary = useMemo(() => {
    const paid = Number(totals.paidCount) || riwayat.filter((r) => (r.status || "").toLowerCase().includes("lunas")).length;
    const unpaid = Number(totals.unpaidCount) || Math.max(riwayat.length - paid, 0);
    const totalUkt = Number(totals.ukt) || riwayat.reduce((acc, r) => acc + (Number(r.ukt ?? r.spp) || 0), 0);
    return { paid, unpaid, totalUkt };
  }, [riwayat, totals]);

  const totalsByColumn = useMemo(() => {
    const sum = (key: keyof KeuanganRiwayat) => riwayat.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
    const extraTotals: Record<string, number> = {};
    for (const r of riwayat) {
      const extra = r.extra || {};
      for (const [k, v] of Object.entries(extra)) {
        extraTotals[k] = (extraTotals[k] || 0) + (Number(v) || 0);
      }
    }
    return {
      spp: sum("spp"),
      hotma: sum("hotma"),
      spsa: sum("spsa"),
      kpmb: sum("kpmb"),
      bpp: sum("bpp"),
      kkn: sum("kkn"),
      ppl: sum("ppl"),
      lain: sum("lain"),
      extraTotals,
    };
  }, [riwayat]);

  return (
    <DashboardShell title="Keuangan" subtitle="Riwayat tagihan & pembayaran (hasil scrape siakad.um.ac.id)">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <CreditCard className="h-4 w-4 text-emerald-600" />
            Total Entri
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{riwayat.length}</div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">Data terakhir tersimpan</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <BadgeCheck className="h-4 w-4 text-emerald-600" />
            Lunas
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{summary.paid}</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <BadgeAlert className="h-4 w-4 text-orange-600" />
            Tagihan
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{summary.unpaid}</div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-extrabold text-slate-800">Total UKT (SPP) dari Riwayat</div>
          <div className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white">{formatIdr(summary.totalUkt)}</div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
          <Landmark className="h-4 w-4 text-slate-700" />
          Master Pembayaran
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["SPP/UKT", master.spp],
              ["HOTMA", master.hotma],
              ["SPSA", master.spsa],
              ["KPMB", master.kpmb],
              ["BPP", master.bpp],
              ["LAIN", master.lain],
            ] as Array<[string, number | undefined]>
          ).map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white/60 p-4">
              <div className="text-[11px] font-extrabold text-slate-600">{label}</div>
              <div className="mt-1 text-sm font-black text-slate-900">{formatIdr(Number(value) || 0)}</div>
            </div>
          ))}
        </div>

        {master && typeof master === "object" && (master as any).extra && Object.keys((master as any).extra || {}).length > 0 ? (
          <div className="mt-4 rounded-2xl bg-white/60 p-4">
            <div className="text-xs font-extrabold text-slate-800">Komponen Lain (Master)</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-700 sm:grid-cols-4">
              {Object.entries(((master as any).extra as Record<string, number>) || {}).map(([k, v]) => (
                <div key={k}>
                  {k}: {formatIdr(Number(v) || 0)}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 rounded-2xl bg-slate-900/90 p-4 text-white">
          <div className="text-[11px] font-extrabold text-white/80">Total Master</div>
          <div className="mt-1 text-lg font-black">{formatIdr(Number(master.total) || 0)}</div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
          <Landmark className="h-4 w-4 text-slate-700" />
          Riwayat
        </div>
        <div className="mt-4 space-y-2">
          {riwayat.length === 0 ? (
            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Belum ada data keuangan. Tekan Sinkronisasi.</div>
          ) : (
            riwayat.map((r, idx) => {
              const active = totals.activeThaka && String(totals.activeThaka) === String(r.thaka);
              return (
              <div key={idx} className={active ? "rounded-2xl bg-white/60 p-4 ring-2 ring-emerald-500/60" : "rounded-2xl bg-white/60 p-4"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-extrabold text-slate-900">THAKA {r.thaka || "-"}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-600">UKT (SPP): {formatIdr(Number(r.ukt ?? r.spp) || 0)}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">Tgl bayar: {r.tglBayar || "-"} • Bank: {r.bank || "-"}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">Total: {formatIdr(Number(r.total) || 0)}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-600 sm:grid-cols-4">
                      <div>HOTMA: {formatIdr(Number(r.hotma) || 0)}</div>
                      <div>SPSA: {formatIdr(Number(r.spsa) || 0)}</div>
                      <div>KPMB: {formatIdr(Number(r.kpmb) || 0)}</div>
                      <div>BPP: {formatIdr(Number(r.bpp) || 0)}</div>
                      <div>KKN: {formatIdr(Number(r.kkn) || 0)}</div>
                      <div>PPL: {formatIdr(Number(r.ppl) || 0)}</div>
                      <div>LAIN: {formatIdr(Number(r.lain) || 0)}</div>
                    </div>

                    {r.extra && Object.keys(r.extra).length > 0 ? (
                      <div className="mt-2 rounded-2xl bg-white/70 p-3">
                        <div className="text-[11px] font-extrabold text-slate-700">Komponen Lain (Riwayat)</div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-600 sm:grid-cols-4">
                          {Object.entries(r.extra).map(([k, v]) => (
                            <div key={k}>
                              {k}: {formatIdr(Number(v) || 0)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {statusBadge(r.status || "-")}
                </div>
              </div>
            );
            })
          )}
        </div>

        {riwayat.length > 0 ? (
          <div className="mt-4 rounded-2xl bg-white/60 p-4">
            <div className="text-xs font-extrabold text-slate-800">Total Riwayat (akumulasi kolom)</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-700 sm:grid-cols-4">
              <div>SPP/UKT: {formatIdr(totalsByColumn.spp)}</div>
              <div>HOTMA: {formatIdr(totalsByColumn.hotma)}</div>
              <div>SPSA: {formatIdr(totalsByColumn.spsa)}</div>
              <div>KPMB: {formatIdr(totalsByColumn.kpmb)}</div>
              <div>BPP: {formatIdr(totalsByColumn.bpp)}</div>
              <div>KKN: {formatIdr(totalsByColumn.kkn)}</div>
              <div>PPL: {formatIdr(totalsByColumn.ppl)}</div>
              <div>LAIN: {formatIdr(totalsByColumn.lain)}</div>
            </div>

            {Object.keys(totalsByColumn.extraTotals || {}).length > 0 ? (
              <div className="mt-3 rounded-2xl bg-white/70 p-3">
                <div className="text-[11px] font-extrabold text-slate-700">Total Komponen Lain</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-600 sm:grid-cols-4">
                  {Object.entries(totalsByColumn.extraTotals || {}).map(([k, v]) => (
                    <div key={k}>
                      {k}: {formatIdr(Number(v) || 0)}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
