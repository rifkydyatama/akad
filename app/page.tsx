"use client"
import { useState } from 'react';
import { Lock, User, GraduationCap } from 'lucide-react';

export default function LoginPage() {
  const [nim, setNim] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center p-6">
      <div className="max-w-sm mx-auto w-full">
        {/* Logo/Icon UM */}
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 bg-blue-600 rounded-[24px] flex items-center justify-center shadow-2xl shadow-blue-200">
            <GraduationCap className="text-white w-10 h-10" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Portal Istimewa</h2>
        <p className="text-slate-500 text-center text-sm mb-10">Gunakan akun SIAKAD UM kamu untuk masuk</p>

        <div className="space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-4 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="NIM" 
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={nim}
              onChange={(e) => setNim(e.target.value)}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-4 text-slate-400 w-5 h-5" />
            <input 
              type="password" 
              placeholder="Password" 
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all transform active:scale-[0.98]">
            Login Sekarang
          </button>
        </div>
      </div>
    </div>
  );
}