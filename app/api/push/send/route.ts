import { NextResponse } from 'next/server';
import { listSubscriptions, removeSubscriptionByEndpoint } from '../../../lib/pushStore';

// POST { nim?, payload: { title, body, data }, subject? }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nim = null, payload = {}, subject } = body || {};

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const mail = process.env.VAPID_SUBJECT || subject || 'mailto:admin@example.com';

    if (!publicKey || !privateKey) {
      console.warn('VAPID keys not configured; cannot send push');
      return NextResponse.json({ success: false, message: 'VAPID not configured' }, { status: 500 });
    }

    const webpush = await import('web-push');
    webpush.setVapidDetails(mail, publicKey, privateKey);

    const subs = listSubscriptions(nim || null);
    const results: any[] = [];

    for (const rec of subs) {
      try {
        await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
        results.push({ endpoint: rec.subscription.endpoint, ok: true });
      } catch (err: any) {
        // remove invalid
        results.push({ endpoint: rec.subscription.endpoint, ok: false, error: err?.body || err?.message || String(err) });
        if (rec.subscription && rec.subscription.endpoint) removeSubscriptionByEndpoint(rec.subscription.endpoint);
      }
    }

    return NextResponse.json({ success: true, sent: results });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || String(e) }, { status: 500 });
  }
}
