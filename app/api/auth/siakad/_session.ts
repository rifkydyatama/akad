type SerializableCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export type SiakadSession = {
  token: string;
  nim: string;
  cookies: SerializableCookie[];
  createdAt: number;
  updatedAt: number;
};

type InflightValue<T> = {
  startedAt: number;
  promise: Promise<T>;
};

type SharedResult =
  | { kind: 'value'; value: unknown }
  | {
      kind: 'response';
      status: number;
      statusText: string;
      headers: Array<[string, string]>;
      setCookie?: string[];
      body: Uint8Array;
    };

const sessions = new Map<string, SiakadSession>();
const inflight = new Map<string, InflightValue<SharedResult>>();

function isResponse(value: unknown): value is Response {
  return (
    typeof value === 'object' &&
    value !== null &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (value as any).arrayBuffer === 'function' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (value as any).headers === 'object' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (value as any).status === 'number'
  );
}

function sharedResultToReturn<T>(shared: SharedResult): T {
  if (shared.kind === 'value') return shared.value as T;

  const headers = new Headers(shared.headers);
  if (shared.setCookie?.length) {
    for (const v of shared.setCookie) headers.append('set-cookie', v);
  }

  // Use Buffer for Node.js environment
  const body = Buffer.from(shared.body);

  return new Response(body, {
    status: shared.status,
    statusText: shared.statusText,
    headers,
  }) as unknown as T;
}

function randomToken() {
  // Good enough for a local/dev session token; avoids Node crypto import issues in some runtimes.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getSession(token: string | undefined | null): SiakadSession | null {
  if (!token) return null;
  return sessions.get(token) ?? null;
}

export function createSession(nim: string, cookies: SerializableCookie[]): SiakadSession {
  const now = Date.now();
  const session: SiakadSession = {
    token: randomToken(),
    nim,
    cookies,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.token, session);
  return session;
}

export function updateSession(token: string, cookies: SerializableCookie[]): SiakadSession | null {
  const existing = sessions.get(token);
  if (!existing) return null;
  const updated: SiakadSession = { ...existing, cookies, updatedAt: Date.now() };
  sessions.set(token, updated);
  return updated;
}

export function cleanupSessions(maxAgeMs = 12 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.updatedAt > maxAgeMs) sessions.delete(token);
  }
}

export async function dedupeInflight<T>(
  key: string,
  fn: () => Promise<T>,
  maxAgeMs = 10 * 60 * 1000,
): Promise<T> {
  const now = Date.now();
  const existing = inflight.get(key);
  if (existing && now - existing.startedAt < maxAgeMs) {
    const shared = await existing.promise;
    return sharedResultToReturn<T>(shared);
  }

  const entry: InflightValue<SharedResult> = {
    startedAt: now,
    promise: Promise.resolve()
      .then(fn)
      .then(async (result): Promise<SharedResult> => {
        if (!isResponse(result)) return { kind: 'value', value: result };

        const headers = Array.from(result.headers.entries()).filter(
          ([k]) => k.toLowerCase() !== 'set-cookie',
        );

        // Preserve multiple Set-Cookie headers when available (Node/Undici extension).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const setCookie = (result.headers as any).getSetCookie?.() as string[] | undefined;

        const body = new Uint8Array(await result.arrayBuffer());

        return {
          kind: 'response',
          status: result.status,
          statusText: result.statusText,
          headers,
          setCookie,
          body,
        };
      }),
  };

  inflight.set(key, entry);

  entry.promise.finally(() => {
    const cur = inflight.get(key);
    if (cur === entry) inflight.delete(key);
  });

  const shared = await entry.promise;
  return sharedResultToReturn<T>(shared);
}
