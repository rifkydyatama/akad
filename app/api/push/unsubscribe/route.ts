import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const DB = path.resolve(process.cwd(), 'tmp', 'push-subscriptions.json');

function readAll() {
  if (!existsSync(DB)) return {};
  try { return JSON.parse(readFileSync(DB, 'utf-8') || '{}'); } catch (e) { return {}; }
}

function writeAll(data: any) {
  writeFileSync(DB, JSON.stringify(data, null, 2), 'utf-8');
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { endpoint } = body;
    if (!endpoint) return NextResponse.json({ success: false, message: 'missing endpoint' }, { status: 400 });

    const all = readAll();
    let removed = 0;
    for (const nim of Object.keys(all)) {
      const arr = all[nim] || [];
      const filtered = arr.filter((s: any) => s.endpoint !== endpoint);
      if (filtered.length !== arr.length) {
        all[nim] = filtered;
        removed++;
      }
    }
    writeAll(all);
    return NextResponse.json({ success: true, removed });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: String(err?.message || err) }, { status: 500 });
  }
}
