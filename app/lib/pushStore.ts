import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type PushSubscriptionRecord = { nim?: string | null; subscription: any; createdAt: number };

// File-backed store path (development / optional)
const FILE = path.join(process.cwd(), 'tmp', 'push-subscriptions.json');

// Allow file-backed store by default to support environments without a DB.
// In production we prefer Supabase (configure via env vars).
const ALLOW_FILE_STORE = true;

let supabase: SupabaseClient | null = null;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    console.log('[pushStore] Supabase client initialized');
  } catch (e) {
    console.warn('[pushStore] Supabase init failed, falling back to file store', e);
    supabase = null;
  }
}

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
  if (!ALLOW_FILE_STORE && !supabase) {
    const msg = 'No push store configured. Enable file store or configure Supabase via SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.';
    console.warn(msg);
    throw new Error(msg);
  }
}

// Table schema (Supabase): table `push_subscriptions` with columns
// id (uuid), nim text nullable, endpoint text unique, subscription jsonb, created_at timestamptz

export async function saveSubscription(nim: string | null, subscription: any) {
  if (supabase) {
    try {
      const endpoint = subscription?.endpoint || null;
      const toInsert = {
        nim: nim || null,
        endpoint,
        subscription,
      } as any;
      // Upsert on endpoint to avoid duplicates
      const { error } = await supabase.from('push_subscriptions').upsert(toInsert, { onConflict: 'endpoint' });
      if (error) {
        console.warn('[pushStore] supabase upsert error', error);
      } else {
        console.log('[pushStore] saved subscription to supabase', endpoint);
      }
      return;
    } catch (e) {
      console.warn('[pushStore] supabase save failed, falling back to file store', e);
    }
  }
  // fallback to file store
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

export async function listSubscriptions(nim?: string | null) {
  if (supabase) {
    try {
      // select nim, subscription, created_at
      let query = supabase.from('push_subscriptions').select('nim, subscription, created_at, endpoint');
      if (nim) {
        // return records where nim matches OR nim IS NULL (global)
        query = query.or(`nim.eq.${nim},nim.is.null`);
      }
      const { data, error } = await query;
      if (error) {
        console.warn('[pushStore] supabase list error', error);
      } else if (Array.isArray(data)) {
        return data.map((r: any) => ({ nim: r.nim || null, subscription: r.subscription, createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now() }));
      }
    } catch (e) {
      console.warn('[pushStore] supabase list failed, falling back to file store', e);
    }
  }
  // fallback to file store
  if (!ALLOW_FILE_STORE) ensureAllowed();
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

export async function removeSubscriptionByEndpoint(endpoint: string) {
  if (supabase) {
    try {
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) console.warn('[pushStore] supabase delete error', error);
      else console.log('[pushStore] removed subscription from supabase', endpoint);
      return;
    } catch (e) {
      console.warn('[pushStore] supabase remove failed, falling back to file store', e);
    }
  }
  ensureAllowed();
  const all = readAll();
  let changed = false;
  for (const k of Object.keys(all)) {
    const filtered = (all[k] || []).filter((r: any) => (r.subscription?.endpoint || '') !== endpoint);
    if (filtered.length !== (all[k] || []).length) changed = true;
    all[k] = filtered;
  }
  if (changed) writeAll(all);
}
