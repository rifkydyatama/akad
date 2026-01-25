export type SiakadAuthPayload = {
  success: boolean;
  nim: string;
  profile?: {
    name?: string;
    prodi?: string;
    fakultas?: string;
    dosenPa?: string;
    status?: string;
    jalur?: string;
    foto?: string | null;
  };
  keuangan?: unknown;
  registrasi?: unknown;
  khs?: unknown;
  dhs?: unknown;
  jadwal?: unknown;
  dhe?: unknown;
  message?: string;
};

export function persistSiakadUser(data: SiakadAuthPayload) {
  // Don't clear the whole storage; preserve app state like last-sync timestamp.
  const lastSync = localStorage.getItem("siakad_last_sync_ts");
  const existingJadwal = localStorage.getItem("user_jadwal");

  // Remove only known keys to avoid nuking unrelated app settings.
  const keysToClear = [
    "user_nim",
    "user_name",
    "user_prodi",
    "user_fakultas",
    "user_dosen",
    "user_status",
    "user_jalur",
    "user_foto",
    "user_keuangan",
    "user_keuangan_master",
    "user_keuangan_riwayat",
    "user_keuangan_totals",
    "user_registrasi",
    "user_khs",
    "user_dhs",
    "user_jadwal",
    "user_dhe",
  ];
  for (const k of keysToClear) localStorage.removeItem(k);
  sessionStorage.clear();

  localStorage.setItem("user_nim", data.nim);
  localStorage.setItem("user_name", data.profile?.name ?? "Mahasiswa");
  localStorage.setItem("user_prodi", data.profile?.prodi ?? "-");
  localStorage.setItem("user_fakultas", data.profile?.fakultas ?? "-");
  localStorage.setItem("user_dosen", data.profile?.dosenPa ?? "-");
  localStorage.setItem("user_status", data.profile?.status ?? "-");
  localStorage.setItem("user_jalur", data.profile?.jalur ?? "-");

  if (data.profile?.foto) {
    localStorage.setItem("user_foto", data.profile.foto);
  }

  // Keuangan can be either legacy array or new object payload.
  const keu = data.keuangan as unknown;
  if (keu && typeof keu === "object" && "riwayat" in (keu as Record<string, unknown>)) {
    const obj = keu as {
      master?: unknown;
      riwayat?: unknown;
      totals?: unknown;
    };
    localStorage.setItem("user_keuangan_master", JSON.stringify(obj.master ?? {}));
    localStorage.setItem("user_keuangan_riwayat", JSON.stringify(obj.riwayat ?? []));
    localStorage.setItem("user_keuangan_totals", JSON.stringify(obj.totals ?? {}));
    // Keep legacy key pointing to riwayat for older components.
    localStorage.setItem("user_keuangan", JSON.stringify(obj.riwayat ?? []));
  } else {
    localStorage.setItem("user_keuangan", JSON.stringify(data.keuangan ?? []));
  }
  localStorage.setItem("user_registrasi", JSON.stringify(data.registrasi ?? []));
  localStorage.setItem("user_khs", JSON.stringify(data.khs ?? {}));
  localStorage.setItem("user_dhs", JSON.stringify(data.dhs ?? {}));
  // If scraper returns empty jadwal, keep the existing jadwal (often user-edited).
  const incomingJadwal = Array.isArray(data.jadwal) ? (data.jadwal as unknown[]) : null;
  if (incomingJadwal && incomingJadwal.length > 0) {
    localStorage.setItem("user_jadwal", JSON.stringify(incomingJadwal));
  } else if (existingJadwal) {
    localStorage.setItem("user_jadwal", existingJadwal);
  } else {
    localStorage.setItem("user_jadwal", JSON.stringify([]));
  }
  localStorage.setItem("user_dhe", JSON.stringify(data.dhe ?? []));

  // Update last sync timestamp
  localStorage.setItem("siakad_last_sync_ts", String(Date.now()));
  if (lastSync) {
    // Keep previous value if something relies on it, but we still overwrite with now.
    // Intentionally no-op: stored above.
  }

  // Notify current tab listeners that new data is available.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("siakad-sync"));
  }
}
