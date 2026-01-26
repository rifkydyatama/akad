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

import { scheduleNotificationsFromLocalStorage, registerServiceWorker, clearNotificationsAndTimers, requestNotificationPermission } from "./notifications";
import { subscribeToPush, unsubscribePush } from "./pushClient";

export function persistSiakadUser(data: SiakadAuthPayload) {
  // Don't clear the whole storage; preserve app state like last-sync timestamp.
  const lastSync = localStorage.getItem("siakad_last_sync_ts");
  const existingJadwal = localStorage.getItem("user_jadwal");
  const existingKeuTotalsRaw = localStorage.getItem("user_keuangan_totals");

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
  const incomingJadwal = Array.isArray(data.jadwal) ? (data.jadwal as any[]) : null;
  if (incomingJadwal && incomingJadwal.length > 0) {
    // Merge incoming jadwal with existing manual edits in localStorage
    try {
      const prev = existingJadwal ? JSON.parse(existingJadwal) : [];
      const normalize = (s: unknown) => String(s || '').toLowerCase().replace(/[\s\-_.()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

      const mapIndex = new Map<string, number>();
      const merged: any[] = [];

      // Index previous items (to preserve manual edits)
      (prev || []).forEach((p: any, i: number) => {
        const key = normalize(p.code || p.matkul || p.name || p);
        mapIndex.set(key, i);
        merged.push(p);
      });

      for (const item of incomingJadwal) {
        const key = normalize(item.code || item.matkul || item.name || item);
        const idx = mapIndex.get(key);
        if (typeof idx === 'number') {
          const existing = merged[idx] || {};
          // Preserve manual flag and any manually edited fields
          const isManual = existing.isManual || false;
          if (isManual) {
            // If user manually edited this entry, only replace it when the course/KRS changed
            const existingCode = normalize(existing.code || existing.matkul || existing.name || '');
            const incomingCode = normalize(item.code || item.matkul || item.name || '');
            const existingSks = Number(existing.sks || 0);
            const incomingSks = Number(item.sks || 0);
            const courseChanged = existingCode !== incomingCode || existingSks !== incomingSks;
            if (courseChanged) {
              // course/KRS changed — accept the new scraped entry and clear manual flag
              merged[idx] = { ...item, isManual: false };
            } else {
              // keep existing manual edits intact (but ensure dosen present)
              merged[idx] = { ...existing, dosen: existing.dosen || item.dosen };
            }
          } else {
            // merge scraped data over existing
            merged[idx] = { ...item, ...existing, isManual: existing.isManual || false };
          }
        } else {
          // new item
          merged.push({ ...item, isManual: false });
        }
      }

      localStorage.setItem("user_jadwal", JSON.stringify(merged));
    } catch {
      localStorage.setItem("user_jadwal", JSON.stringify(incomingJadwal));
    }
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
    // Non-blocking: try to register service worker and request permission, then schedule notifications
    (async () => {
      try {
        await registerServiceWorker();
        const perm = await requestNotificationPermission();
        if (perm === 'granted') {
          // schedule local notifications and attempt push subscription
          scheduleNotificationsFromLocalStorage();
          try { await subscribeToPush(localStorage.getItem('user_nim') || null); } catch {}
        }
      } catch (e) {
        console.warn('notification init failed', e);
      }
    })();
  }

  // Server push trigger: if unpaid count appeared/changed, notify subscribed clients (throttled)
  try {
    const THROTTLE_MS = 1000 * 60 * 60 * 6; // 6 hours
    const prev = existingKeuTotalsRaw ? JSON.parse(existingKeuTotalsRaw) : {};
    const newTotalsRaw = localStorage.getItem('user_keuangan_totals');
    const current = newTotalsRaw ? JSON.parse(newTotalsRaw) : {};
    const prevUnpaid = Number(prev.unpaidCount) || 0;
    const newUnpaid = Number(current.unpaidCount) || 0;
    const unpaidAmount = typeof current.ukt === 'number' && typeof current.totalPaid === 'number' ? Math.max(0, current.ukt - current.totalPaid) : null;
    const lastNotRaw = localStorage.getItem('siakad_last_notif_ts');
    const lastNot = lastNotRaw ? JSON.parse(lastNotRaw) : {};
    const lastKeu = Number(lastNot['keuangan'] || 0);

    if (newUnpaid > 0 && (prevUnpaid === 0 || newUnpaid !== prevUnpaid) && Date.now() - lastKeu > THROTTLE_MS) {
      // send server push to subscriptions for this user (nim)
      try {
        const payload = {
          title: 'Tagihan Keuangan',
          body: `Anda memiliki ${newUnpaid} tagihan belum dibayar${unpaidAmount ? ` (Rp ${unpaidAmount.toLocaleString()})` : ''}`,
        };
        void fetch('/api/push/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nim: data.nim || null, payload }) })
          .then(() => {
            // update throttle timestamp on success
            lastNot['keuangan'] = Date.now();
            localStorage.setItem('siakad_last_notif_ts', JSON.stringify(lastNot));
          })
          .catch(() => {
            // ignore send errors
          });
      } catch (e) {
        // ignore send errors
      }
    }
  } catch {}
}
