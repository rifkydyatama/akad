import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const file = path.join(process.cwd(), 'tmp', 'push-subscriptions.json');
    if (!existsSync(file)) return NextResponse.json({ success: true, total: 0, byNim: {} });
    const raw = readFileSync(file, 'utf8') || '{}';
    const all = JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>;
    const byNim: Record<string, number> = {};
    let total = 0;
    for (const k of Object.keys(all)) {
      const count = (all[k] || []).length;
      byNim[k] = count;
      total += count;
    }
    return NextResponse.json({ success: true, total, byNim });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || String(e) }, { status: 500 });
  }
}
