import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

// --- IMPORT DYNAMIC (BIAR VERCEL GAK ERROR BUILD) ---
import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Wajib 60 detik buat Vercel

// --- TYPE DEFINITIONS ---
type Profile = {
    name: string;
    prodi: string;
    fakultas: string;
    dosenPa: string;
    status: string;
    jalur: string;
    foto: string | null;
};
type RegistrasiItem = { semester: string; status: string };
type KhsItem = { matkul: string; sks: number; nilai: string };
type Khs = { semester: string; ips: string; matkul: KhsItem[] };
type Dhs = { ipk: string; totalSks: string };
type JadwalItem = { matkul: string; hari: string; jam: string; ruang: string; dosen?: string };
type DheItem = { kegiatan: string; poin: string };
type AllData = {
    profile: Profile;
    keuangan: {
        master: any;
        riwayat: any[];
        totals: { ukt: number; totalPaid: number; paidCount: number; unpaidCount: number; activeThaka?: string };
    };
    registrasi: RegistrasiItem[];
    khs: Khs;
    dhs: Dhs;
    jadwal: JadwalItem[];
    dhe: DheItem[];
};

export async function POST(request: Request) {
    let nim = "";
    let password = "";
    let body: Record<string, unknown> = {};

    try {
        const parsed: unknown = await request.json();
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch { body = {}; }

    nim = String(body.nim || "").trim();
    password = String(body.password || "");

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('siakad_session')?.value;
    const session = getSession(sessionToken);
    const useSession = !password && !!session;

    if (!useSession && (!nim || !password)) {
        return NextResponse.json({ success: false, message: "Login gagal." }, { status: 401 });
    }
    if (useSession) nim = session!.nim;

    const inflightKey = sessionToken ? `token:${sessionToken}` : `nim:${nim}`;

    return await dedupeInflight(inflightKey, async () => {
        let browser;
        try {
            console.log("🚀 Memulai Robot Scraper (Super Auto-Scan Mode)...");

            // --- 1. PILIH BROWSER (VERCEL vs LOCAL) ---
            if (process.env.NODE_ENV === 'production') {
                browser = await puppeteerCore.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            } else {
                // Lazy Import buat Local
                const { default: puppeteer } = await import('puppeteer-extra');
                const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
                puppeteer.use(StealthPlugin());
                browser = await puppeteer.launch({
                    headless: true, // Ubah false kalau mau lihat browser jalan
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
                });
            }

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);
            page.setDefaultTimeout(45000);
            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

            // --- HELPER FRAME (ROBOT PENJELAJAH) ---
            const scrapeTableInFrames = async <T>(processorFn: () => T | null): Promise<T | null> => {
                const frames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
                for (const frame of frames) {
                    try {
                        const result = await frame.evaluate(processorFn);
                        if (result !== null && result !== undefined) {
                            if (Array.isArray(result) && result.length === 0) continue; 
                            return result;
                        }
                    } catch (e) { continue; }
                }
                return null;
            };

            const gotoWithRetry = async (url: string) => {
                try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); }
                catch (e) { console.log(`Retry ${url}...`); await page.reload({ waitUntil: 'networkidle2' }); }
            };

            // --- 2. LOGIN ---
            if (useSession) {
                await gotoWithRetry('https://siakad.um.ac.id/');
                await page.setCookie(...session!.cookies);
            } else {
                await gotoWithRetry('https://siakad.um.ac.id/');
                const inputSelector = 'input[name="username"], input[name="identity"], #username';
                await page.waitForSelector(inputSelector, { timeout: 20000 });
                await page.type(inputSelector, nim);
                await page.type('input[type="password"]', password);
                await Promise.all([
                    page.click('button[type="submit"], input[type="submit"]'),
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
                ]);
            }

            // Cek Login
            const isLogin = await page.evaluate(() => !document.querySelector('input[type="password"]'));
            if (!isLogin) throw new Error("Gagal Login (Password Salah / Captcha)");

            const allData: AllData = {
                profile: { name: "", prodi: "-", fakultas: "-", dosenPa: "-", status: "Aktif", jalur: "-", foto: null },
                keuangan: { master: {}, riwayat: [], totals: { ukt: 0, totalPaid: 0, paidCount: 0, unpaidCount: 0 } },
                registrasi: [],
                khs: { semester: "-", ips: "0.00", matkul: [] },
                dhs: { ipk: "0.00", totalSks: "0" },
                jadwal: [],
                dhe: []
            };

            // --- 3. PROFIL (AMAN) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/dashboard/');
                const profData = await scrapeTableInFrames(() => {
                    const body = document.body.innerText;
                    const get = (k: string) => (body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim().replace(/^[:\-\s]+/, '') || "-";
                    
                    const nameEl = document.querySelector('.user-name span, .profile-name, a.aku');
                    const name = nameEl?.textContent?.trim() || "Mahasiswa";

                    return {
                        name: name,
                        prodi: get('Program Studi') !== '-' ? get('Program Studi') : get('Prodi'),
                        fakultas: get('Fakultas'),
                        dosenPa: get('Dosen PA') !== '-' ? get('Dosen PA') : get('Penasihat'),
                        status: get('Status'),
                        jalur: get('Jalur Masuk')
                    };
                });
                if(profData) allData.profile = { ...allData.profile, ...profData };

                // Foto Profil
                try {
                    const imgUrl = await page.evaluate(() => (document.querySelector('img[src*="foto"], img[src*="GetFoto"]') as HTMLImageElement)?.src);
                    if (imgUrl) {
                        const viewSource = await page.goto(imgUrl);
                        const buffer = await viewSource?.buffer();
                        if(buffer) allData.profile.foto = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                        await page.goBack();
                    }
                } catch {}
            } catch {}

            // --- 4. KEUANGAN (FIX FATAL: THAKA KETUKAR NOMINAL) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/');
                await new Promise(r => setTimeout(r, 1000));
                
                const keuData = await scrapeTableInFrames(() => {
                    const res: any[] = [];
                    // Cari semua tabel, ambil yang ada 'THAKA' atau 'Semester'
                    const tables = Array.from(document.querySelectorAll('table'));
                    const targetTable = tables.find(t => t.innerText.includes('THAKA') || t.innerText.includes('Semester'));
                    
                    if (targetTable) {
                        const rows = Array.from(targetTable.querySelectorAll('tr'));
                        rows.forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            // LOGIC SUPER AUTO: Cari berdasarkan format isi, bukan urutan kolom!
                            
                            // 1. Cari THAKA: Harus 5 digit angka (misal: 20251)
                            const thakaRaw = texts.find(t => /^\d{5}$/.test(t));
                            
                            // 2. Cari NOMINAL: Cari yang ada 'Rp' atau format angka ribuan (misal: 4.500.000)
                            // Pastikan bukan THAKA
                            const nominalRaw = texts.find(t => t !== thakaRaw && (t.includes('Rp') || (t.match(/\d/g) || []).length > 4 && t.includes(','))) || "0";

                            // 3. Cari Tanggal Bayar: Format dd/mm/yyyy
                            const tglBayarRaw = texts.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t));

                            if(thakaRaw) {
                                let semesterNama = thakaRaw;
                                if (thakaRaw.length === 5) {
                                    const th = thakaRaw.substring(0, 4);
                                    const kd = thakaRaw.substring(4, 5);
                                    const lb = kd === '1' ? 'Ganjil' : (kd === '2' ? 'Genap' : 'Antara');
                                    semesterNama = `Semester ${lb} ${th}/${parseInt(th) + 1}`;
                                }

                                const nominalValue = parseInt(nominalRaw.replace(/\D/g, '')) || 0;
                                const isLunas = (tglBayarRaw && tglBayarRaw.length > 5);
                                const statusFinal = isLunas ? "Lunas" : "Belum Bayar";

                                res.push({
                                    thaka: thakaRaw,
                                    semester: semesterNama,
                                    nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominalValue)}`,
                                    spp: nominalValue,
                                    total: nominalValue,
                                    tglBayar: tglBayarRaw || "-",
                                    status: statusFinal,
                                    rincian: [{ label: "SPP / UKT", value: nominalValue }]
                                });
                            }
                        });
                    }
                    if (res.length === 0) return null;
                    const riwayat = res.reverse();
                    const uktTotal = riwayat.reduce((acc: number, r: any) => acc + (r.spp || 0), 0);
                    const paidCount = riwayat.filter((r: any) => r.status === "Lunas").length;
                    return { riwayat, totals: { ukt: uktTotal, totalPaid: 0, paidCount, unpaidCount: riwayat.length - paidCount } };
                });
                
                if (keuData) allData.keuangan = { ...allData.keuangan, ...keuData };
            } catch (e) { console.log("Skip Keuangan"); }

            // --- 5. REGISTRASI (FIX: AUTO-SEARCH STATUS) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-registrasi/');
                await new Promise(r => setTimeout(r, 1000));

                const regData = await scrapeTableInFrames(() => {
                    const out: RegistrasiItem[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('status')) || tables[0];
                    
                    if (pick) {
                        const rows = Array.from(pick.querySelectorAll('tr'));
                        rows.forEach(row => {
                            const cells = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            // 1. Cari Semester (5 digit angka)
                            const rawSem = cells.find(t => /^\d{5}$/.test(t));
                            
                            // 2. Cari Status (Keyword: Aktif, Cuti, Non-Aktif)
                            // Jangan ambil kolom terakhir buta-buta
                            let status = cells.find(t => /^(aktif|cuti|lulus|non-aktif|keluar)$/i.test(t));
                            if (!status && cells.length > 2) status = cells[cells.length - 1]; // Fallback

                            if (rawSem) {
                                let finalSem = rawSem;
                                const th = rawSem.slice(0, 4);
                                const kd = rawSem.slice(4);
                                const lb = kd === '1' ? 'Ganjil' : kd === '2' ? 'Genap' : 'Antara';
                                finalSem = `Semester ${lb} ${th}/${parseInt(th)+1}`;
                                
                                if (status && status !== '-') {
                                    out.push({ semester: finalSem, status });
                                }
                            }
                        });
                    }
                    return out.length > 0 ? out : null;
                });
                if (regData) {
                    allData.registrasi = regData;
                    const activeReg = regData.find(x => x.status.toLowerCase().includes('aktif'));
                    if (activeReg) {
                         const m = activeReg.semester.match(/(\d{4})\/(\d{4})/);
                         const l = activeReg.semester.toLowerCase();
                         if(m) {
                             const term = l.includes('ganjil') ? 1 : l.includes('genap') ? 2 : 3;
                             allData.keuangan.totals.activeThaka = `${m[1]}${term}`;
                         }
                    }
                }
            } catch (e) { console.log("Skip Registrasi"); }

            // --- 6. KHS (FIX: IPS LEBIH AKURAT) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/khs/');
                await new Promise(r => setTimeout(r, 1000));
                
                const khsData = await scrapeTableInFrames(() => {
                    const body = document.body.innerText;
                    // Cari IPS: 3.xx di teks halaman (lebih akurat daripada tabel)
                    const ipsMatch = body.match(/\bIPS\b\s*[:=]?\s*(\d[\.,]\d{2})/i) || body.match(/(\d[\.,]\d{2})\s*\bIP\b/i);
                    const ips = ipsMatch ? ipsMatch[1].replace(',', '.') : "0.00";
                    
                    const items: KhsItem[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    // Cari tabel nilai yang ada kolom SKS dan Huruf
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('sks') && t.innerText.toLowerCase().includes('huruf')) || tables[0];
                    
                    if (pick) {
                        const rows = Array.from(pick.querySelectorAll('tr')).slice(1);
                        rows.forEach(row => {
                            const c = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                            // Filter baris yang valid (bukan header/footer)
                            if(c.length > 4) {
                                // Cari angka 1 digit (SKS)
                                const sksRaw = c.find(x => /^\d$/.test(x)) || "0";
                                // Cari Nilai Huruf (A, B, C...)
                                const nilai = c.find(x => /^[A-E][+-]?$/.test(x)) || "";
                                // Sisanya nama Matkul
                                const matkul = c.find(x => x.length > 5 && !/^\d+$/.test(x) && x !== nilai) || "MK";
                                
                                if(nilai) items.push({ matkul, sks: parseInt(sksRaw), nilai });
                            }
                        });
                    }
                    return { semester: "Semester Ini", ips, matkul: items };
                });
                if (khsData) allData.khs = khsData;
            } catch (e) { console.log("Skip KHS"); }

            // --- 7. DHS (TRANSKRIP) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/dhs/');
                const dhsData = await scrapeTableInFrames(() => {
                    const body = document.body.innerText;
                    const ipkMatch = body.match(/IPK\s*[:=]?\s*(\d[\.,]\d{2})/i);
                    const sksMatch = body.match(/(Total\s*SKS|Jumlah\s*SKS)\s*[:=]?\s*(\d+)/i);
                    return {
                        ipk: ipkMatch ? ipkMatch[1].replace(',', '.') : "0.00",
                        totalSks: sksMatch ? sksMatch[2] : "0"
                    };
                });
                if (dhsData) allData.dhs = dhsData;
            } catch (e) { console.log("Skip DHS"); }

            // --- 8. JADWAL (FIX: AUTO DETECT HARI & JAM) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/krs/');
                await new Promise(r => setTimeout(r, 1000));
                
                const jadwalData = await scrapeTableInFrames(() => {
                    const out: JadwalItem[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('mata kuliah') || t.innerText.toLowerCase().includes('hari')) || tables[0];
                    
                    if(pick) {
                         const rows = Array.from(pick.querySelectorAll('tr'));
                         rows.forEach(row => {
                            const c = Array.from(row.querySelectorAll('td')).map(x => x.innerText.trim());
                            
                            // 1. Cari HARI (Senin...Sabtu)
                            const hari = c.find(x => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)$/i.test(x)) || "";
                            // 2. Cari JAM (07:00)
                            const jam = c.find(x => /\d{2}:\d{2}/.test(x)) || "";
                            // 3. Cari RUANG (Gedung...)
                            const ruang = c.find(x => /Gedung/i.test(x) || /[A-Z]\d{2,3}/.test(x)) || "";
                            // 4. Cari MATKUL (Teks panjang sisa)
                            const matkul = c.find(x => x.length > 5 && !/\d{2}:\d{2}/.test(x) && !/^(Senin|Selasa|Rabu|Kamis|Jumat)$/i.test(x) && !x.includes('Gedung'));

                            if (matkul && hari && !matkul.toLowerCase().includes('total')) {
                                out.push({ matkul, hari, jam, ruang, dosen: "" });
                            }
                         });
                    }
                    return out;
                });
                if (jadwalData) allData.jadwal = jadwalData;
            } catch (e) { console.log("Skip Jadwal"); }

            console.log("🎉 SELESAI!");

            // Simpan Session
            try {
                const cookies = await page.cookies();
                if (useSession && sessionToken) updateSession(sessionToken, cookies as any);
                else {
                    const s = createSession(nim, cookies as any);
                    if(s) sessionToken = s.token;
                }
            } catch {}

            await browser.close();

            const res = NextResponse.json({ success: true, nim, ...allData });
            if (sessionToken) {
                 res.cookies.set('siakad_session', sessionToken, { httpOnly: true, secure: true, path: '/' });
            }
            return res;

        } catch (error: any) {
            if (browser) await browser.close();
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}