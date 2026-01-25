import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

// --- IMPORT DYNAMIC (BIAR VERCEL GAK ERROR BUILD) ---
import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
            console.log("🚀 Memulai Robot Scraper (Frame-Aware Mode)...");

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
                // Lazy Import buat Local biar Webpack gak error
                const { default: puppeteer } = await import('puppeteer-extra');
                const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
                puppeteer.use(StealthPlugin());
                browser = await puppeteer.launch({
                    headless: true, // Ubah false kalau mau liat robot
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
                });
            }

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);
            page.setDefaultTimeout(45000); // Waktu tunggu lebih lama
            await page.setViewport({ width: 1366, height: 768 });
            
            // --- 2. HELPER SAKTI: CARI DI SEMUA FRAME ---
            // Ini kuncinya! Robot akan cari tabel di dalam iframe juga.
            const scrapeTableInFrames = async (processorFn: Function) => {
                const frames = page.frames(); // Ambil semua bingkai halaman
                for (const frame of frames) {
                    try {
                        // Cek apakah ada tabel di frame ini
                        const hasTable = await frame.$('table');
                        if (hasTable) {
                            // Kalau ada, jalankan processor di frame ini
                            const result = await frame.evaluate(processorFn as any);
                            // Kalau hasilnya valid (bukan array kosong), return segera
                            if (result && (Array.isArray(result) ? result.length > 0 : Object.keys(result).length > 0)) {
                                return result;
                            }
                        }
                    } catch (e) { continue; }
                }
                return null; // Gak nemu apa-apa
            };

            const gotoWithRetry = async (url: string) => {
                try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); }
                catch (e) { console.log(`Retry ${url}...`); await page.reload({ waitUntil: 'networkidle2' }); }
            };

            // --- 3. LOGIN ---
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

            const allData: any = { profile: {}, keuangan: {}, registrasi: [], khs: {}, dhs: {}, jadwal: [], dhe: [] };

            // --- 4. PROFIL ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/dashboard/');
                allData.profile = await page.evaluate(() => {
                    const body = document.body.innerText;
                    const get = (k: string) => (body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim().replace(/^[:\-\s]+/, '') || "-";
                    return {
                        name: document.querySelector('.user-name span')?.textContent?.trim() || "Mahasiswa",
                        prodi: get('Program Studi'), fakultas: get('Fakultas'),
                        dosenPa: get('Dosen PA'), status: get('Status'), jalur: get('Jalur Masuk')
                    };
                });
            } catch {}

            // --- 5. KEUANGAN (FRAME-AWARE + AUTO-PILOT + FIX 450JT) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/');
                // Tunggu sebentar biar iframe loading
                await new Promise(r => setTimeout(r, 2000));
                
                const keuData = await scrapeTableInFrames(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    // Cari tabel apapun yang ada isinya
                    const targetTable = tables.find(t => t.innerText.includes('THAKA') || t.querySelectorAll('tr').length > 2);
                    
                    if (targetTable) {
                        Array.from(targetTable.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            // Auto-Scan Kolom
                            const thakaIdx = texts.findIndex(t => /^\d{5}$/.test(t));
                            if (thakaIdx === -1) return;

                            const thaka = texts[thakaIdx];
                            const nominalRaw = texts[thakaIdx + 1] || "0";
                            const tglRaw = texts.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t)) || "-";
                            
                            const th = thaka.substring(0, 4);
                            const sm = thaka.substring(4, 5) === '1' ? 'Ganjil' : 'Genap';
                            
                            // Fix Nominal (Split Koma)
                            const mainNominal = nominalRaw.split(',')[0];
                            const nominalVal = parseInt(mainNominal.replace(/\./g, '')) || 0;
                            const isLunas = tglRaw.length > 5 && !tglRaw.includes('-');
                            
                            let status = isLunas ? "Lunas" : "Belum Bayar";
                            if (nominalVal === 0 && !isLunas) status = "Menunggu Tagihan";
                            if (nominalVal === 0 && isLunas) status = "Lunas (Beasiswa/0)";

                            res.push({
                                thaka, semester: `Semester ${sm} ${th}/${parseInt(th)+1}`,
                                nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominalVal)}`,
                                spp: nominalVal, total: nominalVal, tglBayar: tglRaw, status,
                                rincian: [{ label: "SPP / UKT", value: nominalVal }]
                            });
                        });
                    }
                    if (res.length === 0) return null; // Balikin null biar helper nyari di frame lain
                    const riwayat = res.reverse();
                    const uktTotal = riwayat.reduce((a: number, b: any) => a + (b.spp || 0), 0);
                    return { riwayat, totals: { ukt: uktTotal } };
                });
                
                if (keuData) allData.keuangan = keuData;
            } catch (e) { console.log("Skip Keuangan"); }

            // --- 6. REGISTRASI (FRAME-AWARE + FIX STRIP) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-registrasi/');
                await new Promise(r => setTimeout(r, 2000));

                const regData = await scrapeTableInFrames(() => {
                    const out: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    // Cari tabel registrasi
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('status') || t.innerText.toLowerCase().includes('registrasi')) || tables[0];
                    
                    if (pick) {
                        Array.from(pick.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            // Cari 20251
                            const rawSem = texts.find(t => /^\d{5}$/.test(t));
                            // Cari Status (Kata kunci atau kolom terakhir)
                            let status = texts.find(t => /^(aktif|cuti|lulus|non-aktif|keluar)$/i.test(t));
                            if (!status) status = texts[texts.length - 1];

                            if (rawSem && rawSem.length === 5) {
                                const th = rawSem.substring(0, 4);
                                const k = rawSem.substring(4, 5);
                                const lb = k === '1' ? 'Ganjil' : (k === '2' ? 'Genap' : 'Antara');
                                if (status && status !== '-') {
                                    out.push({ semester: `Semester ${lb} ${th}/${parseInt(th)+1}`, status });
                                }
                            }
                        });
                    }
                    return out.length > 0 ? out : null;
                });
                if (regData) allData.registrasi = regData;
            } catch (e) { console.log("Skip Registrasi"); }

            // --- 7. KHS (FRAME-AWARE + FIX NOL) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/khs/');
                await new Promise(r => setTimeout(r, 2000));

                const khsData = await scrapeTableInFrames(() => {
                    const body = document.body.innerText;
                    // Cari IPS text di seluruh body frame
                    const ipsMatch = body.match(/IPS\s*[:=]?\s*(\d[\.,]\d{2})/i);
                    const ipkMatch = body.match(/IPK\s*[:=]?\s*(\d[\.,]\d{2})/i);
                    
                    if (ipsMatch) {
                        return { 
                            ips: ipsMatch[1].replace(',', '.'),
                            ipk_temp: ipkMatch ? ipkMatch[1].replace(',', '.') : "0.00",
                            semester: "Semester Ini" 
                        };
                    }
                    return null;
                });
                
                if (khsData) {
                    allData.khs = khsData;
                    allData.dhs = { ipk: khsData.ipk_temp || "0.00", totalSks: "0" };
                }
            } catch (e) { console.log("Skip KHS"); }

            // --- 8. JADWAL (FRAME-AWARE + FIX KOSONG) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/krs/');
                await new Promise(r => setTimeout(r, 2000));

                const jadwalData = await scrapeTableInFrames(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('mata kuliah') || t.innerText.toLowerCase().includes('sks'));
                    
                    if (pick) {
                        Array.from(pick.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            const hari = texts.find(t => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)$/i.test(t)) || "";
                            const jam = texts.find(t => /\d{2}:\d{2}/.test(t)) || "";
                            const ruang = texts.find(t => t.includes('Gedung') || /[A-Z]\d{2,3}/.test(t)) || "";
                            // Matkul = text panjang yg bukan hari/jam/ruang/kode
                            const matkul = texts.find(t => t.length > 5 && !/\d{2}:\d{2}/.test(t) && !/^(Senin|Selasa|Rabu|Kamis|Jumat)$/i.test(t) && !t.includes('Gedung'));

                            if (matkul && !matkul.toLowerCase().includes('total')) {
                                res.push({ matkul, hari: hari || "-", jam: jam || "-", ruang: ruang || "-", dosen: "-" });
                            }
                        });
                    }
                    return res.length > 0 ? res : null;
                });
                if (jadwalData) allData.jadwal = jadwalData;
            } catch (e) { console.log("Skip Jadwal"); }

            console.log("🎉 Scraping Selesai!");
            
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