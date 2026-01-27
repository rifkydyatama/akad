import { NextResponse } from 'next/server';
import { listSubscriptions } from '../../../lib/pushStore';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const nim = url.searchParams.get('nim');
    const subs = listSubscriptions(nim || undefined);
    return NextResponse.json({ success: true, count: subs.length, subscriptions: subs });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || String(e) }, { status: 500 });
  }
}
