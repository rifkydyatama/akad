"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { persistSiakadUser } from "../../lib/persistUser";

export default function SyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const nim = typeof window === "undefined" ? "" : localStorage.getItem("user_nim") || "";

  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSync = async () => {
    if (!nim) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/siakad", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        // Sync tanpa password: pakai HttpOnly cookie session dari login sebelumnya.
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success) {
        persistSiakadUser(data);
        router.refresh();
        onClose();
      } else {
        const msg = data.message || "Sinkronisasi gagal.";
        alert(msg);
        if (res.status === 401) {
          router.push("/");
        }
      }
    } catch {
      alert("Terjadi kesalahan koneksi ke server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md glass-card rounded-3xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold">Sinkronisasi Data</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Ambil ulang data dari <span className="font-bold">siakad.um.ac.id</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/70"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 rounded-2xl bg-white/60 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">NIM</div>
          <div className="mt-1 text-sm font-extrabold text-slate-900">{nim || "-"}</div>
        </div>

        <div className="mt-4 rounded-2xl bg-white/60 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Mode</div>
          <div className="mt-1 text-sm font-extrabold text-slate-900">Real-time (Session)</div>
          <div className="mt-1 text-[11px] font-semibold text-slate-600">
            Tidak perlu input password lagi. Jika sesi habis, kamu akan diminta login ulang.
          </div>
        </div>

        <button
          type="button"
          onClick={handleSync}
          disabled={loading}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200/70 hover:bg-blue-700 disabled:opacity-70"
        >
          <RefreshCw size={16} />
          {loading ? "Sinkronisasi..." : "Sinkronkan Sekarang"}
        </button>
      </div>
    </div>
  );
}
