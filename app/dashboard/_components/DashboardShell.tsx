"use client";

import type { ReactNode } from "react";

export default function DashboardShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-3xl px-5 py-4">
        <div className="text-sm font-black tracking-tight text-slate-900">{title}</div>
        {subtitle ? <div className="mt-1 text-xs font-semibold text-slate-600">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}
