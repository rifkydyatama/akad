import { NextResponse } from 'next/server';
import { listSubscriptions, removeSubscriptionByEndpoint } from '../../../lib/pushStore';

// POST { nim?, payload: { title, body, data }, subject? }
export async function POST(request: Request) {
  try {
    console.log('[push/send] POST received');
    const body = await request.json();
    const { nim = null, payload = {}, subject } = body || {};
    console.log('[push/send] parsed body', { nim, payload });

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const mail = process.env.VAPID_SUBJECT || subject || 'mailto:admin@example.com';

    console.log('[push/send] VAPID keys present?', !!publicKey, !!privateKey);
    if (!publicKey || !privateKey) {
      console.warn('VAPID keys not configured; cannot send push');
      return NextResponse.json({ success: false, message: 'VAPID not configured' }, { status: 500 });
    }

    const webpush = await import('web-push');
    webpush.setVapidDetails(mail, publicKey, privateKey);

    const subs = await listSubscriptions(nim || null);
    console.log('[push/send] found subscriptions', subs.length);
    const results: any[] = [];

    for (const rec of subs) {
      try {
        console.log('[push/send] sending to', rec.subscription.endpoint);
        await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
        results.push({ endpoint: rec.subscription.endpoint, ok: true });
        console.log('[push/send] sent successfully to', rec.subscription.endpoint);
      } catch (err: any) {
        console.log('[push/send] error sending to', rec.subscription.endpoint, err);
        // remove invalid
        results.push({ endpoint: rec.subscription.endpoint, ok: false, error: err?.body || err?.message || String(err) });
        if (rec.subscription && rec.subscription.endpoint) await removeSubscriptionByEndpoint(rec.subscription.endpoint);
      }
    }

    console.log('[push/send] results', results);
    return NextResponse.json({ success: true, sent: results });
  } catch (e: any) {
    console.log('[push/send] error', e);
    return NextResponse.json({ success: false, message: String(e?.message || e) }, { status: 500 });
  }
}