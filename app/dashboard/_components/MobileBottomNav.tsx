"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Calendar, CreditCard, LayoutDashboard, Menu, BarChart3, Sun, Bell } from "lucide-react";
import { subscribeToPush } from "../../lib/pushClient";
import { useToast } from "../../components/ToastProvider";

type Item = {
  href?: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
};

export default function MobileBottomNav({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const toast = useToast();
  const [hidden, setHidden] = useState(false);
  const items: Item[] = [
    { href: "/dashboard", label: "Beranda", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/jadwal", label: "Jadwal", icon: <Calendar className="h-5 w-5" /> },
    { href: "/dashboard/khs", label: "KHS", icon: <BarChart3 className="h-5 w-5" /> },
    { href: "/dashboard/keuangan", label: "Keuangan", icon: <CreditCard className="h-5 w-5" /> },
    { label: "Tema", icon: <Sun className="h-5 w-5" />, onClick: () => {
        // toggle theme for mobile
        try {
          const root = document.documentElement;
          const isDark = root.classList.contains('theme-dark');
          if (isDark) { root.classList.remove('theme-dark'); localStorage.setItem('theme','light'); }
          else { root.classList.add('theme-dark'); localStorage.setItem('theme','dark'); }
        } catch (e) { /* ignore */ }
      } },
    { label: "Notifikasi", icon: <Bell className="h-5 w-5" />, onClick: async () => {
        try {
          const nim = typeof window !== 'undefined' ? localStorage.getItem('user_nim') : null;
          const sub = await subscribeToPush(nim || null);
          if (sub) toast.push({ type: 'success', message: 'Notifikasi aktif' }); else toast.push({ type: 'error', message: 'Notifikasi tidak dapat diaktifkan' });
        } catch (e) { toast.push({ type: 'error', message: 'Gagal mengaktifkan notifikasi' }); }
      } },
    { label: "Menu", icon: <Menu className="h-5 w-5" />, onClick: onMenu },
  ];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - lastY;
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (delta > 10) setHidden(true); // scrolling down
          else if (delta < -10) setHidden(false); // scrolling up
          lastY = current;
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className="fixed bottom-3 left-3 right-3 z-50 sm:hidden" style={{ transform: hidden ? 'translateY(120%)' : 'translateY(0)', transition: 'transform 220ms cubic-bezier(.2,.9,.2,1), opacity 220ms ease', opacity: hidden ? 0 : 1 }}>
      <div className="glass-card rounded-3xl p-2" style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.href ? pathname === item.href : false;
          const base =
            "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-black";
          const cls = active ? `${base} bg-slate-900 text-white` : `${base} text-slate-700 hover:bg-white/60`;

          if (item.href) {
            return (
              <Link key={item.label} href={item.href} className={cls}>
                <span className={active ? "text-white" : "text-slate-500"}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          }

          return (
            <button key={item.label} type="button" onClick={item.onClick} className={cls}>
              <span className={active ? "text-white" : "text-slate-500"}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
