"use client";

import { useEffect, useState } from "react";

type PushList = { success: true; total: number; byNim: Record<string, number> } | { success: false; message?: string };

export default function AdminPushPage() {
  const [data, setData] = useState<PushList | null>(null);
  const [nim, setNim] = useState<string>("");
  const [title, setTitle] = useState<string>("Test Push");
  const [body, setBody] = useState<string>("Hello from Siakad Helper");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchList();
  }, []);

  async function fetchList() {
    try {
      const res = await fetch('/api/push/list');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setData({ success: false, message: 'Failed to fetch' });
    }
  }

  async function sendTest(e?: any) {
    if (e) e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const payload = { title, body };
      const res = await fetch('/api/push/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nim: nim || null, payload }) });
      const json = await res.json();
      if (json?.success) setMsg('Sent to subscriptions: ' + (json.sent?.length || 0));
      else setMsg('Send failed: ' + (json?.message || 'unknown'));
    } catch (err: any) {
      setMsg('Error: ' + String(err?.message || err));
    } finally {
      setLoading(false);
      fetchList();
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Admin Push</h1>
      <p className="mt-2 text-sm text-slate-600">List subscriptions stored and test send</p>

      <div className="mt-6">
        <div className="mb-2">Subscriptions summary:</div>
        <pre className="bg-white/80 p-3 rounded border">{data ? JSON.stringify(data, null, 2) : 'Loading...'}</pre>
      </div>

      <form onSubmit={sendTest} className="mt-6 space-y-3">
        <div>
          <label className="block text-sm font-semibold">NIM (leave empty for global)</label>
          <input value={nim} onChange={(e) => setNim(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="block text-sm font-semibold">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="block text-sm font-semibold">Body</label>
          <input value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <button type="submit" disabled={loading} className="rounded bg-slate-900 px-4 py-2 text-white">
            {loading ? 'Sending...' : 'Send Test Push'}
          </button>
          <button type="button" onClick={fetchList} className="ml-2 rounded border px-3 py-2">
            Refresh
          </button>
        </div>
        {msg ? <div className="mt-2 text-sm">{msg}</div> : null}
      </form>
    </div>
  );
}
