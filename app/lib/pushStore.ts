export type PushSubscriptionRecord = { nim?: string | null; subscription: any; createdAt: number };

const STORE_KEY = '__siakad_push_store';

// In-memory store. Note: non-persistent across server restarts.
const map = new Map<string, PushSubscriptionRecord[]>();

export function saveSubscription(nim: string | null, subscription: any) {
  const key = String(nim || '__all__');
  const arr = map.get(key) || [];
  arr.push({ nim, subscription, createdAt: Date.now() });
  map.set(key, arr);
}

export function listSubscriptions(nim?: string | null) {
  const out: PushSubscriptionRecord[] = [];
  if (nim) {
    const a = map.get(String(nim)) || [];
    out.push(...a);
  }
  // include global
  const g = map.get('__all__') || [];
  out.push(...g);
  return out;
}

export function removeSubscriptionByEndpoint(endpoint: string) {
  for (const [k, arr] of map.entries()) {
    const filtered = arr.filter(r => (r.subscription?.endpoint || '') !== endpoint);
    map.set(k, filtered);
  }
}
