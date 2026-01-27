import fs from 'fs';
import path from 'path';

export type PushSubscriptionRecord = { nim?: string | null; subscription: any; createdAt: number };

// File-backed store path (development / optional)
const FILE = path.join(process.cwd(), 'tmp', 'push-subscriptions.json');

// Allow file-backed store by default to support environments without a DB.
// In production this is not recommended; we warn but still allow it per user request.
const ALLOW_FILE_STORE = true;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): Record<string, PushSubscriptionRecord[]> {
  if (!ALLOW_FILE_STORE) return {};
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, PushSubscriptionRecord[]>) {
  if (!ALLOW_FILE_STORE) return;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // ignore
  }
}

function ensureAllowed() {
  if (!ALLOW_FILE_STORE) {
    const msg = 'File-backed push store is disabled in production. Set PUSH_STORE=file to enable, or configure an external DB (e.g. Postgres) and implement a DB-backed pushStore.';
    console.warn(msg);
    throw new Error(msg);
  }
}

export function saveSubscription(nim: string | null, subscription: any) {
  ensureAllowed();
  const key = String(nim || '__all__');
  console.log('[pushStore] saving subscription for key', key, 'endpoint', subscription?.endpoint);
  const all = readAll();
  const arr = all[key] || [];
  arr.push({ nim, subscription, createdAt: Date.now() });
  all[key] = arr;
  writeAll(all);
  console.log('[pushStore] saved, total subscriptions', Object.values(all).flat().length);
}

export function listSubscriptions(nim?: string | null) {
  // in production, prefer DB-backed store; this will return file contents only if allowed
  if (!ALLOW_FILE_STORE) {
    ensureAllowed();
  }
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
  ensureAllowed();
  const all = readAll();
  let changed = false;
  for (const k of Object.keys(all)) {
    const filtered = (all[k] || []).filter(r => (r.subscription?.endpoint || '') !== endpoint);
    if (filtered.length !== (all[k] || []).length) changed = true;
    all[k] = filtered;
  }
  if (changed) writeAll(all);
}
