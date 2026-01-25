"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
    ArrowUpRight,
    BadgeCheck,
    BookOpen,
    Calendar,
    CreditCard,
    FileText,
    GraduationCap,
    Loader2,
    MapPinned,
    RefreshCw,
} from "lucide-react";

import ClassNotification from "../components/ClassNotification";
import { persistSiakadUser } from "../lib/persistUser";
import type { SiakadAuthPayload } from "../lib/persistUser";

type KeuanganItem = { semester?: string; nominal?: string; status?: string };
type RegistrasiItem = { semester?: string; status?: string };
type JadwalItem = { matkul?: string; hari?: string; jam?: string; ruang?: string; dosen?: string };
type DhsPayload = { ipk?: string; totalSks?: string };
type KeuanganRow = {
    thaka?: string;
    semester?: string;
    nominal?: string;
    status?: string;
    ukt?: number;
    spp?: number;
};

function safeJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function titleCase(input: string) {
    if (!input) return input;
    return input.charAt(0).toUpperCase() + input.slice(1);
}

function formatIdr(n: number) {
    const v = Number(n) || 0;
    try {
        return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 2 }).format(v);
    } catch {
        return `Rp ${v.toFixed(2)}`;
    }
}

export default function DashboardHome() {
    const [ready, setReady] = useState(false);
    const [storageVersion, setStorageVersion] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [notifKey, setNotifKey] = useState(0);
    const router = useRouter();

    useEffect(() => {
        queueMicrotask(() => setReady(true));
    }, []);

    useEffect(() => {
        if (!ready) return;

        const nim = localStorage.getItem("user_nim") || "";
        const password = localStorage.getItem("user_password") || "";
        if (!nim || !password) {
            router.replace("/login");
            return;
        }

        const onSync = () => setStorageVersion((v) => v + 1);
        window.addEventListener("siakad-sync", onSync);
        return () => window.removeEventListener("siakad-sync", onSync);
    }, [ready, router]);

    useEffect(() => {
        if (!ready) return;

        const nim = localStorage.getItem("user_nim") || "";
        const password = localStorage.getItem("user_password") || "";
        if (!nim || !password) return;

        let cancelled = false;

        const cooldownMs = 15 * 60 * 1000;

        const hasLocalData = () => {
            // Consider "data lokal sudah ada" if any of these payload keys exist.
            const keys = [
                "user_dhs",
                "user_khs",
                "user_keuangan_riwayat",
                "user_keuangan",
                "user_registrasi",
                "user_jadwal",
                "user_dhe",
            ];
            return keys.some((k) => {
                const v = localStorage.getItem(k);
                return v != null && v !== "" && v !== "[]" && v !== "{}";
            });
        };

        const runSilentSync = async () => {
            setIsSyncing(true);
            try {
                const res = await fetch("/api/auth/siakad", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ nim, password }),
                });
                const data = (await res.json()) as SiakadAuthPayload;
                if (!data?.success) {
                    if (res.status === 401) router.replace("/login");
                    return;
                }
                if (cancelled) return;

                persistSiakadUser(data);
                // Cooldown timestamp for dashboard silent sync
                localStorage.setItem("last_sync_time", String(Date.now()));
                setStorageVersion((v) => v + 1);
                setNotifKey((k) => k + 1);
            } catch {
                // silent failure
            } finally {
                if (!cancelled) setIsSyncing(false);
            }
        };

        const lastSyncRaw = localStorage.getItem("last_sync_time");
        const lastSync = Number(lastSyncRaw || "0");
        const elapsed = Date.now() - lastSync;
        const shouldSync = !hasLocalData() || !lastSync || elapsed > cooldownMs;

        if (!shouldSync) {
            console.log(
                `[siakad] Silent sync skipped (cooldown). Next in ~${Math.ceil((cooldownMs - elapsed) / 1000)}s`,
            );
        } else {
            // Fire-and-forget without blocking UI
            void runSilentSync();
        }

        return () => {
            cancelled = true;
        };
    }, [ready, router]);

    const data = useMemo(() => {
        if (!ready) return null;
        const name = localStorage.getItem("user_name") || "Mahasiswa";
        const nim = localStorage.getItem("user_nim") || "";
        const prodi = localStorage.getItem("user_prodi") || "-";
        const fakultas = localStorage.getItem("user_fakultas") || "-";
        const dosen = localStorage.getItem("user_dosen") || "-";
        const status = localStorage.getItem("user_status") || "-";
        const jalur = localStorage.getItem("user_jalur") || "-";
        const foto = localStorage.getItem("user_foto") || "";

        const dhs = safeJson<DhsPayload>(localStorage.getItem("user_dhs"), {});
        const keuRiwayat = safeJson<KeuanganRow[]>(localStorage.getItem("user_keuangan_riwayat"), []);
        const keuLegacy = safeJson<KeuanganRow[]>(localStorage.getItem("user_keuangan"), []);
        const keuanganRaw = Array.isArray(keuRiwayat) && keuRiwayat.length > 0 ? keuRiwayat : keuLegacy;
        const keuangan = (Array.isArray(keuanganRaw) ? keuanganRaw : []).slice(0, 3).map((k) => {
            const semesterLabel = String(k?.semester || k?.thaka || "-");
            const nominal = k?.nominal || formatIdr(Number(k?.ukt ?? k?.spp) || 0);
            const status = String(k?.status || "-");
            return { semester: semesterLabel, nominal, status } as KeuanganItem;
        });
        const registrasi = safeJson<RegistrasiItem[]>(localStorage.getItem("user_registrasi"), []);
        const jadwal = safeJson<JadwalItem[]>(localStorage.getItem("user_jadwal"), []);

        const today = titleCase(new Intl.DateTimeFormat("id-ID", { weekday: "long" }).format(new Date()));
        const jadwalHariIni = jadwal.filter((j) => (j.hari || "").toLowerCase() === today.toLowerCase()).slice(0, 5);

        return {
            profile: { name, nim, prodi, fakultas, dosen, status, jalur, foto },
            stats: { ipk: dhs?.ipk ?? "0.00", sks: dhs?.totalSks ?? "0" },
            keuangan,
            registrasi: registrasi.slice(0, 3),
            today,
            jadwalHariIni,
        };
    }, [ready, storageVersion]);

    if (!data) return null;

    return (
        <div className="space-y-6">
            {notifKey > 0 ? <ClassNotification key={notifKey} /> : null}
            {/* Header card */}
            <section className="glass-card overflow-hidden rounded-3xl">
                <div className="bg-linear-to-br from-blue-600 to-indigo-700 p-6 text-white">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-xs font-semibold text-blue-100">Selamat datang</div>
                            <div className="mt-1 truncate text-2xl font-black tracking-tight">{data.profile.name}</div>
                            <div className="mt-1 text-xs font-semibold text-blue-100">
                                {data.profile.nim} • {data.profile.prodi}
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            {isSyncing ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[10px] font-extrabold text-white">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Updating...
                                </span>
                            ) : null}
                            <button
                                type="button"
                                title="Force refresh"
                                aria-label="Force refresh"
                                onClick={() => {
                                    // Clear cooldown + inflight locks so next load will sync again
                                    localStorage.removeItem("last_sync_time");
                                    localStorage.removeItem("siakad_last_sync_ts");
                                    localStorage.removeItem("siakad_sync_inflight_ts");
                                    window.location.reload();
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </button>
                            <Image
                                alt="Foto profil"
                                src={
                                    data.profile.foto ||
                                    `https://ui-avatars.com/api/?name=${encodeURIComponent(data.profile.name)}&background=fff&color=000`
                                }
                                width={56}
                                height={56}
                                className="h-14 w-14 rounded-2xl border border-white/50 bg-white/20 object-cover"
                                unoptimized
                            />
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-2xl bg-white/15 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-100">IPK</div>
                            <div className="mt-1 text-xl font-black">{data.stats.ipk}</div>
                        </div>
                        <div className="rounded-2xl bg-white/15 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-100">Total SKS</div>
                            <div className="mt-1 text-xl font-black">{data.stats.sks}</div>
                        </div>
                        <div className="rounded-2xl bg-white/15 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-100">Status</div>
                            <div className="mt-1 truncate text-sm font-extrabold">{data.profile.status}</div>
                        </div>
                        <div className="rounded-2xl bg-white/15 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-100">Jalur</div>
                            <div className="mt-1 truncate text-sm font-extrabold">{data.profile.jalur}</div>
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 p-6 sm:grid-cols-3">
                    <div className="rounded-3xl bg-white/60 p-5">
                        <div className="flex items-center gap-2 text-sm font-extrabold">
                            <GraduationCap size={18} className="text-blue-600" />
                            Identitas Akademik
                        </div>
                        <div className="mt-3 space-y-2 text-xs font-semibold text-slate-600">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-400">Fakultas</span>
                                <span className="truncate text-right font-bold text-slate-800">{data.profile.fakultas}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-400">Dosen PA</span>
                                <span className="truncate text-right font-bold text-slate-800">{data.profile.dosen}</span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl bg-white/60 p-5">
                        <div className="flex items-center gap-2 text-sm font-extrabold">
                            <BadgeCheck size={18} className="text-emerald-600" />
                            Akses Cepat
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <Link
                                href="/dashboard/jadwal"
                                className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
                            >
                                <span className="flex items-center gap-2">
                                    <Calendar size={16} className="text-blue-600" /> Jadwal
                                </span>
                                <ArrowUpRight size={14} className="text-slate-400" />
                            </Link>
                            <Link
                                href="/dashboard/khs"
                                className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
                            >
                                <span className="flex items-center gap-2">
                                    <BookOpen size={16} className="text-violet-600" /> KHS
                                </span>
                                <ArrowUpRight size={14} className="text-slate-400" />
                            </Link>
                            <Link
                                href="/dashboard/keuangan"
                                className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
                            >
                                <span className="flex items-center gap-2">
                                    <CreditCard size={16} className="text-emerald-600" /> Keuangan
                                </span>
                                <ArrowUpRight size={14} className="text-slate-400" />
                            </Link>
                            <Link
                                href="/dashboard/registrasi"
                                className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
                            >
                                <span className="flex items-center gap-2">
                                    <FileText size={16} className="text-orange-600" /> Registrasi
                                </span>
                                <ArrowUpRight size={14} className="text-slate-400" />
                            </Link>
                        </div>
                    </div>

                    <div className="rounded-3xl bg-white/60 p-5">
                        <div className="flex items-center gap-2 text-sm font-extrabold">
                            <MapPinned size={18} className="text-pink-600" />
                            Jadwal Hari Ini
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{data.today}</div>
                        {data.jadwalHariIni.length === 0 ? (
                            <div className="mt-3 rounded-2xl bg-white p-3 text-xs font-semibold text-slate-500">
                                Tidak ada kelas hari ini.
                            </div>
                        ) : (
                            <div className="mt-3 space-y-2">
                                {data.jadwalHariIni.map((j, idx) => (
                                    <div key={idx} className="rounded-2xl bg-white p-3">
                                        <div className="truncate text-xs font-extrabold text-slate-900">{j.matkul || "-"}</div>
                                        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-600">
                                            <span className="truncate">{j.ruang || "-"}</span>
                                            <span className="shrink-0 font-bold text-slate-900">{j.jam || "-"}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Data panels */}
            <section className="grid gap-6 lg:grid-cols-2">
                <div className="glass-card rounded-3xl p-6">
                    <div className="flex items-center justify-between">
                        <div className="text-sm font-extrabold">Ringkasan Keuangan</div>
                        <Link href="/dashboard/keuangan" className="text-xs font-extrabold text-blue-700 hover:underline">
                            Lihat semua
                        </Link>
                    </div>
                    <div className="mt-4 space-y-2">
                        {data.keuangan.length === 0 ? (
                            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Belum ada data keuangan.</div>
                        ) : (
                            data.keuangan.map((k, idx) => (
                                <div key={idx} className="rounded-2xl bg-white/60 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-xs font-extrabold text-slate-900">{k.semester || "-"}</div>
                                            <div className="mt-1 text-[11px] font-semibold text-slate-600">{k.nominal || "-"}</div>
                                        </div>
                                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-extrabold text-white">
                                            {k.status || "-"}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="glass-card rounded-3xl p-6">
                    <div className="flex items-center justify-between">
                        <div className="text-sm font-extrabold">Riwayat Registrasi</div>
                        <Link href="/dashboard/registrasi" className="text-xs font-extrabold text-blue-700 hover:underline">
                            Lihat semua
                        </Link>
                    </div>
                    <div className="mt-4 space-y-2">
                        {data.registrasi.length === 0 ? (
                            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Belum ada data registrasi.</div>
                        ) : (
                            data.registrasi.map((r, idx) => (
                                <div key={idx} className="rounded-2xl bg-white/60 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-extrabold text-slate-900">{r.semester || "-"}</div>
                                        <div className="text-[11px] font-extrabold text-slate-700">{r.status || "-"}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}