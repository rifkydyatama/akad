"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  BarChart3,
  BookOpen,
  Calendar,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  UserCircle2,
  X,
} from "lucide-react";
import SyncModal from "./_components/SyncModal";
import ClassNotification from "../components/ClassNotification";
import MobileBottomNav from "./_components/MobileBottomNav";
import { persistSiakadUser } from "../lib/persistUser";
import NotificationsToggle from "../components/NotificationsToggle";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);

  const user =
    !ready || typeof window === "undefined"
      ? null
      : {
          name: localStorage.getItem("user_name") || "Mahasiswa",
          nim: localStorage.getItem("user_nim") || "",
          prodi: localStorage.getItem("user_prodi") || "-",
          foto: localStorage.getItem("user_foto") || "",
        };

  useEffect(() => {
    const nim = localStorage.getItem("user_nim");
    if (!nim) {
      router.replace("/");
      return;
    }
    queueMicrotask(() => setReady(true));
  }, [router]);

  // When localStorage is updated by sync, force remount so pages re-read stored data.
  useEffect(() => {
    const onSync = () => setSyncNonce(Date.now());
    window.addEventListener("siakad-sync", onSync);
    return () => window.removeEventListener("siakad-sync", onSync);
  }, []);

  // Auto sync: refresh data periodically without re-entering password.
  // IMPORTANT: avoid triggering multiple long scrapes on navigation.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    // Keep sync infrequent to avoid spammy behavior and UI flicker.
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
    const inflightTtlMs = 7 * 60 * 1000; // if a sync started recently, don't start another

    const canStartSync = () => {
      const inflightAt = Number(localStorage.getItem("siakad_sync_inflight_ts") || "0");
      if (inflightAt && Date.now() - inflightAt < inflightTtlMs) return false;
      return true;
    };

    const shouldSyncNow = () => {
      const last = Number(localStorage.getItem("siakad_last_sync_ts") || "0");
      return Date.now() - last > maxAgeMs;
    };

    const runSync = async () => {
      if (cancelled) return;
      if (!canStartSync()) return;
      if (!shouldSyncNow()) return;
      localStorage.setItem("siakad_sync_inflight_ts", String(Date.now()));
      // avoid UI flicker: only show 'autoSyncing' if sync takes longer than a short threshold
      let spinnerTimer: number | null = null;
      const SPINNER_DELAY = 800; // ms
      spinnerTimer = window.setTimeout(() => setAutoSyncing(true), SPINNER_DELAY);
      try {
        const res = await fetch("/api/auth/siakad", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (cancelled) return;

        if (data?.success) {
          persistSiakadUser(data);
          // persistSiakadUser emits "siakad-sync"; still refresh in case of server components.
          router.refresh();
        } else if (res.status === 401) {
          router.replace("/");
        }
      } catch {
        // Silent fail; user can manual sync.
      } finally {
        if (!cancelled) {
          if (spinnerTimer) {
            clearTimeout(spinnerTimer);
            spinnerTimer = null;
          }
          setAutoSyncing(false);
          localStorage.removeItem("siakad_sync_inflight_ts");
        }
      }
    };

    // Kick once on mount (debounced by locks)
    void runSync();

    // Optional periodic check (cheap, only triggers if stale)
    const interval = window.setInterval(() => {
      void runSync();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ready, router]);

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Beranda", icon: <LayoutDashboard size={18} /> },
    { href: "/dashboard/jadwal", label: "Jadwal", icon: <Calendar size={18} /> },
    { href: "/dashboard/khs", label: "KHS", icon: <BarChart3 size={18} /> },
    { href: "/dashboard/keuangan", label: "Keuangan", icon: <CreditCard size={18} /> },
    { href: "/dashboard/registrasi", label: "Registrasi", icon: <FileText size={18} /> },
    { href: "/dashboard/dhs", label: "DHS", icon: <BookOpen size={18} /> },
    { href: "/dashboard/dhe", label: "DHE", icon: <UserCircle2 size={18} /> },
  ];

  const handleLogout = () => {
    if (confirm("Keluar dari aplikasi?")) {
      // Preserve manual schedule edits across logout
      const preservedJadwal = localStorage.getItem('user_jadwal');
      localStorage.clear();
      if (preservedJadwal) localStorage.setItem('user_jadwal', preservedJadwal);
      sessionStorage.clear();
      router.push("/");
    }
  };

  if (!ready) return null;

  const activeHref = navItems.find((n) => pathname === n.href)?.href;

  return (
    <div className="min-h-screen text-slate-900">
      <ClassNotification />
      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-slate-700 shadow-sm sm:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka menu"
              type="button"
            >
              <Menu size={18} />
            </button>

            <div className="flex items-center gap-3">
              <div className="hidden h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-indigo-600 text-white shadow-sm sm:flex">
                <LayoutDashboard size={18} />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">SIAKAD Helper</div>
                <div className="text-sm font-extrabold tracking-tight">Dashboard Akademik</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <NotificationsToggle nim={user?.nim || null} />
            </div>
            <button
              type="button"
              onClick={() => setSyncOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-white disabled:opacity-70"
              title="Sinkronkan ulang data via /api/auth/siakad"
              disabled={autoSyncing}
            >
              <RefreshCw size={16} />
              <span className="hidden sm:inline">{autoSyncing ? "Sync..." : "Sinkronisasi"}</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </div>
      </header>

      {/* Layout */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:grid-cols-[240px_1fr] sm:px-6">
        {/* Sidebar desktop */}
        <aside className="hidden sm:block">
          <div className="glass-card rounded-3xl p-4">
            <div className="flex items-center gap-3 rounded-2xl bg-white/60 p-3">
              <Image
                alt="Foto profil"
                src={
                  user?.foto ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || "Mahasiswa")}&background=fff&color=000`
                }
                width={44}
                height={44}
                className="h-11 w-11 rounded-2xl object-cover"
                unoptimized
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold">{user?.name}</div>
                <div className="truncate text-xs font-semibold text-slate-500">
                  {user?.nim} • {user?.prodi}
                </div>
              </div>
            </div>

            <nav className="mt-4 space-y-1">
              {navItems.map((item) => {
                const active = activeHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      active
                        ? "flex items-center gap-3 rounded-2xl bg-slate-900 px-3 py-2.5 text-sm font-bold text-white"
                        : "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/60"
                    }
                  >
                    <span className={active ? "text-white" : "text-slate-500"}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 rounded-2xl bg-white/50 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">API</div>
              <div className="mt-1 text-xs font-semibold text-slate-600">Login & sync: /api/auth/siakad</div>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main key={syncNonce} className="min-w-0 pb-24 sm:pb-0">{children}</main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[82%] max-w-xs glass-card p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-extrabold">Menu</div>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/70"
                onClick={() => setSidebarOpen(false)}
                aria-label="Tutup menu"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/60 p-3">
              <Image
                alt="Foto profil"
                src={
                  user?.foto ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || "Mahasiswa")}&background=fff&color=000`
                }
                width={44}
                height={44}
                className="h-11 w-11 rounded-2xl object-cover"
                unoptimized
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold">{user?.name}</div>
                <div className="truncate text-xs font-semibold text-slate-500">{user?.nim}</div>
              </div>
            </div>

            <nav className="mt-4 space-y-1">
              {navItems.map((item) => {
                const active = activeHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={
                      active
                        ? "flex items-center gap-3 rounded-2xl bg-slate-900 px-3 py-2.5 text-sm font-bold text-white"
                        : "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/60"
                    }
                  >
                    <span className={active ? "text-white" : "text-slate-500"}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />

      <MobileBottomNav onMenu={() => setSidebarOpen(true)} />
    </div>
  );
}
