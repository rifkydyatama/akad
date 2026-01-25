"use client"
import { useState } from 'react';
import { X, Save, Clock, MapPin, Calendar } from 'lucide-react';

type JadwalFormData = {
  matkul?: string;
  hari?: string;
  jam?: string;
  ruang?: string;
  dosen?: string;
  isManual?: boolean;
};

export default function EditJadwalModal({
  isOpen,
  onClose,
  data,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: JadwalFormData;
  onSave: (next: JadwalFormData) => void;
}) {
  const [formData, setFormData] = useState(data);

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-4xl p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-lg text-slate-800">Edit Jadwal</h3>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-1 block">Mata Kuliah</label>
            <div className="p-4 bg-slate-50 rounded-2xl font-bold text-slate-700 text-sm border border-slate-100">
              {formData.matkul}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-1 block">Hari</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400" />
                <select 
                  value={formData.hari}
                  onChange={(e) => setFormData({...formData, hari: e.target.value})}
                  className="w-full pl-9 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                >
                  {['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'].map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-1 block">Jam Mulai</label>
              <div className="relative">
                <Clock size={16} className="absolute left-3 top-3.5 text-slate-400" />
                <input 
                  type="time" 
                  value={formData.jam}
                  onChange={(e) => setFormData({...formData, jam: e.target.value})}
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          <div>
             <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-1 block">Ruangan</label>
             <div className="relative">
                <MapPin size={16} className="absolute left-3 top-3.5 text-slate-400" />
                <input 
                  type="text" 
                  value={formData.ruang}
                  onChange={(e) => setFormData({...formData, ruang: e.target.value})}
                  placeholder="Contoh: Gedung D5 201"
                  className="w-full pl-9 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                />
             </div>
          </div>
        </div>

        <button 
          onClick={handleSubmit}
          className="w-full mt-8 bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition flex items-center justify-center gap-2"
        >
          <Save size={18} />
          Simpan Perubahan
        </button>

      </div>
    </div>
  );
}