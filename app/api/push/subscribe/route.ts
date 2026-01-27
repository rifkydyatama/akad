import { NextResponse } from 'next/server';
import { saveSubscription } from '../../../lib/pushStore';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nim = null, subscription } = body || {};
    // Log for debugging: incoming subscription payload
    try { console.log('[push/subscribe] incoming', { nim, endpoint: subscription?.endpoint }); } catch (e) { /* ignore */ }
    if (!subscription) return NextResponse.json({ success: false, message: 'missing subscription' }, { status: 400 });
    saveSubscription(nim, subscription);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || String(e) }, { status: 500 });
  }
}
