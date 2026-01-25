import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

// --- IMPORT UNTUK LOCAL (LAPTOP) ---
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// --- IMPORT UNTUK VERCEL (PRODUCTION) ---
import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

// Aktifkan Stealth hanya di Local (Vercel sering crash kalau pakai ini)
if (process.env.NODE_ENV !== 'production') {
    puppeteer.use(StealthPlugin());
}

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Durasi robot 60 detik (PENTING BUAT VERCEL)

export async function POST(request: Request) {
    let nim = "";
    let password = "";
    let body: Record<string, unknown> = {};

    try {
        const parsed: unknown = await request.json();
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch { body = {}; }

    // Ambil NIM & Password
    nim = String(body.nim || "").trim();
    password = String(body.password || "");

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('siakad_session')?.value;
    const session = getSession(sessionToken);
    const useSession = !password && !!session;

    // Cek Kredensial
    if (!useSession && (!nim || !password)) {
        return NextResponse.json({ success: false, message: "Login gagal. Masukkan NIM & Password." }, { status: 401 });
    }
    if (useSession) nim = session!.nim;

    const inflightKey = sessionToken ? `token:${sessionToken}` : `nim:${nim}`;

    return await dedupeInflight(inflightKey, async () => {
        let browser;
        try {
            console.log("🚀 Memulai Robot Scraper...");

            // --- LOGIKA PEMILIHAN BROWSER (LOCAL vs VERCEL) ---
            if (process.env.NODE_ENV === 'production') {
                // MODE VERCEL (Ringan)
                console.log("⚙️ Mode: Production (Vercel/Serverless)");
                browser = await puppeteerCore.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            } else {
                // MODE LAPTOP (Lengkap)
                console.log("⚙️ Mode: Development (Local)");
                browser = await puppeteer.launch({
                    headless: true, // Ubah false kalau mau lihat robotnya
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
                });
            }

            const page = await browser.newPage();
            
            // Timeout Vercel harus panjang
            page.setDefaultNavigationTimeout(60000); 
            page.setDefaultTimeout(30000);
            await page.setViewport({ width: 1366, height: 768 });

            // User Agent (Penting biar gak dikira bot)
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

            // Helper: Retry Navigasi
            const gotoWithRetry = async (url: string) => {
                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
                } catch (e) {
                    console.log(`Retrying ${url}...`);
                    await page.reload({ waitUntil: 'networkidle2' });
                }
            };
            const waitForTable = async () => {
                try { await page.waitForSelector('table', { timeout: 15000 }); } catch {}
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

            // Cek Login Berhasil
            const isLogin = await page.evaluate(() => !document.querySelector('input[type="password"]'));
            if (!isLogin) throw new Error("Gagal Login (Password Salah / Captcha)");

            // Penampung Data
            const allData: any = { profile: {}, keuangan: {}, registrasi: [], khs: {}, dhs: {}, jadwal: [], dhe: [] };

            // --- 2. SCRAPE PROFIL ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/dashboard/');
                allData.profile = await page.evaluate(() => {
                    const body = document.body.innerText;
                    const getText = (k: string) => {
                        const m = body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i'));
                        return m ? m[1].trim().replace(/^[:\-\s]+/, '') : "-";
                    };
                    return {
                        name: document.querySelector('.user-name span')?.textContent?.trim() || "Mahasiswa",
                        prodi: getText('Program Studi'),
                        fakultas: getText('Fakultas'),
                        dosenPa: getText('Dosen PA'),
                        status: getText('Status'),
                        jalur: getText('Jalur Masuk')
                    };
                });
            } catch (e) { console.log("Skip Profil"); }

            // --- 3. SCRAPE KEUANGAN (AUTO-PILOT & FIX 450 JUTA) ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/');
                await waitForTable();
                
                allData.keuangan = await page.evaluate(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const targetTable = tables.find(t => 
                        (t.innerText.includes('THAKA') || t.innerText.includes('Thaka')) && 
                        (t.innerText.includes('TGL BAYAR') || t.innerText.includes('Tgl Bayar'))
                    );

                    if (targetTable) {
                        const rows = Array.from(targetTable.querySelectorAll('tr'));
                        rows.forEach((row, idx) => {
                            if (idx === 0) return;
                            const cols = Array.from(row.querySelectorAll('td'));
                            const texts = cols.map(c => (c.innerText || "").trim());

                            // Cari index kolom THAKA (5 digit angka, ex: 20251)
                            const thakaIndex = texts.findIndex(t => /^\d{5}$/.test(t));
                            if (thakaIndex === -1) return;

                            const thakaRaw = texts[thakaIndex];
                            // Nominal biasanya tepat di sebelah kanan THAKA
                            const nominalRaw = texts[thakaIndex + 1] || "0";
                            // Cari Tanggal (dd/mm/yyyy)
                            const tglBayarRaw = texts.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t)) || "-";

                            // Parsing Semester
                            const tahun = thakaRaw.substring(0, 4);
                            const kode = thakaRaw.substring(4, 5);
                            const label = kode === '1' ? 'Ganjil' : (kode === '2' ? 'Genap' : 'Antara');
                            const semesterNama = `Semester ${label} ${tahun}/${parseInt(tahun) + 1}`;

                            // Parsing Nominal (FIX 450 JUTA)
                            // "4.500.000,00" -> ambil "4.500.000" -> buang titik -> "4500000"
                            const mainNominal = nominalRaw.split(',')[0];
                            const nominalValue = parseInt(mainNominal.replace(/\./g, '')) || 0;
                            const nominalDisplay = `Rp ${new Intl.NumberFormat('id-ID').format(nominalValue)}`;

                            // Cek Status Lunas
                            const isLunas = (tglBayarRaw.length > 5 && !tglBayarRaw.includes('-'));
                            let statusFinal = isLunas ? "Lunas" : "Belum Bayar";
                            if (nominalValue === 0 && !isLunas) statusFinal = "Menunggu Tagihan";
                            if (nominalValue === 0 && isLunas) statusFinal = "Lunas (Beasiswa/0)";

                            res.push({
                                thaka: thakaRaw,
                                semester: semesterNama,
                                nominal: nominalDisplay,
                                spp: nominalValue,
                                total: nominalValue,
                                tglBayar: tglBayarRaw,
                                status: statusFinal,
                                rincian: [{ label: "SPP / UKT", value: nominalValue }]
                            });
                        });
                    }
                    
                    const riwayat = res.reverse();
                    const uktTotal = riwayat.reduce((acc: number, r: any) => acc + (r.spp || 0), 0);
                    return { riwayat, totals: { ukt: uktTotal } };
                });
            } catch (e) { console.log("Skip Keuangan"); }

            // --- 4. SCRAPE REGISTRASI ---
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-registrasi/');
                await waitForTable();
                allData.registrasi = await page.evaluate(() => {
                    const out: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('status')) || tables[0];
                    if (pick) {
                        const rows = Array.from(pick.querySelectorAll('tr'));
                        rows.forEach((row, idx) => {
                            if (idx === 0) return;
                            const cols = row.querySelectorAll('td');
                            if (cols.length >= 2) {
                                let rawSemester = (cols[0]?.innerText || "").trim();
                                const status = (cols[cols.length - 1]?.innerText || "").trim();
                                
                                if (rawSemester.length === 5 && !isNaN(Number(rawSemester))) {
                                    const th = rawSemester.substring(0, 4);
                                    const k = rawSemester.substring(4, 5);
                                    const lb = k === '1' ? 'Ganjil' : (k === '2' ? 'Genap' : 'Antara');
                                    rawSemester = `Semester ${lb} ${th}/${parseInt(th) + 1}`;
                                }
                                out.push({ semester: rawSemester, status });
                            }
                        });
                    }
                    return out;
                });
            } catch (e) { console.log("Skip Registrasi"); }

            console.log("🎉 Scraping Selesai!");
            
            // Simpan Session Cookies
            let outSessionToken = sessionToken;
            try {
                const latestCookies = await page.cookies();
                if (useSession && outSessionToken) {
                    updateSession(outSessionToken, latestCookies as any);
                } else {
                    const created = createSession(nim, latestCookies as any);
                    outSessionToken = created.token;
                }
            } catch {}

            await browser.close();

            const res = NextResponse.json({ success: true, nim, ...allData });
            if (outSessionToken) {
                res.cookies.set('siakad_session', outSessionToken, { httpOnly: true, secure: true, path: '/' });
            }
            return res;

        } catch (error: any) {
            if (browser) await browser.close();
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}