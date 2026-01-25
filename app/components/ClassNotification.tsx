"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle, X } from "lucide-react";

export default function ClassNotification() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const message = useMemo(
    () => ({
      title: "Sinkronisasi siap",
      body: "Data terbaru sudah bisa kamu lihat di dashboard.",
    }),
    [],
  );

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // Request permission for native notifications
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const showTimer = window.setTimeout(() => setOpen(true), 1500);
    const hideTimer = window.setTimeout(() => setOpen(false), 1500 + 5000);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [mounted]);

  // Function to trigger native notification
  const triggerNativeNotification = async () => {
    if (!('Notification' in window)) return;

    if (Notification.permission !== 'granted') return;

    try {
      // Check if service worker is active
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(message.title, {
          body: message.body,
          icon: '/icon-192x192.png', // Use the PWA icon
          badge: '/icon-192x192.png',
          vibrate: [200, 100, 200], // Vibration pattern
          tag: 'siakad-sync', // Prevent duplicate notifications
          requireInteraction: false,
        } as any);
      } else {
        // Fallback to regular Notification API
        new Notification(message.title, {
          body: message.body,
          icon: '/icon-192x192.png',
          tag: 'siakad-sync',
        });
      }
    } catch (error) {
      console.error('Failed to show native notification:', error);
    }
  };

  useEffect(() => {
    if (open) {
      // Trigger native notification when the component becomes visible
      triggerNativeNotification();
    }
  }, [open]);

  // Unmount after exit animation to avoid blocking clicks.
  const [render, setRender] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    const t = window.setTimeout(() => setRender(false), 250);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!render) return null;

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-4 z-50 w-[min(560px,calc(100vw-1.5rem))] -translate-x-1/2"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={
          "pointer-events-auto relative mx-auto flex items-center gap-3 rounded-[26px] border border-slate-200/60 bg-white/70 px-4 py-3 shadow-[0_10px_30px_-18px_rgba(2,6,23,0.45)] backdrop-blur-xl transition-all duration-300 " +
          (open ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0")
        }
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900/5">
          <Bell className="h-5 w-5 text-slate-700" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[13px] font-black text-slate-900">{message.title}</div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white">
              <CheckCircle className="h-3 w-3" />
              OK
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-600">{message.body}</div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/70 text-slate-700 shadow-sm ring-1 ring-slate-200/70 backdrop-blur hover:bg-white"
          aria-label="Close"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}