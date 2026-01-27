import { NextResponse } from 'next/server';
// Return VAPID public key (use env or generate temporary one)
export async function GET() {
  console.log('[push/vapid] GET request');
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  console.log('[push/vapid] env keys present?', !!publicKey, !!privateKey);
  if (!publicKey || !privateKey) {
    // generate ephemeral keys (not persistent across restarts)
    try {
      const webpush = await import('web-push');
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      console.warn('VAPID keys not set in env; generated ephemeral keys');
    } catch (e) {
      console.warn('web-push not available to generate VAPID keys', e);
    }
  }
  console.log('[push/vapid] returning publicKey', publicKey ? 'present' : 'missing');
  return NextResponse.json({ publicKey });
}
