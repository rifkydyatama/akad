import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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
                    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
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
                        const res = await f.evaluate(fn);
                        if (res) return res;
                    } catch {}
                }
                return null;
            };

            // --- 2. LOGIN (PERBAIKAN UTAMA) ---
            await gotoPage('https://siakad.um.ac.id/');
            
            const isLoginPage = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
            
            if (isLoginPage) {
                if (password) {
                    await page.type('input[name="username"], #username', nim);
                    await page.type('input[type="password"]', password);
                    
                    // FIX: Coba klik tombol login dengan berbagai cara
                    const clicked = await page.evaluate(() => {
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
            const stillLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
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

            // C. JADWAL (Hanya Matkul & Dosen)
            console.log("📍 Scraping Jadwal...");
            await gotoPage('https://siakad.um.ac.id/krs/');
            const jadwalData = await scrape(() => {
                const res: any[] = [];
                const rows = Array.from(document.querySelectorAll('tr'));
                
                rows.forEach(row => {
                    const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                    if (cols.length < 3) return;

                    // Dosen: Ada titik/koma gelar
                    const dosen = cols.find(t => (t.includes('.') || t.includes(',')) && t.length > 5 && !t.match(/\d{2}:\d{2}/));
                    
                    // Matkul: Teks panjang sisa
                    const matkul = cols.find(t => 
                        t.length > 5 && 
                        t !== dosen &&
                        !/^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)$/i.test(t) &&
                        !/\d{2}:\d{2}/.test(t) &&
                        !/Gedung|Ruang|SKS|Total/i.test(t) &&
                        !/^\d+$/.test(t)
                    );

                    if (matkul) {
                        res.push({
                            matkul: matkul,
                            dosen: dosen || "-",
                            hari: "-", jam: "-", ruang: "-" // Request User: Kosongkan
                        });
                    }
                });
                return res;
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