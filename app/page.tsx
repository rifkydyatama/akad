"use client"
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    __siakad_toast?: {
      push?: (message: { type: string; message: string }) => void;
    };
  }
}
import { useRouter } from 'next/navigation';
import { GraduationCap, Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { persistSiakadUser } from './lib/persistUser';

export default function LoginPage() {
  const [nim, setNim] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const router = useRouter();

  useEffect(() => {
    try {
      const savedNim = localStorage.getItem('user_nim');
      const savedPassword = localStorage.getItem('user_password');
      if (savedNim && savedPassword) {
        router.replace('/dashboard');
      }
    } catch {
      // ignore storage errors
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg("Sinkronisasi...");
    
    try {
      const res = await fetch('/api/auth/siakad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nim, password }),
      });

      const data = await res.json();
      
      if (data.success) {
        setStatusMsg("Sinkronisasi...");

        // Keep Me Logged In
        localStorage.setItem('user_nim', nim);
        localStorage.setItem('user_password', password);

        persistSiakadUser(data);

        // Masuk Dashboard
        router.push('/dashboard');
      } else {
        // show inline toast
        try { window.__siakad_toast?.push?.({ type: 'error', message: data.message || 'Login Gagal. Cek NIM/Password.' }); } catch {}
        setStatusMsg("");
      }
    } catch {
      try { window.__siakad_toast?.push?.({ type: 'error', message: 'Terjadi kesalahan koneksi. Pastikan server/internet aktif.' }); } catch {}
      setStatusMsg("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-white rounded-4xl p-8 shadow-2xl shadow-slate-200 border border-white relative overflow-hidden">
        
        {/* Hiasan Background */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100 rounded-full blur-3xl -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-100 rounded-full blur-3xl -ml-10 -mb-10"></div>

        <div className="relative z-10 flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-linear-to-tr from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-4 transform rotate-3">
            <GraduationCap className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Portal SIAKAD</h1>
          <p className="text-slate-400 text-xs font-medium mt-1">Sinkronisasi Data Real-Time</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 relative z-10">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">NIM Mahasiswa</label>
            <div className="relative group">
              <User className="absolute left-4 top-3.5 text-slate-300 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="text" placeholder="Masukkan NIM" required
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 rounded-xl border border-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-slate-700 font-bold text-sm"
                onChange={(e) => setNim(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Password</label>
            <div className="relative group">
              <Lock className="absolute left-4 top-3.5 text-slate-300 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="password" placeholder="••••••••" required
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 rounded-xl border border-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-slate-700 font-bold"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full py-4 bg-linear-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-200 hover:shadow-blue-300 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 mt-4 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
                <>
                    <Loader2 className="animate-spin w-4 h-4" />
                    <span>Sinkronisasi...</span>
                </>
            ) : (
                <>
                    <span>Masuk Sekarang</span>
                    <ArrowRight className="w-4 h-4" />
                </>
            )}
          </button>
          
          {/* Status Text untuk Debugging User */}
          {loading && (
              <p className="text-center text-[10px] text-slate-400 animate-pulse mt-2 font-medium">
                  {statusMsg}
              </p>
          )}
        </form>
      </div>
    </div>
  );
}