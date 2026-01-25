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

if (process.env.NODE_ENV !== 'production') {
    puppeteer.use(StealthPlugin());
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Waktu maksimal robot bekerja (60 detik)

// Helper Parsing Nominal (Biar gak 450 Juta)
const parseNominal = (raw: string | undefined | null) => {
    if (!raw) return 0;
    const first = String(raw).split(',')[0]; // Ambil sebelum koma
    const digits = first.replace(/\./g, '').replace(/[^0-9-]/g, '');
    const n = parseInt(digits || '0', 10);
    return Number.isFinite(n) ? n : 0;
};

// Helper Format Semester (20251 -> Semester Ganjil 2025/2026)
const formatSemester = (code: string) => {
    const s = code.trim();
    if (/^\d{5}$/.test(s)) {
        const th = s.substring(0, 4);
        const k = s.substring(4, 5);
        const l = k === '1' ? 'Ganjil' : (k === '2' ? 'Genap' : 'Antara');
        return `Semester ${l} ${th}/${parseInt(th) + 1}`;
    }
    return s; // Kembalikan aslinya kalau bukan kode angka
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
        return NextResponse.json({ success: false, message: "Login gagal. Masukkan NIM & Password." }, { status: 401 });
    }
    if (useSession) nim = session!.nim;

    const inflightKey = sessionToken ? `token:${sessionToken}` : `nim:${nim}`;

    return await dedupeInflight(inflightKey, async () => {
        let browser: any = null;
        try {
            console.log("🚀 Memulai Robot Scraper (Full Sync)...");

            // 1. SETUP BROWSER (Vercel vs Local)
            if (process.env.NODE_ENV === 'production') {
                console.log("⚙️ Mode: Production (Vercel)");
                browser = await puppeteerCore.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            } else {
                console.log("⚙️ Mode: Development (Local)");
                browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
                });
            }

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);
            page.setDefaultTimeout(30000);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

            const gotoWithRetry = async (url: string) => {
                try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); }
                catch { console.log(`Retry ${url}`); await page.reload({ waitUntil: 'networkidle2' }); }
            };
            const waitForTable = async () => { try { await page.waitForSelector('table', { timeout: 10000 }); } catch {} };

            // 2. LOGIN PROCESS
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
            if (!isLogin) throw new Error("Gagal Login (Cek NIM/Password)");

            // --- DATA CONTAINER ---
            const allData: any = { profile: {}, keuangan: {}, registrasi: [], khs: {}, dhs: {}, jadwal: [], dhe: [] };

            // 3. SCRAPE PROFIL (Dashboard)
            try {
                await gotoWithRetry('https://siakad.um.ac.id/dashboard/');
                allData.profile = await page.evaluate(() => {
                    const body = document.body.innerText;
                    // Regex pintar untuk cari teks setelah titik dua
                    const getVal = (key: string) => {
                        const regex = new RegExp(`${key}\\s*[:]?\\s*([^\\n]+)`, 'i');
                        const m = body.match(regex);
                        return m ? m[1].trim().replace(/^[:\-\s]+/, '') : "-";
                    };
                    return {
                        name: document.querySelector('.user-name span')?.textContent?.trim() || "Mahasiswa",
                        prodi: getVal('Program Studi') !== '-' ? getVal('Program Studi') : getVal('Prodi'),
                        fakultas: getVal('Fakultas'),
                        dosenPa: getVal('Dosen PA'),
                        status: getVal('Status'),
                        jalur: getVal('Jalur Masuk'),
                        foto: (document.querySelector('img[src*="foto"]') as HTMLImageElement)?.src || null
                    };
                });
            } catch (e) { console.log("Skip Profil"); }

            // 4. SCRAPE KEUANGAN (Logika Auto-Pilot)
            try {
                await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/');
                await waitForTable();
                allData.keuangan = await page.evaluate(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const target = tables.find(t => t.innerText.includes('THAKA') && t.innerText.toUpperCase().includes('TGL BAYAR'));

                    if (target) {
                        const rows = Array.from(target.querySelectorAll('tr'));
                        rows.forEach((row, idx) => {
                            if (idx === 0) return;
                            const cols = Array.from(row.querySelectorAll('td'));
                            const texts = cols.map(c => (c.innerText || "").trim());

                            // Cari index kolom secara otomatis
                            const thakaIdx = texts.findIndex(t => /^\d{5}$/.test(t));
                            if (thakaIdx === -1) return;

                            const thakaRaw = texts[thakaIdx];
                            const nominalRaw = texts[thakaIdx + 1] || "0";
                            const tglRaw = texts.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t)) || "-";

                            // Parsing Nominal Benar
                            const mainNominal = nominalRaw.split(',')[0];
                            const nominalValue = parseInt(mainNominal.replace(/\./g, '')) || 0;
                            const nominalDisplay = `Rp ${new Intl.NumberFormat('id-ID').format(nominalValue)}`;

                            // Parsing Semester
                            const th = thakaRaw.substring(0, 4);
                            const kd = thakaRaw.substring(4, 5);
                            const lb = kd === '1' ? 'Ganjil' : (kd === '2' ? 'Genap' : 'Antara');
                            const semNama = `Semester ${lb} ${th}/${parseInt(th) + 1}`;

                            // Status Logic
                            const isLunas = tglRaw.length > 6 && !tglRaw.includes('-');
                            let status = isLunas ? "Lunas" : "Belum Bayar";
                            if (nominalValue === 0 && !isLunas) status = "Menunggu Tagihan";
                            if (nominalValue === 0 && isLunas) status = "Lunas (Beasiswa/0)";

                            res.push({
                                thaka: thakaRaw,
                                semester: semNama,
                                nominal: nominalDisplay,
                                spp: nominalValue,
                                tglBayar: tglRaw,
                                status: status,
                                total: nominalValue,
                                rincian: [{ label: "SPP / UKT", value: nominalValue }]
                            });
                        });
                    }
                    const riwayat = res.reverse();
                    const uktTotal = riwayat.reduce((a: number, b: any) => a + (b.spp || 0), 0);
                    return { riwayat, totals: { ukt: uktTotal } };
                });
            } catch (e) { console.log("Skip Keuangan"); }

            // 5. SCRAPE REGISTRASI (Full Sync)
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
                                // Kolom 1 biasanya semester, kolom terakhir status
                                let rawSem = (cols[0]?.innerText || "").trim();
                                const stat = (cols[cols.length - 1]?.innerText || "").trim();

                                // Konversi 20251 -> Semester Ganjil
                                if (/^\d{5}$/.test(rawSem)) {
                                    const th = rawSem.substring(0, 4);
                                    const k = rawSem.substring(4, 5);
                                    const lb = k === '1' ? 'Ganjil' : (k === '2' ? 'Genap' : 'Antara');
                                    rawSem = `Semester ${lb} ${th}/${parseInt(th) + 1}`;
                                }
                                out.push({ semester: rawSem, status: stat });
                            }
                        });
                    }
                    return out; // Ambil semua history
                });
            } catch (e) { console.log("Skip Registrasi"); }

            // 6. SCRAPE KHS (Kartu Hasil Studi - IPS)
            try {
                await gotoWithRetry('https://siakad.um.ac.id/khs/');
                await waitForTable();
                allData.khs = await page.evaluate(() => {
                    const body = document.body.innerText;
                    // Cari text IPS : 3.50
                    const ipsMatch = body.match(/IPS\s*[:=]?\s*(\d[\.,]\d{2})/i);
                    const ips = ipsMatch ? ipsMatch[1].replace(',', '.') : "0.00";
                    
                    // Ambil detail matkul (opsional, diambil simple saja biar cepat)
                    const matkul: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const tMatkul = tables.find(t => t.innerText.toLowerCase().includes('sks') && t.innerText.toLowerCase().includes('nilai'));
                    if(tMatkul) {
                         const rows = Array.from(tMatkul.querySelectorAll('tr')).slice(1);
                         rows.forEach(r => {
                            const c = r.querySelectorAll('td');
                            if(c.length > 4) {
                                matkul.push({
                                    matkul: c[1]?.innerText || "MK",
                                    sks: c[2]?.innerText || "0",
                                    nilai: c[4]?.innerText || "-"
                                });
                            }
                         });
                    }

                    return { semester: "Semester Ini", ips: ips, matkul: matkul };
                });
            } catch (e) { console.log("Skip KHS"); }

            // 7. SCRAPE JADWAL (KRS)
            try {
                await gotoWithRetry('https://siakad.um.ac.id/krs/'); // Atau /jadwal/ tergantung link
                await waitForTable();
                allData.jadwal = await page.evaluate(() => {
                    const out: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    // Cari tabel yang ada 'Hari' atau 'Jam'
                    const tJadwal = tables.find(t => t.innerText.includes('Hari') || t.innerText.includes('Jam') || t.innerText.includes('Waktu'));
                    
                    if(tJadwal) {
                        const rows = Array.from(tJadwal.querySelectorAll('tr')).slice(1);
                        rows.forEach(r => {
                            const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                            // Logika cari kolom otomatis
                            const hari = c.find(txt => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)$/i.test(txt)) || "";
                            const jam = c.find(txt => /\d{2}:\d{2}/.test(txt)) || "";
                            const ruang = c.find(txt => /Gedung/i.test(txt) || /[A-Z]\d{2,3}/.test(txt)) || "";
                            // Matkul biasanya yang teksnya panjang dan bukan hari/jam
                            const matkul = c.find(txt => txt.length > 5 && txt !== hari && txt !== jam && txt !== ruang) || "Mata Kuliah";

                            if(matkul && matkul !== "Mata Kuliah") {
                                out.push({ hari, jam, matkul, ruang, dosen: "" });
                            }
                        });
                    }
                    return out;
                });
            } catch (e) { console.log("Skip Jadwal"); }

            console.log("🎉 Scraping Selesai!");

            // Simpan Session
            let outSessionToken = sessionToken;
            try {
                const latestCookies = await page.cookies();
                if (useSession && outSessionToken) updateSession(outSessionToken, latestCookies as any);
                else outSessionToken = createSession(nim, latestCookies as any).token;
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