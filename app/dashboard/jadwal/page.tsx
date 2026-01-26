"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, MapPin, Calendar, Edit2, User } from "lucide-react";
import EditJadwalModal from "@/app/components/EditJadwalModal";
import DashboardShell from "../_components/DashboardShell";

type JadwalItem = {
  matkul?: string;
  hari?: string;
  jam?: string;
  ruang?: string;
  dosen?: string;
  isManual?: boolean;
};

export default function JadwalPage() {
  const [jadwal, setJadwal] = useState<JadwalItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // State untuk Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<JadwalItem | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  useEffect(() => {
    const savedJadwal = localStorage.getItem("user_jadwal");
    if (savedJadwal) {
      try {
        const parsed = JSON.parse(savedJadwal);
        queueMicrotask(() => setJadwal(parsed));
      } catch {
        queueMicrotask(() => setJadwal([]));
      }
    }
    queueMicrotask(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const total = jadwal.length;
    const edited = jadwal.filter((j) => j?.isManual).length;
    return { total, edited };
  }, [jadwal]);

  // Fungsi saat tombol Edit diklik
  const handleEditClick = (item: JadwalItem, index: number) => {
    setSelectedItem(item);
    setSelectedIndex(index);
    setIsModalOpen(true);
  };

  // Fungsi simpan data baru
  const handleSaveJadwal = (newData: JadwalItem) => {
    const updatedJadwal = [...jadwal];
    updatedJadwal[selectedIndex] = { ...newData, isManual: true }; // Tandai sudah diedit
    setJadwal(updatedJadwal);
    localStorage.setItem("user_jadwal", JSON.stringify(updatedJadwal)); // Simpan permanen
    setIsModalOpen(false);
  };

  return (
    <DashboardShell title="Jadwal Kuliah" subtitle="Data dari KRS (bisa kamu edit manual per kelas)">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <Calendar className="h-4 w-4 text-blue-600" />
            Total Kelas
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{stats.total}</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
            <Edit2 className="h-4 w-4 text-emerald-600" />
            Sudah Diedit
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{stats.edited}</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs font-extrabold text-slate-700">Tips</div>
          <div className="mt-2 text-[11px] font-semibold text-slate-600">
            Tap tombol <span className="font-black">Edit</span> di kartu untuk set hari/jam/ruang.
          </div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-5">
        <div className="text-xs font-extrabold text-slate-800">Daftar Jadwal</div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Memuat jadwal...</div>
          ) : jadwal.length === 0 ? (
            <div className="rounded-2xl bg-white/60 p-4 text-xs font-semibold text-slate-600">Belum ada data jadwal. Tekan Sinkronisasi.</div>
          ) : (
            jadwal.map((item, idx) => (
              <div key={idx} className="relative overflow-hidden rounded-3xl bg-white/60 p-5 card-animate">
                <div className={item.isManual ? "absolute left-0 top-0 h-full w-1.5 bg-emerald-500" : "absolute left-0 top-0 h-full w-1.5 bg-blue-500"} />
                {item.isManual ? (
                  <div className="badge-manual">
                    <span className="dot" />MANUAL
                  </div>
                ) : null}

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-900">{item.matkul || "-"}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={item.isManual ? "inline-flex items-center gap-1 rounded-full bg-emerald-50/80 px-2.5 py-1 text-[10px] font-black text-emerald-700" : "inline-flex items-center gap-1 rounded-full bg-orange-50/80 px-2.5 py-1 text-[10px] font-black text-orange-700"}>
                        <Clock className={item.isManual ? "h-3 w-3 text-emerald-600" : "h-3 w-3 text-orange-600"} />
                        {(item.hari || "-") + ", " + (item.jam || "-")}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-700">
                        <MapPin className="h-3 w-3 text-red-600" />
                        {item.ruang || "-"}
                      </span>

                      {item.dosen ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-700">
                          <User className="h-3 w-3 text-blue-600" />
                          <span className="max-w-[18rem] truncate">{item.dosen}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleEditClick(item, idx)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edit
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* MODAL EDIT */}
      {isModalOpen && selectedItem && (
        <EditJadwalModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          data={selectedItem} 
          onSave={handleSaveJadwal}
        />
      )}

    </DashboardShell>
  );
}