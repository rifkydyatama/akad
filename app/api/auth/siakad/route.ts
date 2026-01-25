import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

// --- IMPORT PUPPETEER CORE (AMAN BUAT VERCEL) ---
import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

// CATATAN: Jangan import puppeteer-extra / stealth di sini (Top Level).
// Nanti bikin error "clone-deep" saat build. Kita import di bawah saja.

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
            console.log("🚀 Memulai Robot Scraper...");

            // --- BROWSER LAUNCHER ---
            if (process.env.NODE_ENV === 'production') {
                // MODE VERCEL (Ringan & Cepat)
                console.log("⚙️ Mode: Production (Vercel)");
                browser = await puppeteerCore.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            } else {
                // MODE LOCAL (Laptop) - Load Plugin Disini (Lazy Load)
                console.log("⚙️ Mode: Development (Local)");
                
                // Import dinamis biar Webpack gak error saat build
                const { default: puppeteer } = await import('puppeteer-extra');
                const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
                
                puppeteer.use(StealthPlugin());

                browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
                });
            }

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);
            page.setDefaultTimeout(30000);
            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

            // Fungsi Helper Navigasi
            const gotoWithRetry = async (url: string) => {
                try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); }
                catch (e) { console.log("Retry navigate..."); await page.reload({ waitUntil: 'networkidle2' }); }
            };

            // --- 1. LOGIN ---
            if (useSession) {
                await gotoWithRetry('https://siakad.um.ac.id/');
                await page.setCookie(...session!.cookies);
            } else {
                await gotoWithRetry('https://siakad.um.ac.id/');
                const inputSelector = 'input[name="username"], input[name="identity"], #username';
                await page.waitForSelector(inputSelector, { timeout: 15000 });
                await page.type(inputSelector, nim);
                await page.type('input[type="password"]', password);
                await Promise.all([
                    page.click('button[type="submit"], input[type="submit"]'),
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
                ]);
            }

            const isLogin = await page.evaluate(() => !document.querySelector('input[type="password"]'));
            if (!isLogin) throw new Error("Gagal Login");

            // Container Data
            const allData: any = { profile: {}, keuangan: {}, registrasi: [], khs: {}, dhs: {}, jadwal: [], dhe: [] };

            // --- 2. PROFIL ---
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

            // --- 3. KEUANGAN (Auto-Pilot & Fix 450 Juta) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/');
                await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
                allData.keuangan = await page.evaluate(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const targetTable = tables.find(t => t.innerText.includes('THAKA') && t.innerText.includes('BAYAR'));
                    
                    if (targetTable) {
                        Array.from(targetTable.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            const thakaIdx = texts.findIndex(t => /^\d{5}$/.test(t));
                            if (thakaIdx === -1) return;

                            const thaka = texts[thakaIdx];
                            const nominalRaw = texts[thakaIdx + 1] || "0";
                            const tgl = texts.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t)) || "-";
                            
                            const th = thaka.substring(0, 4);
                            const sm = thaka.substring(4, 5) === '1' ? 'Ganjil' : 'Genap';
                            
                            const nominalVal = parseInt(nominalRaw.split(',')[0].replace(/\./g, '')) || 0;
                            const isLunas = tgl.length > 5 && !tgl.includes('-');
                            
                            let status = isLunas ? "Lunas" : "Belum Bayar";
                            if (nominalVal === 0 && !isLunas) status = "Menunggu Tagihan";
                            if (nominalVal === 0 && isLunas) status = "Lunas (Beasiswa/0)";

                            res.push({
                                thaka, semester: `Semester ${sm} ${th}/${parseInt(th)+1}`,
                                nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominalVal)}`,
                                spp: nominalVal, total: nominalVal, tglBayar: tgl, status,
                                rincian: [{ label: "SPP / UKT", value: nominalVal }]
                            });
                        });
                    }
                    const riwayat = res.reverse();
                    const uktTotal = riwayat.reduce((a: number, b: any) => a + (b.spp || 0), 0);
                    return { riwayat, totals: { ukt: uktTotal } };
                });
            } catch (e) { console.log("Skip Keuangan"); }

            // --- 4. REGISTRASI (Auto-Scan) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-registrasi/');
                await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
                
                allData.registrasi = await page.evaluate(() => {
                    const out: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('status')) || tables[0];
                    
                    if (pick) {
                        Array.from(pick.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                            
                            const rawSem = texts.find(t => /^\d{5}$/.test(t));
                            let status = texts.find(t => /^(aktif|cuti|lulus|non-aktif|keluar)$/i.test(t));
                            if (!status) status = texts[texts.length - 1];

                            if (rawSem) {
                                const th = rawSem.substring(0, 4);
                                const k = rawSem.substring(4, 5);
                                const lb = k === '1' ? 'Ganjil' : (k === '2' ? 'Genap' : 'Antara');
                                const semLabel = `Semester ${lb} ${th}/${parseInt(th)+1}`;
                                if (status && status !== '-') {
                                    out.push({ semester: semLabel, status: status });
                                }
                            }
                        });
                    }
                    return out; 
                });
            } catch (e) { console.log("Skip Registrasi"); }

            // --- 5. KHS (Fix IPS) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/khs/');
                await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
                
                allData.khs = await page.evaluate(() => {
                    const body = document.body.innerText;
                    const ipsMatch = body.match(/IPS\s*[:=]?\s*(\d[\.,]\d{2})/i);
                    const ipkMatch = body.match(/IPK\s*[:=]?\s*(\d[\.,]\d{2})/i);
                    
                    const ipsFixed = ipsMatch ? ipsMatch[1].replace(',', '.') : "0.00";
                    const ipkFixed = ipkMatch ? ipkMatch[1].replace(',', '.') : "0.00";
                    
                    return { ips: ipsFixed, ipk_temp: ipkFixed, semester: "Semester Ini" };
                });
                
                allData.dhs = { ipk: allData.khs.ipk_temp || "0.00", totalSks: "0" };
            } catch (e) { console.log("Skip KHS"); }

            // --- 6. JADWAL (Scan Pintar) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/krs/');
                await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
                
                allData.jadwal = await page.evaluate(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('mata kuliah')) || tables[0];
                    
                    if (pick) {
                        Array.from(pick.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const texts = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            const hari = texts.find(t => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)$/i.test(t)) || "";
                            const jam = texts.find(t => /\d{2}:\d{2}/.test(t)) || "";
                            const ruang = texts.find(t => t.includes('Gedung') || /[A-Z]\d{2,3}/.test(t)) || "";
                            const matkul = texts.find(t => t.length > 5 && !/\d{2}:\d{2}/.test(t) && !/^(Senin|Selasa|Rabu|Kamis|Jumat)$/i.test(t) && !t.includes('Gedung'));

                            if (matkul && matkul.toLowerCase() !== 'total' && !matkul.toLowerCase().includes('sks')) {
                                res.push({ matkul, hari: hari || "-", jam: jam || "-", ruang: ruang || "-", dosen: "-" });
                            }
                        });
                    }
                    return res;
                });
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