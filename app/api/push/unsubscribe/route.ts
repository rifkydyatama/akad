import { NextResponse } from 'next/server';
import { removeSubscriptionByEndpoint } from '../../../lib/pushStore';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { endpoint } = body;
    if (!endpoint) return NextResponse.json({ success: false, message: 'missing endpoint' }, { status: 400 });

    await removeSubscriptionByEndpoint(endpoint);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: String(err?.message || err) }, { status: 500 });
  }
}
