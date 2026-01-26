import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { createSession, dedupeInflight, getSession } from './_session';
import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

// --- KONFIGURASI VERCEL ---
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Wajib set max durasi

// --- TIPE DATA LENGKAP ---
type Profile = {
    name: string;
    prodi: string;
    fakultas: string;
    dosenPa: string;
    status: string;
    jalur: string;
    foto: string | null;
};

type AllData = {
    profile: Profile;
    keuangan: { riwayat: any[]; totals: { ukt: number } };
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
    
    // Login Wajib (Password atau Session)
    if ((!nim || !password) && !session) {
        return NextResponse.json({ success: false, message: "Sesi habis. Login ulang." }, { status: 401 });
    }
    if (!password && session) nim = session.nim;

    // Deduplikasi Request (Cegah Crash Vercel)
    return await dedupeInflight(sessionToken ? `token:${sessionToken}` : `nim:${nim}`, async () => {
        let browser;
        try {
            console.log(`[${nim}] 🚀 START SCRAPER: FULL LOGIC RESTORED`);

            // 1. SETUP BROWSER (Vercel Friendly)
            if (process.env.NODE_ENV === 'production') {
                browser = await puppeteerCore.launch({
                    args: [...(chromium as any).args || [], '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
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
            page.setDefaultNavigationTimeout(60000);
            
            // Block Gambar/Font (Wajib biar cepat & hemat RAM)
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            // Helper Navigasi
            const gotoPage = async (url: string) => {
                try {
                    // Tunggu domcontentloaded sudah cukup, tidak perlu networkidle
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                } catch (e) {
                    console.log(`⚠️ Timeout ${url}, mencoba lanjut scrape...`);
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

            // --- 2. LOGIN ---
            await gotoPage('https://siakad.um.ac.id/');
            
            // Cek status login
            const isLoginPage = await (page as any).evaluate(() => !!document.querySelector('input[type="password"]'));
            
            if (isLoginPage) {
                if (password) {
                    await page.type('input[name="username"], #username', nim);
                    await page.type('input[type="password"]', password);
                    await Promise.all([
                        (page as any).click('button[type="submit"]'),
                        (page as any).waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
                    ]);
                } else if (session) {
                    await page.setCookie(...session.cookies);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }
            }

            // Validasi Akhir
            const stillLogin = await (page as any).evaluate(() => !!document.querySelector('input[type="password"]'));
            if (stillLogin) throw new Error("Gagal Login. Password Salah?");

            // --- 3. MULAI SCRAPING 7 FITUR ---
            const allData: AllData = {
                profile: { name: "Mahasiswa", prodi: "-", fakultas: "-", dosenPa: "-", status: "Aktif", jalur: "-", foto: null },
                keuangan: { riwayat: [], totals: { ukt: 0 } },
                jadwal: [],
                khs: { ips: "0.00", semester: "-", matkul: [] },
                dhs: { ipk: "0.00", totalSks: "0" },
                registrasi: [],
                dhe: []
            };

            // A. DASHBOARD (PROFIL) - Logic sesuai Screenshot Inspect Element
            console.log("📍 Scraping Dashboard...");
            await gotoPage('https://siakad.um.ac.id/dashboard/');
            const profData = await scrape(() => {
                const body = document.body.innerText;
                
                // Cari data pakai Regex di body text
                const find = (k: string) => (body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim() || "-";
                
                // Screenshot Mas: Nama ada di <a class="aku">
                const elNama = document.querySelector('a.aku') || document.querySelector('.user-name span');
                const rawNama = elNama ? elNama.textContent?.trim() : find('Nama');

                // Ambil URL Foto
                const imgEl = document.querySelector('img[src*="foto"], img[src*="GetFoto"]') as HTMLImageElement;
                
                return {
                    name: rawNama || "Mahasiswa",
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
                // Download foto (Opsional)
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

            // B. KEUANGAN (improved parsing)
            console.log("📍 Scraping Keuangan...");
            await gotoPage('https://siakad.um.ac.id/riwayat-keuangan/');
            const keuData = await scrape(() => {
                const rows = Array.from(document.querySelectorAll('table')).flatMap(t => Array.from(t.querySelectorAll('tr')));
                const out: any[] = [];

                const parseMoney = (raw: string) => {
                    if (!raw) return 0;
                    const candidates = raw.split(/\s+/).filter(s => /\d+[\.\,]\d/.test(s));
                    const token = candidates.length ? candidates[0] : raw;
                    const main = String(token).split(',')[0];
                    const digits = main.replace(/[^0-9]/g, '');
                    return parseInt(digits || '0', 10) || 0;
                };

                for (const row of rows) {
                    try {
                        const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim()).filter(Boolean);
                        if (!cols.length) continue;
                        const thaka = cols.find(c => /^\d{5}$/.test(c));
                        if (!thaka) continue;

                        const tgl = cols.find(c => /\d{2}\/\d{2}\/\d{4}/.test(c)) || null;
                        const moneyCandidates = cols.filter(c => /\d+[\.\,]\d{2}/.test(c) || /\d{1,3}(?:\.\d{3})+/.test(c));
                        const moneyRaw = moneyCandidates.length ? moneyCandidates[moneyCandidates.length - 1] : cols.find(c => /\d/.test(c) && !/^\d{5}$/.test(c)) || '0';
                        const nominal = parseMoney(moneyRaw);

                        const isLunas = !!tgl;
                        const year = thaka.slice(0, 4);
                        const kd = thaka.slice(4);
                        const term = kd === '1' ? 'Ganjil' : kd === '2' ? 'Genap' : 'Antara';

                        out.push({
                            thaka,
                            semester: `Semester ${term} ${year}/${parseInt(year)+1}`,
                            nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominal)}`,
                            spp: nominal,
                            status: isLunas ? 'Lunas' : 'Belum Bayar',
                            tglBayar: tgl || '-',
                            raw: cols
                        });
                    } catch {}
                }

                return out.reverse();
            });
            if (keuData) {
                allData.keuangan.riwayat = keuData;
                allData.keuangan.totals.ukt = keuData.reduce((a:any, b:any) => a + (b.spp || 0), 0);
            }

            // C. JADWAL (detect columns + fallback heuristics)
            console.log("📍 Scraping Jadwal...");
            await gotoPage('https://siakad.um.ac.id/krs/');
            const jadwalData = await scrape(() => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                    try {
                        const ths = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                        const rows = Array.from(t.querySelectorAll('tbody tr'));
                        if (!ths.length && rows.length === 0) continue;

                        // build index map
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

                // fallback: try to heuristically extract from any tr
                const rows = Array.from(document.querySelectorAll('tr'));
                const out: any[] = [];
                rows.forEach(row => {
                    const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
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

            // D. KHS (IPS + mata kuliah)
            console.log("📍 Scraping KHS...");
            await gotoPage('https://siakad.um.ac.id/khs/');
            const khsData = await scrape(() => {
                const body = document.body.innerText || '';
                const ipsMatch = body.match(/IPS\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                const tables = Array.from(document.querySelectorAll('table'));
                let matkul: any[] = [];
                for (const t of tables) {
                    try {
                        const ths = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase()).join(' ');
                        if ((ths.includes('nama') || ths.includes('mata') || ths.includes('kode')) && ths.includes('sks')) {
                            const rows = Array.from(t.querySelectorAll('tr')).slice(1);
                            matkul = rows.map(r => {
                                const cols = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                                const code = cols[0] || '';
                                const name = cols[1] || '';
                                const sks = parseInt(cols[2] || '0') || 0;
                                const nilai = cols.length > 3 ? cols[cols.length - 2] : '';
                                const dosen = cols.length > 3 ? cols[cols.length - 1] : '';
                                return { code, matkul: name, sks, nilai, dosen };
                            }).filter(x => x.matkul);
                            if (matkul.length) break;
                        }
                    } catch {}
                }
                return { ips: ipsMatch ? ipsMatch[1].replace(',', '.') : '0.00', matkul };
            });
            allData.khs.ips = khsData?.ips || '0.00';
            allData.khs.matkul = khsData?.matkul || [];

            // E. DHS (IPK & FALLBACK)
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
            
            // Logic Fallback: Kalau DHS kosong, pakai IPS KHS
            const finalIpk = (dhsData?.ipk && dhsData.ipk !== "0.00") ? dhsData.ipk : allData.khs.ips;
            allData.dhs = { ipk: finalIpk, totalSks: dhsData?.sks || "0" };
            if (allData.khs.ips === "0.00") allData.khs.ips = finalIpk; // Sync balik

            // F. REGISTRASI
            console.log("📍 Scraping Registrasi...");
            await gotoPage('https://siakad.um.ac.id/riwayat-registrasi/');
            const regData = await scrape(() => {
                const out: any[] = [];
                const rows = Array.from(document.querySelectorAll('tr'));
                for (const r of rows) {
                    try {
                        const cols = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim()).filter(Boolean);
                        if (!cols.length) continue;
                        const sem = cols.find(c => /^\d{5}$/.test(c));
                        const statusRaw = cols.find(c => /Aktif|Cuti|Lulus|Tidak Aktif|Menunggu|Lunas/i.test(c)) || '-';
                        if (sem) {
                            const year = sem.slice(0,4);
                            const t = sem.slice(4);
                            const term = t === '1' ? 'Ganjil' : t === '2' ? 'Genap' : 'Antara';
                            const status = /aktif/i.test(String(statusRaw)) ? 'Aktif' : /cuti/i.test(String(statusRaw)) ? 'Cuti' : /lulus/i.test(String(statusRaw)) ? 'Lulus' : String(statusRaw);
                            out.push({ semester: `Semester ${term} ${year}/${parseInt(year)+1}`, status, active: /aktif/i.test(String(statusRaw)) });
                        }
                    } catch {}
                }
                // dedupe keeping first occurrence
                const map = new Map();
                return out.filter(o => {
                    if (map.has(o.semester)) return false;
                    map.set(o.semester, true);
                    return true;
                });
            });
            if (regData) allData.registrasi = regData;

            // G. DHE
            console.log("📍 Scraping DHE...");
            await gotoPage('https://siakad.um.ac.id/dhe/');
            const dheData = await scrape(() => {
                const res: any[] = [];
                document.querySelectorAll('tr').forEach(r => {
                    const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                    // Asumsi DHE: Kolom terakhir adalah Poin (angka)
                    if (c.length > 2 && /^\d+$/.test(c[c.length-1])) {
                        res.push({ kegiatan: c[1], poin: c[c.length-1] });
                    }
                });
                return res;
            });
            if (dheData) allData.dhe = dheData;

            // --- 4. SELESAI ---
            const cookiesLatest = await page.cookies();
            const s = createSession(nim, cookiesLatest as any);
            await browser.close();

            const response = NextResponse.json({ success: true, nim, ...allData });
            response.cookies.set('siakad_session', s.token, { httpOnly: true, secure: true, path: '/' });
            return response;

        } catch (error: any) {
            if (browser) await browser.close();
            console.error("🔥 Error:", error.message);
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}