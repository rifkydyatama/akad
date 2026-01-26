import fs from 'fs';
import path from 'path';

export type PushSubscriptionRecord = { nim?: string | null; subscription: any; createdAt: number };

const FILE = path.join(process.cwd(), 'tmp', 'push-subscriptions.json');

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): Record<string, PushSubscriptionRecord[]> {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, PushSubscriptionRecord[]>) {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // ignore
  }
}

export function saveSubscription(nim: string | null, subscription: any) {
  const key = String(nim || '__all__');
  const all = readAll();
  const arr = all[key] || [];
  arr.push({ nim, subscription, createdAt: Date.now() });
  all[key] = arr;
  writeAll(all);
}

export function listSubscriptions(nim?: string | null) {
  const all = readAll();
  const out: PushSubscriptionRecord[] = [];
  if (nim) {
    const a = all[String(nim)] || [];
    out.push(...a);
  }
  // include global
  const g = all['__all__'] || [];
  out.push(...g);
  return out;
}

export function removeSubscriptionByEndpoint(endpoint: string) {
  const all = readAll();
  let changed = false;
  for (const k of Object.keys(all)) {
    const filtered = (all[k] || []).filter(r => (r.subscription?.endpoint || '') !== endpoint);
    if (filtered.length !== (all[k] || []).length) changed = true;
    all[k] = filtered;
  }
  if (changed) writeAll(all);
}
