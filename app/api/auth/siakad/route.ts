import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

// --- KONFIGURASI VERCEL ---
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; 

// --- TIPE DATA ---
type Profile = { name: string; prodi: string; fakultas: string; dosenPa: string; status: string; jalur: string; foto: string | null; };
type AllData = {
    profile: Profile;
    keuangan: { riwayat: any[]; totals: { ukt: number } };
    dashboard?: { term?: string; paymentStatus?: string; sks?: number; ip?: string };
    jadwal: any[];
    khs: { ips: string; semester: string; matkul: any[] };
    dhs: { ipk: string; totalSks: string };
    registrasi: any[];
    dhe: any[];
};

export async function POST(request: Request) {
    let nim = "";
    let password = "";
    
    try {
        const body = await request.json();
        nim = String(body.nim || "").trim();
        password = String(body.password || "");
    } catch {}

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('siakad_session')?.value;
    const session = getSession(sessionToken);
    
    // Cek Login (Wajib ada NIM/Pass atau Sesi)
    if ((!nim || !password) && !session) {
        return NextResponse.json({ success: false, message: "Sesi habis. Login ulang." }, { status: 401 });
    }
    if (!password && session) nim = session.nim;

    return await dedupeInflight(sessionToken ? `token:${sessionToken}` : `nim:${nim}`, async () => {
        let browser;
        try {
            console.log(`[${nim}] 🚀 START SCRAPER: FULL RESTORATION`);

            // 1. SETUP BROWSER
            if (process.env.NODE_ENV === 'production') {
                browser = await puppeteerCore.launch({
                    args: [...((chromium as any).args || []), '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
                    defaultViewport: { width: 1366, height: 768 },
                    executablePath: await (chromium as any).executablePath(),
                    headless: true,
                });
            } else {
                const { default: puppeteer } = await import('puppeteer-extra');
                const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
                puppeteer.use(StealthPlugin());
                browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
            }

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000); // Waktu toleransi panjang
            
            // Block Gambar/Font (Biar Cepat)
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            // Helper Navigasi
            const gotoPage = async (url: string) => {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                } catch (e) {
                    console.log(`⚠️ Timeout ${url}, mencoba lanjut...`);
                }
            };

            // Helper Scrape Frame (Cari di semua iframe)
            const scrape = async <T>(fn: () => T) => {
                const frames = [page.mainFrame(), ...page.frames()];
                for (const f of frames) {
                    try {
                        const res = await (f as any).evaluate(fn);
                        if (res) return res;
                    } catch {}
                }
                return null;
            };

            // --- 2. LOGIN (PERBAIKAN UTAMA) ---
            await gotoPage('https://siakad.um.ac.id/');
            
            const isLoginPage = await (page as any).evaluate(() => !!document.querySelector('input[type="password"]'));
            
            if (isLoginPage) {
                if (password) {
                    await page.type('input[name="username"], #username', nim);
                    await page.type('input[type="password"]', password);
                    
                    // FIX: Coba klik tombol login dengan berbagai cara
                    const clicked = await (page as any).evaluate(() => {
                        const btn = document.querySelector('button[type="submit"]') || 
                                    document.querySelector('input[type="submit"]') ||
                                    document.querySelector('button.btn-primary'); // Tambahan selector
                        if (btn) { (btn as HTMLElement).click(); return true; }
                        return false;
                    });

                    if (!clicked) {
                        console.log("⚠️ Tombol login tidak ketemu, tekan ENTER...");
                        await page.keyboard.press('Enter');
                    }

                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
                } else if (session) {
                    await page.setCookie(...session.cookies);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }
            }

            // Validasi Login
            const stillLogin = await (page as any).evaluate(() => !!document.querySelector('input[type="password"]'));
            if (stillLogin) throw new Error("Gagal Login. Cek NIM/Password.");

            // --- 3. SCRAPING (LOGIKA EKSPLISIT) ---
            const allData: AllData = {
                profile: { name: "Mahasiswa", prodi: "-", fakultas: "-", dosenPa: "-", status: "Aktif", jalur: "-", foto: null },
                keuangan: { riwayat: [], totals: { ukt: 0 } },
                jadwal: [],
                khs: { ips: "0.00", semester: "-", matkul: [] },
                dhs: { ipk: "0.00", totalSks: "0" },
                registrasi: [],
                dhe: []
            };

            // A. DASHBOARD (Sesuai Inspect Element: a.aku)
            console.log("📍 Scraping Dashboard...");
            await gotoPage('https://siakad.um.ac.id/dashboard/');
            const profData = await scrape(() => {
                const body = document.body.innerText;
                const find = (k: string) => (body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim() || "-";
                
                // Selector Spesifik sesuai Screenshot Mas
                const elNama = document.querySelector('a.aku'); // "RIFKY DYATAMA..."
                const imgEl = document.querySelector('img[src*="foto"], img[src*="GetFoto"]') as HTMLImageElement;
                
                return {
                    name: elNama ? elNama.textContent?.trim() || "Mahasiswa" : find('Nama'),
                    prodi: find('Program Studi') !== '-' ? find('Program Studi') : find('Prodi'),
                    fakultas: find('Fakultas'),
                    dosenPa: find('Dosen PA'),
                    status: find('Status'),
                    jalur: find('Jalur Masuk'),
                    fotoUrl: imgEl ? imgEl.src : null
                };
            });
            if (profData) {
                allData.profile = { ...allData.profile, ...profData, foto: null };
                // Ambil Foto
                if (profData.fotoUrl) {
                    try {
                        const newPage = await browser.newPage();
                        const view = await newPage.goto(profData.fotoUrl);
                        const buf = await view?.buffer();
                        if (buf) allData.profile.foto = `data:image/jpeg;base64,${buf.toString('base64')}`;
                        await newPage.close();
                    } catch {}
                }
            }

            // B. KEUANGAN (Logic Anti-450Juta)
            console.log("📍 Scraping Keuangan...");
            await gotoPage('https://siakad.um.ac.id/riwayat-keuangan/');
            const keuData = await scrape(() => {
                const res: any[] = [];
                const rows = Array.from(document.querySelectorAll('tr'));
                
                rows.forEach(row => {
                    const txt = row.innerText;
                    if (/\d{5}/.test(txt)) { // Baris yang punya 20251 dll
                        const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                        
                        const thaka = cols.find(c => /^\d{5}$/.test(c));
                        const tgl = cols.find(c => /\d{2}\/\d{2}\/\d{4}/.test(c));
                        // Cari yang format uang
                        const moneyRaw = cols.find(c => c !== thaka && (c.includes('.') || c.includes(',')) && !c.includes('/')) || "0";

                        if (thaka) {
                            // FIX UANG: Split koma, ambil depannya saja -> 4.500.000,00 -> 4.500.000
                            const mainPart = moneyRaw.split(',')[0];
                            const nominal = parseInt(mainPart.replace(/\D/g, '')) || 0;

                            const isLunas = !!tgl;
                            let status = isLunas ? "Lunas" : "Belum Bayar";
                            if (nominal === 0 && isLunas) status = "Lunas (KIP-K)";

                            const th = thaka.slice(0, 4);
                            const kd = thaka.slice(4);
                            const sm = kd==='1'?'Ganjil':kd==='2'?'Genap':'Antara';

                            res.push({
                                thaka,
                                semester: `Semester ${sm} ${th}/${parseInt(th)+1}`,
                                nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominal)}`,
                                spp: nominal,
                                status: status,
                                tglBayar: tgl || "-"
                            });
                        }
                    }
                });
                return res.reverse();
            });
            if (keuData) {
                allData.keuangan.riwayat = keuData;
                allData.keuangan.totals.ukt = keuData.reduce((a:any, b:any) => a + b.spp, 0);
            }

            // C. JADWAL (detect columns + fallback heuristics)
            console.log("📍 Scraping Jadwal...");
            await gotoPage('https://siakad.um.ac.id/krs/');
            const jadwalData = await scrape(() => {
                // Try to find a headered table first
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                    try {
                        const ths = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                        const rows = Array.from(t.querySelectorAll('tbody tr'));
                        if (!ths.length && rows.length === 0) continue;

                        const idx = (name: string) => ths.findIndex(h => h.includes(name));
                        const iKode = idx('kode');
                        const iNama = idx('nama') >= 0 ? idx('nama') : idx('mata') >= 0 ? idx('mata') : idx('mk');
                        const iDosen = idx('dosen');
                        const iHari = idx('hari');
                        const iJam = idx('jam');
                        const iRuang = idx('ruang');

                        if (iNama >= 0 || iKode >= 0) {
                            return rows.map(r => {
                                const cols = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                                const code = (iKode >= 0 ? cols[iKode] : cols[0]) || '';
                                const name = (iNama >= 0 ? cols[iNama] : cols[1]) || '';
                                const dosen = (iDosen >= 0 ? cols[iDosen] : (cols[cols.length-1] || '-')) || '-';
                                const hari = iHari >= 0 ? (cols[iHari] || '-') : (cols.find(c => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)$/i.test(c)) || '-');
                                const jam = iJam >= 0 ? (cols[iJam] || '-') : (cols.find(c => /\d{2}:\d{2}/.test(c)) || '-');
                                const ruang = iRuang >= 0 ? (cols[iRuang] || '-') : (cols.find(c => /ruang|lab|gedung|rm|room/i.test(c)) || '-');
                                return { code, matkul: name, dosen, hari, jam, ruang };
                            }).filter(x => x.matkul);
                        }
                    } catch {}
                }

                // fallback: heuristics across all trs
                const rows = Array.from(document.querySelectorAll('tr'));
                const out: any[] = [];
                rows.forEach(row => {
                    const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim()).filter(Boolean);
                    if (cols.length < 2) return;
                    const jam = cols.find(c => /\d{2}:\d{2}/.test(c)) || '-';
                    const hari = cols.find(c => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)$/i.test(c)) || '-';
                    const dosen = cols.find(c => (c.includes('.') || c.includes(',')) && c.length > 5) || '-';
                    const matkul = cols.find(c => c.length > 6 && c !== dosen && !/\d/.test(c)) || cols[0] || '-';
                    out.push({ code: '', matkul, dosen, hari, jam, ruang: '-' });
                });
                return out;
            });
            if (jadwalData) allData.jadwal = jadwalData;

            // D. KHS (IPS)
            console.log("📍 Scraping KHS...");
            await gotoPage('https://siakad.um.ac.id/khs/');
            const ipsData = await scrape(() => {
                const text = document.body.innerText;
                const m = text.match(/IPS\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                return m ? m[1].replace(',', '.') : null;
            });
            allData.khs.ips = ipsData || "0.00";

            // E. DHS (IPK)
            console.log("📍 Scraping DHS...");
            await gotoPage('https://siakad.um.ac.id/dhs/');
            const dhsData = await scrape(() => {
                const t = document.body.innerText;
                const ipk = t.match(/IPK\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                const sks = t.match(/(Total\s*SKS|Jumlah\s*SKS)\s*[:=]?\s*(\d+)/i);
                return { 
                    ipk: ipk?.[1].replace(',', '.') || null, 
                    sks: sks?.[2] || "0" 
                };
            });
            // FALLBACK IPK: Kalau DHS kosong, ambil IPS dari KHS
            const finalIpk = (dhsData?.ipk && dhsData.ipk !== "0.00") ? dhsData.ipk : allData.khs.ips;
            allData.dhs = { ipk: finalIpk, totalSks: dhsData?.sks || "0" };
            if (allData.khs.ips === "0.00") allData.khs.ips = finalIpk;

            // F. REGISTRASI
            console.log("📍 Scraping Registrasi...");
            await gotoPage('https://siakad.um.ac.id/riwayat-registrasi/');
            const regData = await scrape(() => {
                const res: any[] = [];
                document.querySelectorAll('tr').forEach(r => {
                    const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                    const sem = c.find(t => /^\d{5}$/.test(t));
                    const stat = c.find(t => /Aktif|Cuti|Lulus/i.test(t));
                    
                    if (sem) {
                        const th = sem.slice(0,4), kd = sem.slice(4);
                        const sm = kd==='1'?'Ganjil':kd==='2'?'Genap':'Antara';
                        res.push({ semester: `Semester ${sm} ${th}/${parseInt(th)+1}`, status: stat || "Aktif" });
                    }
                });
                return res;
            });
            if (regData) allData.registrasi = regData;

            // G. DHE
            console.log("📍 Scraping DHE...");
            await gotoPage('https://siakad.um.ac.id/dhe/');
            const dheData = await scrape(() => {
                const res: any[] = [];
                document.querySelectorAll('tr').forEach(r => {
                    const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                    if (c.length > 2 && /^\d+$/.test(c[c.length-1])) {
                        res.push({ kegiatan: c[1], poin: c[c.length-1] });
                    }
                });
                return res;
            });
            if (dheData) allData.dhe = dheData;

            // --- 4. SELESAI ---
            // Merge jadwal with existing session (preserve manual edits)
            const normalizeKey = (v: string | undefined | null) => String(v || '').toLowerCase().replace(/[\s\-_.()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

            const semesterActive = (allData.registrasi && (allData.registrasi as any[]).find(r => (r as any).active)) ? ((allData.registrasi as any[]).find(r => (r as any).active) as any).semester : (allData.registrasi && (allData.registrasi as any[])[0]?.semester) || undefined;

            const scheduleChanges: any[] = [];
            let finalJadwal: any[] = (allData.jadwal || []).map((j:any) => ({ ...j }));

            if (session && session.semester && semesterActive && session.semester === semesterActive && Array.isArray((session as any).jadwal)) {
                finalJadwal = JSON.parse(JSON.stringify((session as any).jadwal || []));
                const idxMap = new Map(finalJadwal.map((item:any, i:number) => [normalizeKey(item.code || item.matkul || ''), i]));
                for (const n of (allData.jadwal || [])) {
                    const key = normalizeKey(n.code || n.matkul || '');
                    const idx = idxMap.get(key);
                    if (typeof idx === 'number') {
                        const before = { hari: finalJadwal[idx].hari, jam: finalJadwal[idx].jam, ruang: finalJadwal[idx].ruang };
                        let changed = false;
                        for (const f of ['hari','jam','ruang']) {
                            if (n[f] && n[f] !== '-' && n[f] !== finalJadwal[idx][f]) {
                                finalJadwal[idx][f] = n[f];
                                changed = true;
                            }
                        }
                        if (changed) scheduleChanges.push({ type: 'updated', key, before, after: { hari: finalJadwal[idx].hari, jam: finalJadwal[idx].jam, ruang: finalJadwal[idx].ruang } });
                    } else {
                        const matchKhs = (allData.khs?.matkul || []).find((k:any) => normalizeKey(k.code || k.matkul || '') === key);
                        const toAdd = { ...n, dosen: n.dosen || (matchKhs?.dosen || '-') };
                        finalJadwal.push(toAdd);
                        scheduleChanges.push({ type: 'added', key, item: toAdd });
                    }
                }
            } else {
                finalJadwal = (allData.jadwal || []).map((n:any) => {
                    const matchKhs = (allData.khs?.matkul || []).find((k:any) => normalizeKey(k.code || k.matkul || '') === normalizeKey(n.code || n.matkul || ''));
                    return { ...n, dosen: n.dosen || (matchKhs?.dosen || '-') };
                });
                if (session && session.semester && semesterActive && session.semester !== semesterActive) {
                    scheduleChanges.push({ type: 'semester_changed', from: session.semester, to: semesterActive });
                }
            }

            // scheduleStats
            const totalClasses = finalJadwal.length;
            const editedCount = finalJadwal.filter((j:any) => (j.hari && j.hari !== '-' && j.hari !== '') || (j.jam && j.jam !== '-' && j.jam !== '') || (j.ruang && j.ruang !== '-' && j.ruang !== '')).length;
            const dayNames: Record<number,string> = {0:'Minggu',1:'Senin',2:'Selasa',3:'Rabu',4:'Kamis',5:'Jumat',6:'Sabtu'};
            const todayName = dayNames[new Date().getDay()];
            const scheduleToday = finalJadwal.filter((j:any) => (j.hari || '').toLowerCase().includes(todayName.toLowerCase()));

            // persist session (cookiesLatest)
            const cookiesLatest = await page.cookies();
            let outToken = sessionToken;
            if (session) {
                updateSession(sessionToken!, cookiesLatest as any, { semester: semesterActive, jadwal: finalJadwal });
            } else {
                const s = createSession(nim, cookiesLatest as any);
                outToken = s.token;
                updateSession(s.token, cookiesLatest as any, { semester: semesterActive, jadwal: finalJadwal });
            }

            await browser.close();

            const responsePayload = {
                success: true,
                nim,
                profile: allData.profile,
                dashboard: allData.dashboard || {},
                keuangan: allData.keuangan,
                registrasi: allData.registrasi,
                khs: allData.khs,
                dhs: allData.dhs,
                jadwal: finalJadwal,
                dhe: allData.dhe,
                scheduleChanges,
                scheduleStats: { totalClasses, editedCount, scheduleTodayCount: scheduleToday.length, scheduleToday }
            };

            const response = NextResponse.json(responsePayload);
            if (outToken) response.cookies.set('siakad_session', outToken, { httpOnly: true, secure: true, path: '/' });
            return response;

        } catch (error: any) {
            if (browser) await browser.close();
            console.error("🔥 Error:", error.message);
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}