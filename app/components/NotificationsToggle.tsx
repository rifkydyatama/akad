"use client";

import { useEffect, useState } from "react";
import { registerServiceWorker, requestNotificationPermission } from "../lib/notifications";
import { subscribeToPush, unsubscribePush } from "../lib/pushClient";

export default function NotificationsToggle({ nim }: { nim?: string | null }) {
  const [granted, setGranted] = useState<boolean>(false);
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setGranted(typeof Notification !== 'undefined' && Notification.permission === 'granted');
    // check existing subscription
    (async () => {
      if (!('serviceWorker' in navigator)) return;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const s = reg ? await reg.pushManager.getSubscription() : null;
        setSubscribed(!!s);
      } catch {}
    })();
  }, []);

  async function enable() {
    setLoading(true);
    try {
      await registerServiceWorker();
      const perm = await requestNotificationPermission();
      setGranted(perm === 'granted');
      if (perm === 'granted') {
        const sub = await subscribeToPush(nim || null);
        setSubscribed(!!sub);
      }
    } finally { setLoading(false); }
  }

  async function disable() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const s = reg ? await reg.pushManager.getSubscription() : null;
      const ok = await unsubscribePush(s || null);
      if (ok) setSubscribed(false);
    } finally { setLoading(false); }
  }

  return (
    <div>
      <div className="text-sm">Notifikasi: {granted ? 'Diizinkan' : 'Belum diizinkan'}</div>
      <div className="mt-2">
        {subscribed ? (
          <button onClick={disable} disabled={loading} className="rounded border px-3 py-1">{loading ? 'Processing...' : 'Matikan Notifikasi'}</button>
        ) : (
          <button onClick={enable} disabled={loading} className="rounded bg-slate-900 px-3 py-1 text-white">{loading ? 'Processing...' : 'Nyalakan Notifikasi'}</button>
        )}
      </div>
    </div>
  );
}
