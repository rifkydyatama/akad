"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Calendar, CreditCard, LayoutDashboard, Menu, BarChart3 } from "lucide-react";

type Item = {
  href?: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
};

export default function MobileBottomNav({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();

  const items: Item[] = [
    { href: "/dashboard", label: "Beranda", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/jadwal", label: "Jadwal", icon: <Calendar className="h-5 w-5" /> },
    { href: "/dashboard/khs", label: "KHS", icon: <BarChart3 className="h-5 w-5" /> },
    { href: "/dashboard/keuangan", label: "Keuangan", icon: <CreditCard className="h-5 w-5" /> },
    { label: "Menu", icon: <Menu className="h-5 w-5" />, onClick: onMenu },
  ];

  return (
    <nav className="fixed bottom-3 left-3 right-3 z-50 sm:hidden">
      <div className="glass-card grid grid-cols-5 rounded-3xl p-2">
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
