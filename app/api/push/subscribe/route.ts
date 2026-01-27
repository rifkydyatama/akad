import { NextResponse } from 'next/server';
import { saveSubscription } from '../../../lib/pushStore';

export async function POST(request: Request) {
  try {
    console.log('[push/subscribe] POST received');
    const body = await request.json();
    const { nim = null, subscription } = body || {};
    console.log('[push/subscribe] parsed body', { nim, hasSubscription: !!subscription, endpoint: subscription?.endpoint });
    // Log for debugging: incoming subscription payload
    try { console.log('[push/subscribe] incoming', { nim, endpoint: subscription?.endpoint }); } catch (e) { /* ignore */ }
    if (!subscription) {
      console.log('[push/subscribe] missing subscription');
      return NextResponse.json({ success: false, message: 'missing subscription' }, { status: 400 });
    }
    console.log('[push/subscribe] saving subscription');
    saveSubscription(nim, subscription);
    console.log('[push/subscribe] saved successfully');
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.log('[push/subscribe] error', e);
    return NextResponse.json({ success: false, message: e?.message || String(e) }, { status: 500 });
  }
}
