export type ScheduledTimer = { id: number };

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function now() { return Date.now(); }

function safeParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'denied';
  const p = await Notification.requestPermission();
  return p;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.fixed.js');
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn('SW register failed', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPush(nim?: string | null) {
  try {
    const reg = await registerServiceWorker();
    if (!reg) return null;
    const resp = await fetch('/api/push/vapid');
    const body = await resp.json();
    const publicKey = body?.publicKey;
    if (!publicKey) return null;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, 
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    // send to server
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nim: nim || null, subscription: sub }) });
    return sub;
  } catch (err) {
    console.warn('subscribeToPush failed', err);
    return null;
  }
}

declare global {
  interface Window { __siakad_timers?: Array<{ id: number }>; }
}

function clearScheduledTimers() {
  // store timers on global window to clear between syncs
  const win = window as Window & { __siakad_timers?: Array<{ id: number }> };
  if (win.__siakad_timers && Array.isArray(win.__siakad_timers)) {
    for (const t of win.__siakad_timers) {
      try { clearTimeout(t.id); } catch { /* ignore */ }
    }
  }
  win.__siakad_timers = [];
}

async function showNotification(title: string, body: string, tag?: string) {
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      // `showNotification` accepts NotificationOptions; avoid properties not widely typed
      reg.showNotification(title, { body, tag });
    } else if ('Notification' in window) {
      // Fallback to the Notification constructor
      new Notification(title, { body, tag });
    }
  } catch {
    try { new Notification(title, { body, tag }); } catch { /* ignore */ }
  }
}

export async function scheduleNotificationsFromLocalStorage() {
  if (typeof window === 'undefined') return;
  // Throttle notifications: don't repeat same type more than once per 6 hours
  const THROTTLE_MS = 1000 * 60 * 60 * 6; // 6 hours

  // Clear previous timers
  clearScheduledTimers();

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const lastNotRaw = localStorage.getItem('siakad_last_notif_ts');
  const lastNot = safeParse<Record<string, number>>(lastNotRaw, {}) || {};

  // KEUANGAN: notify if there are unpaid items
  const keuTotals = safeParse<Record<string, number> | null>(localStorage.getItem('user_keuangan_totals'), null);
  const unpaidCount = (keuTotals && typeof keuTotals.unpaidCount === 'number') ? keuTotals.unpaidCount : 0;
  const unpaidAmount = (keuTotals && typeof keuTotals.ukt === 'number') ? (keuTotals.ukt - ((keuTotals.totalPaid as number) || 0)) : null;
  if (unpaidCount > 0) {
    const last = lastNot['keuangan'] || 0;
    if (now() - last > THROTTLE_MS) {
      await showNotification('Tagihan Keuangan', `Anda memiliki ${unpaidCount} tagihan belum dibayar${unpaidAmount ? ` (Rp ${unpaidAmount.toLocaleString()})` : ''}` , 'siakad_keuangan');
      lastNot['keuangan'] = now();
    }
  }

  // JADWAL HARI INI: show summary immediately and schedule 30-min reminders
  const jadwal = safeParse<Array<Record<string, unknown>>>(localStorage.getItem('user_jadwal'), []);
  const todayName = DAY_NAMES[new Date().getDay()];
  const todayList = (jadwal || []).filter(j => (String(j.hari || '')).toLowerCase().includes(todayName.toLowerCase()));
  if (todayList.length > 0) {
    const last = lastNot['jadwal_today'] || 0;
    if (now() - last > THROTTLE_MS) {
      await showNotification('Jadwal Hari Ini', `Anda memiliki ${todayList.length} mata kuliah hari ini.`, 'siakad_jadwal_today');
      lastNot['jadwal_today'] = now();
    }

    // Schedule 30-minute reminders for classes that have a time in HH:MM
    const win = window as Window & { __siakad_timers?: Array<{ id: number }> };
    win.__siakad_timers = win.__siakad_timers || [];
    const getStringField = (it: Record<string, unknown>, ...keys: string[]) => {
      for (const k of keys) {
        const v = it[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number') return String(v);
      }
      return '-';
    };

    for (const item of todayList as Array<Record<string, unknown>>) {
      const jam = String(item.jam || '').match(/(\d{1,2}:\d{2})/);
      if (!jam) continue;
      const time = jam[1];
      const [hh, mm] = time.split(':').map(Number);
      const nowDate = new Date();
      const classDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hh, mm, 0, 0);
      const remindAt = classDate.getTime() - (1000 * 60 * 30);
      const ms = remindAt - now();
      if (ms <= 0) continue; // skip past
      const id = setTimeout(() => {
        const title = 'Pengingat Kuliah';
        const matkul = getStringField(item as Record<string, unknown>, 'matkul', 'name');
        const ruang = getStringField(item as Record<string, unknown>, 'ruang');
        showNotification(title, `Mata kuliah ${matkul} dimulai dalam 30 menit di ${ruang} (Jam ${time})`, 'siakad_reminder_30');
      }, ms) as unknown as number;
      win.__siakad_timers.push({ id });
    }
  }

  // Persist last notification timestamps
  localStorage.setItem('siakad_last_notif_ts', JSON.stringify(lastNot));
}

export function clearNotificationsAndTimers() {
  clearScheduledTimers();
  localStorage.removeItem('siakad_last_notif_ts');
}
