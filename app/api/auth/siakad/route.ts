import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Profile = {
    name: string;
    prodi: string;
    fakultas: string;
    dosenPa: string;
    status: string;
    jalur: string;
    foto: string | null;
};

type KeuanganMaster = {
    spp: number;
    hotma: number;
    spsa: number;
    kpmb: number;
    bpp: number;
    lain: number;
    total: number;
    extra?: Record<string, number>;
};

type KeuanganRiwayat = {
    thaka: string;
    // Human-friendly label derived from THAKA, e.g. "Semester Ganjil 2025/2026"
    semester?: string;
    // Total tagihan formatted server-side (optional; UI can still format numbers)
    nominal?: string;
    // Fee breakdown in order as shown in the table
    rincian?: Array<{ label: string; value: number }>;
    // All parsed fees by normalized header label
    fees?: Record<string, number>;
    spp: number;
    hotma: number;
    spsa: number;
    kpmb: number;
    bpp: number;
    kkn: number;
    ppl: number;
    lain: number;
    total: number;
    tglBayar: string;
    bank: string;
    status: string;
    ukt: number;
    extra?: Record<string, number>;
};

type KeuanganPayload = {
    master: KeuanganMaster;
    riwayat: KeuanganRiwayat[];
    totals: {
        ukt: number;
        totalPaid: number;
        paidCount: number;
        unpaidCount: number;
        activeThaka?: string;
    };
};

type RegistrasiItem = { semester: string; status: string };
type KhsItem = { matkul: string; sks: number; nilai: string };
type Khs = { semester: string; ips: string; matkul: KhsItem[] };
type Dhs = { ipk: string; totalSks: string };
type JadwalItem = { matkul: string; hari: string; jam: string; ruang: string; dosen?: string };
type DheItem = { kegiatan: string; poin: string };

type AllData = {
    profile: Profile;
    keuangan: KeuanganPayload;
    registrasi: RegistrasiItem[];
    khs: Khs;
    dhs: Dhs;
    jadwal: JadwalItem[];
    dhe: DheItem[];
};

puppeteer.use(StealthPlugin());

export async function POST(request: Request) {
    let nim = "";
    let password = "";
    let debugFromBody = false;
    let screenshotFromBody = false;
    let debugEnabled = false;
    let debug: Record<string, unknown> = {};
    let body: Record<string, unknown> = {};
    try {
        const parsed: unknown = await request.json();
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
        body = {};
    }

    nim = String(body.nim || "").trim();
    password = String(body.password || "");
    debugFromBody = Boolean(body.debug);
    screenshotFromBody = Boolean(body.debugScreenshot);

    // If password is not provided, try cookie-based session sync.
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('siakad_session')?.value;
    const session = getSession(sessionToken);
    const useSession = !password && !!session;

    if (!useSession && (!nim || !password)) {
        return NextResponse.json(
            { success: false, message: "Sesi tidak ditemukan atau sudah habis. Silakan login ulang dengan NIM & password." },
            { status: 401 },
        );
    }

    if (useSession) {
        nim = session!.nim;
    }

    // Dedupe concurrent sync calls to avoid multiple Puppeteer instances.
    const inflightKey = (sessionToken ? `token:${sessionToken}` : nim ? `nim:${nim}` : 'anon') as string;

    return await dedupeInflight(inflightKey, async () => {
    let browser;
    try {
    // 1. SETUP BROWSER (Debug Mode: ON)
    console.log("🚀 Memulai Robot Scraper (Mode Sabar)...");
        const headless = process.env.PUPPETEER_HEADLESS
            ? process.env.PUPPETEER_HEADLESS !== "false"
            : process.env.NODE_ENV === "production";

                browser = await puppeteer.launch({
            headless, // Production default: headless
      defaultViewport: null,
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
    });

    const page = await browser.newPage();

    // Default timeouts (avoid "scrape terlalu cepat")
    const TIMEOUT_NAV = 90_000;
    const TIMEOUT_EL = 45_000;
    page.setDefaultNavigationTimeout(TIMEOUT_NAV);
    page.setDefaultTimeout(TIMEOUT_EL);

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        );
        await page.setExtraHTTPHeaders({
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        });

    const slowMoMs = process.env.PUPPETEER_SLOWMO ? Number(process.env.PUPPETEER_SLOWMO) : 0;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const stepDelay = async (ms = 350) => {
        const extra = slowMoMs > 0 ? slowMoMs : 0;
        await sleep(ms + extra);
    };

    const gotoWithRetry = async (url: string, attempts = 2) => {
        let lastError: unknown;
        for (let i = 0; i < attempts; i++) {
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_NAV });
                return;
            } catch (err) {
                lastError = err;
                try {
                    await page.reload({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV });
                    return;
                } catch {
                    // keep retrying
                }
                await stepDelay(800);
            }
        }
        throw lastError;
    };

        const getFramesSafe = () => {
            // Include main frame + any iframes
            const frames = page.frames();
            // Prefer main frame first
            const main = page.mainFrame();
            const ordered = [main, ...frames.filter((f) => f !== main)];
            return ordered;
        };

        const waitForAnyTableInFrames = async (timeoutMs = TIMEOUT_EL) => {
            const start = Date.now();
            let lastSeen = 0;
            while (Date.now() - start < timeoutMs) {
                const frames = getFramesSafe();
                for (const frame of frames) {
                    try {
                        const count = await frame.$$eval('table', (tables) => tables.length);
                        if (count > 0) return;
                    } catch {
                        // frame might be detached
                    }
                }

                // Additionally: some pages render "table" via divs; check for many rows/cells
                for (const frame of frames) {
                    try {
                        const score = await frame.evaluate(() => {
                            const txt = (document.body as HTMLElement).innerText || document.body.textContent || '';
                            // Heuristic: if lots of lines and it contains semester-like or Rp-like patterns, consider it "loaded"
                            const lines = txt.split('\n').map((s) => s.trim()).filter(Boolean);
                            const hasSemester = lines.some((l) => /20\d{2}\/?\d*/.test(l));
                            const hasMoney = lines.some((l) => /Rp\.?\s?[\d\.]+/.test(l));
                            return (lines.length > 30 ? 1 : 0) + (hasSemester ? 1 : 0) + (hasMoney ? 1 : 0);
                        });
                        if (score >= 2) return;
                    } catch {
                        // ignore
                    }
                }

                lastSeen++;
                // backoff a bit
                await stepDelay(500 + Math.min(lastSeen, 10) * 100);
            }
            throw new Error('Tabel/konten tidak terdeteksi (cek apakah diblokir atau berubah struktur).');
        };

        const evalFirstFrame = async <T>(fn: () => T): Promise<T | null> => {
            for (const frame of getFramesSafe()) {
                try {
                    const result = await frame.evaluate(fn);
                    if (result !== null && result !== undefined) return result as T;
                } catch {
                    // ignore
                }
            }
            return null;
        };

        const evalFirstFrameArgs = async <T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T | null> => {
            for (const frame of getFramesSafe()) {
                try {
                    const result = await frame.evaluate(fn as (...innerArgs: unknown[]) => unknown, ...(args as unknown[]));
                    if (result !== null && result !== undefined) return result as T;
                } catch {
                    // ignore
                }
            }
            return null;
        };

        const parseRegistrasiKey = (semesterLabel: string) => {
            const s = (semesterLabel || '').toLowerCase();
            const yearMatch = semesterLabel.match(/(20\d{2})\s*\/\s*(20\d{2})/);
            const yearStart = yearMatch ? Number(yearMatch[1]) : 0;
            // semester can be Gasal/Ganjil/Genap/Antara
            const term = s.includes('genap') ? 2 : (s.includes('gasal') || s.includes('ganjil')) ? 1 : s.includes('antara') ? 3 : 0;
            return { yearStart, term };
        };

        const sortRegistrasi = (items: RegistrasiItem[]) => {
            const scoreStatus = (st: string) => {
                const s = (st || '').toLowerCase();
                // Prefer aktif on top
                if (s.includes('aktif')) return 2;
                if (s.includes('selesai') || s.includes('valid') || s.includes('lunas')) return 1;
                return 0;
            };
            return [...items].sort((a, b) => {
                const ka = parseRegistrasiKey(a.semester);
                const kb = parseRegistrasiKey(b.semester);
                if (kb.yearStart !== ka.yearStart) return kb.yearStart - ka.yearStart;
                if (kb.term !== ka.term) return kb.term - ka.term;
                return scoreStatus(b.status) - scoreStatus(a.status);
            });
        };

        const deriveActivePeriod = (items: RegistrasiItem[]) => {
            const sorted = sortRegistrasi(items);
            const active = sorted.find((x) => (x.status || '').toLowerCase().includes('aktif')) || sorted[0];
            if (!active) return null;
            const year = active.semester.match(/20\d{2}\s*\/\s*20\d{2}/)?.[0]?.replace(/\s+/g, '') || null;
            const s = active.semester.toLowerCase();
            const term = s.includes('genap') ? 'Genap' : (s.includes('gasal') || s.includes('ganjil')) ? 'Gasal' : s.includes('antara') ? 'Antara' : null;
            if (!year || !term) return null;
            return { year, term };
        };

    const assertLoggedIn = async () => {
        // Heuristic: after login, username/password inputs should not be visible
        const stillOnLogin = await page.evaluate(() => {
            const userInput = document.querySelector('input[name="username"], input[name="identity"], #username') as HTMLInputElement | null;
            const passInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
            const visible = (el: Element | null) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style.visibility !== 'hidden' && style.display !== 'none' && (el as HTMLElement).offsetParent !== null;
            };
            return visible(userInput) && visible(passInput);
        });
        if (stillOnLogin) {
            throw new Error('Login belum berhasil (form masih terlihat).');
        }
    };

        debugEnabled = process.env.SIAKAD_DEBUG === '1' || debugFromBody;
        const screenshotEnabled = process.env.SIAKAD_DEBUG_SCREENSHOT === '1' || screenshotFromBody;
        debug = {};
        const safeScreenshot = async () => {
            if (!screenshotEnabled) return undefined;
            try {
                // Keep it small-ish to avoid huge payloads
                return await page.screenshot({ encoding: 'base64', fullPage: false });
            } catch {
                return undefined;
            }
        };
        const pushDebug = async (key: string) => {
            if (!debugEnabled) return;
            try {
                debug[key] = {
                    url: page.url(),
                    title: await page.title(),
                    frames: page.frames().map((f) => f.url()).slice(0, 10),
                    snippet: await page.evaluate(() => {
                        const txt = (document.body as HTMLElement).innerText || document.body.textContent || '';
                        return txt.replace(/\s+/g, ' ').slice(0, 600);
                    }),
                    screenshotBase64: await safeScreenshot(),
                };
            } catch {
                debug[key] = { url: page.url(), note: 'debug_failed' };
            }
        };

        const isLoginVisibleInAnyFrame = async () => {
            for (const frame of getFramesSafe()) {
                try {
                    const hasPassword = await frame.$('input[type="password"]');
                    const hasUser =
                        (await frame.$('input[name="username"], input[name="identity"], #username')) ||
                        (await frame.$('input[type="text"][name="username"], input[type="text"][name="identity"]'));
                    if (hasPassword && hasUser) return true;
                } catch {
                    // ignore detached/cross-origin frames
                }
            }
            return false;
        };

        const assertStillLoggedIn = async (label: string) => {
            const maybeLoggedOut = await isLoginVisibleInAnyFrame();
            if (maybeLoggedOut) {
                await pushDebug(`logged_out_${label}`);
                throw new Error('Sesi login hilang / kembali ke halaman login saat membuka fitur. Coba login ulang.');
            }
        };
    
    // 2. AUTH (login or cookie-session restore)
    if (useSession) {
        // Ensure correct origin before setting cookies
        await gotoWithRetry('https://siakad.um.ac.id/', 2);
        await stepDelay();
        try {
            cleanupSessions();
            await page.setCookie(...session!.cookies);
            await stepDelay(400);
            await pushDebug('session_restored');
        } catch {
            await browser.close();
            return NextResponse.json(
                { success: false, message: 'Gagal memulihkan sesi. Silakan login ulang.' },
                { status: 401 },
            );
        }
    } else {
        await gotoWithRetry('https://siakad.um.ac.id/', 2);
        await stepDelay();
        const inputSelector = 'input[name="username"], input[name="identity"], #username';
        try {
            await page.waitForSelector(inputSelector, { visible: true, timeout: 30000 });
            await page.type(inputSelector, nim);
            await page.type('input[type="password"]', password);
            await Promise.all([
              page.click('button[type="submit"], input[type="submit"]'),
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
            ]);
            await stepDelay(600);
            await assertLoggedIn();
            await pushDebug('after_login');
        } catch {
            await browser.close();
            return NextResponse.json({ success: false, message: 'Gagal Login' }, { status: 500 });
        }
    }

    // Penampung Data
    const allData: AllData = {
        profile: { name: "", prodi: "-", fakultas: "-", dosenPa: "-", status: "Aktif", jalur: "-", foto: null },
        keuangan: {
            master: { spp: 0, hotma: 0, spsa: 0, kpmb: 0, bpp: 0, lain: 0, total: 0 },
            riwayat: [],
            totals: { ukt: 0, totalPaid: 0, paidCount: 0, unpaidCount: 0 },
        },
        registrasi: [],
        khs: { semester: "-", ips: "0.00", matkul: [] },
        dhs: { ipk: "0.00", totalSks: "0" },
        jadwal: [],
        dhe: []
    };

    // Helper Regex
    const extractText = (text: string, keyword: string) => {
        const regex = new RegExp(`${keyword}\\s*[:]?\\s*([^\\n]+)`, 'i');
        const match = text.match(regex);
        return match && match[1] ? match[1].trim().replace(/^[:\-\s]+/, '') : "-";
    };

    // ---------------------------------------------------------
    // LINK 1: DASHBOARD (Profil)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek Dashboard...");
        await gotoWithRetry('https://siakad.um.ac.id/dashboard/', 2);
        await assertStillLoggedIn('dashboard');
        // Wait until dashboard content is present
        await page.waitForFunction(
            () => {
                const body = (document.body as HTMLElement).innerText || document.body.textContent || "";
                return body.includes('Selamat') || body.toLowerCase().includes('dashboard') || !!document.querySelector('img');
            },
            { timeout: TIMEOUT_EL },
        );
        await stepDelay();

        await pushDebug('dashboard');

        // Ambil Data Profil (frame-aware)
        const bodyText =
            (await evalFirstFrame<string>(() =>
                (document.body as HTMLElement).innerText || document.body.textContent || '',
            )) ||
            (await page.evaluate(() => (document.body as HTMLElement).innerText || document.body.textContent || ''));
        
                const name =
                    (await evalFirstFrame<string>(() => {
                        const el = document.querySelector('.user-name span, .profile-name, a.aku') as HTMLElement | null;
                        const guess = el ? (el.textContent || '').trim() : '';
                        if (guess) return guess;
                        const body = (document.body as HTMLElement).innerText || document.body.textContent || '';
                        const match = body.match(/Selamat Datang,?\s*([^\n]+)/i);
                        return match?.[1]?.trim() || '';
                    })) || '';
        
        // Fallback: Cari di teks body "Selamat Datang, RIFKY"
        const normalizedName = !name || name === 'Dashboard' ? 'Mahasiswa' : name;

        // Ambil Foto
        let foto: string | null = null;
        try {
            const imgUrl = await evalFirstFrame<string | null>(() => {
                const img = document.querySelector('img[src*="foto"], img[src*="GetFoto"]');
                return img ? (img as HTMLImageElement).src : null;
            });
            if (imgUrl) {
                const viewSource = await page.goto(imgUrl);
                const buffer = await viewSource?.buffer();
                if(buffer) foto = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                await page.goBack(); 
            }
        } catch {}

        allData.profile = {
            name: normalizedName,
            prodi: extractText(bodyText, 'Program Studi') !== '-' ? extractText(bodyText, 'Program Studi') : extractText(bodyText, 'Prodi'),
            fakultas: extractText(bodyText, 'Fakultas'),
            dosenPa: extractText(bodyText, 'Dosen PA') !== '-' ? extractText(bodyText, 'Dosen PA') : extractText(bodyText, 'Penasihat'),
            status: extractText(bodyText, 'Status'),
            jalur: extractText(bodyText, 'Jalur Masuk'),
            foto: foto
        };
        console.log("✅ Profil Name:", allData.profile.name);
    } catch(error) { console.log("❌ Error Dashboard: " + String(error)); }


    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // LINK 2: RIWAYAT KEUANGAN (AUTO-PILOT COLUMN DETECTION)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek Keuangan...");
        await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/', 2);
        await assertStillLoggedIn('keuangan');
        await waitForAnyTableInFrames();
        await stepDelay();

        await pushDebug('keuangan');

        const keu = await page.evaluate(() => {
            const res: KeuanganRiwayat[] = [];

            const tables = Array.from(document.querySelectorAll('table'));
            // Cari tabel yang header/isinya relevan
            const targetTable = tables.find(t =>
                (t.innerText.includes('THAKA') || t.innerText.includes('Thaka')) &&
                (t.innerText.includes('TGL BAYAR') || t.innerText.includes('Tgl Bayar'))
            );

            if (targetTable) {
                const rows = Array.from(targetTable.querySelectorAll('tr'));
                
                rows.forEach((row, idx) => {
                    if (idx === 0) return; // Skip Header

                    const cols = Array.from(row.querySelectorAll('td'));
                    if (cols.length > 5) {
                        const texts = cols.map(c => (c.innerText || "").trim());

                        // --- LOGIKA PENCARIAN KOLOM OTOMATIS ---
                        
                        // 1. Cari Index Kolom THAKA (Ciri: Angka 5 digit, misal 20251)
                        // Kita cari yang isinya persis 5 angka
                        const thakaIndex = texts.findIndex(t => /^\d{5}$/.test(t));
                        
                        // Kalau tidak ketemu kolom THAKA yang valid, skip baris ini
                        if (thakaIndex === -1) return;

                        // 2. Ambil Data Berdasarkan Index THAKA
                        const thakaRaw = texts[thakaIndex]; // Contoh: "20251"
                        
                        // Nominal biasanya persis SEBELAH KANAN Thaka
                        const nominalRaw = texts[thakaIndex + 1] || "0"; // Contoh: "4.500.000,00"
                        
                        // Tanggal Bayar cari kolom yang formatnya dd/mm/yyyy
                        // Atau biasanya ada di index agak belakang (thakaIndex + 9)
                        const dateIndex = texts.findIndex((t, i) => i > thakaIndex && /\d{2}\/\d{2}\/\d{4}/.test(t));
                        const tglBayarRaw = dateIndex !== -1 ? texts[dateIndex] : "-";


                        // --- PROSES DATA ---

                        // Terjemahkan Semester
                        const tahun = thakaRaw.substring(0, 4);
                        const kode = thakaRaw.substring(4, 5);
                        const label = kode === '1' ? 'Ganjil' : (kode === '2' ? 'Genap' : 'Antara');
                        const semesterNama = `Semester ${label} ${tahun}/${parseInt(tahun) + 1}`;

                        // Bersihkan Nominal
                        // Fix: "4.500.000,00" jangan jadi 450000000
                        // 1) Split berdasarkan koma, ambil bagian depan (integer part)
                        // 2) Hapus titik (thousand separator)
                        // 3) Parse ke integer
                        const nominalIntPart = (nominalRaw.split(',')[0] || '0').trim();
                        const nominalDigits = nominalIntPart.replace(/\./g, '').replace(/[^0-9-]/g, '');
                        const nominalValue = parseInt(nominalDigits, 10) || 0;
                        const nominalDisplay = `Rp ${new Intl.NumberFormat('id-ID').format(nominalValue)}`;

                        // Cek Status Lunas
                        const isLunas = (tglBayarRaw.length > 5 && !tglBayarRaw.includes('-'));
                        let statusFinal = isLunas ? "Lunas" : "Belum Bayar";

                        // Handle kasus semester depan (20252) yang nominalnya 0 dan sudah ada tanggalnya
                        // Biasanya ini beasiswa atau belum generate tagihan
                        if (nominalValue === 0 && !isLunas) {
                             statusFinal = "Menunggu Tagihan";
                        } else if (nominalValue === 0 && isLunas) {
                             // Kalau 0 tapi Lunas (biasanya KIP-K), tetap Lunas
                             statusFinal = "Lunas (Beasiswa/0)";
                        }

                        res.push({
                            thaka: thakaRaw,
                            semester: semesterNama,
                            nominal: nominalDisplay,
                            spp: nominalValue,
                            // Dummy fields
                            hotma: 0, spsa: 0, kpmb: 0, bpp: 0, kkn: 0, ppl: 0, lain: 0,
                            total: nominalValue,
                            tglBayar: tglBayarRaw,
                            bank: "-",
                            status: statusFinal,
                            ukt: nominalValue,
                            fees: { "SPP": nominalValue },
                            rincian: [{ label: "SPP / UKT", value: nominalValue }]
                        });
                    }
                });
            }

            const master = { spp: 0, hotma: 0, spsa: 0, kpmb: 0, bpp: 0, lain: 0, total: 0 };
            const riwayat = res.reverse(); 
            const uktTotal = riwayat.reduce((acc: number, r: KeuanganRiwayat) => acc + (r.spp || 0), 0);
            const paidCount = riwayat.filter((r: KeuanganRiwayat) => r.status.includes("Lunas")).length;
            const unpaidCount = riwayat.length - paidCount;

            return {
                master,
                riwayat,
                totals: { ukt: uktTotal, totalPaid: 0, paidCount, unpaidCount }
            };
        });

        if (keu) allData.keuangan = keu;
        console.log("✅ Keuangan Auto-Pilot:", allData.keuangan.riwayat.length + " item");
    } catch { console.log("❌ Error Keuangan"); }


    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // LINK 3: RIWAYAT REGISTRASI (VERSI FIXED MANUAL)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek Registrasi...");
        await gotoWithRetry('https://siakad.um.ac.id/riwayat-registrasi/', 2);
        await assertStillLoggedIn('registrasi');
        await waitForAnyTableInFrames();
        await stepDelay();

        await pushDebug('registrasi');

        const reg = await page.evaluate(() => {
            const out: RegistrasiItem[] = [];
            const tables = Array.from(document.querySelectorAll('table'));
            
            // Cari tabel yang headernya ada 'Semester' atau 'Status'
            const pick = tables.find((t) => {
                const head = (t.innerText || '').toLowerCase();
                return head.includes('semester') || head.includes('status') || head.includes('thaka');
            }) || tables[0];

            if (pick) {
                const rows = Array.from(pick.querySelectorAll('tr'));
                
                // Lewati header (baris 0)
                rows.forEach((row, idx) => {
                    if (idx === 0) return;
                    
                    const cols = row.querySelectorAll('td');
                    if (cols.length >= 2) {
                        // Logika deteksi kolom:
                        // Biasanya: Kolom 1 = THAKA (20251), Kolom 2 atau Terakhir = Status
                        
                        // Ambil teks THAKA (misal: "20251" atau "Semester Ganjil...")
                        let rawSemester = (cols[0]?.innerText || cols[1]?.innerText || "").trim();
                        
                        // Cek kalau formatnya angka 5 digit (Contoh: 20251) -> Kita Terjemahkan
                        if (rawSemester.length === 5 && !isNaN(Number(rawSemester))) {
                            const tahun = rawSemester.substring(0, 4); // "2025"
                            const kode = rawSemester.substring(4, 5);  // "1"
                            const label = kode === '1' ? 'Ganjil' : (kode === '2' ? 'Genap' : 'Antara');
                            rawSemester = `Semester ${label} ${tahun}/${parseInt(tahun) + 1}`;
                        }

                        // Ambil Status (Cari yang teksnya 'Aktif', 'Cuti', dll)
                        // Kita gabungkan semua teks sisa buat cari kata kuncinya, atau ambil kolom terakhir
                        let status = (cols[cols.length - 1]?.innerText || "").trim();
                        // Kalau status kosong, coba kolom ke-3
                        if (!status || status === '-') status = (cols[2]?.innerText || "").trim();

                        out.push({
                            semester: rawSemester,
                            status: status
                        });
                    }
                });
            }
            return out; // Urutan biasanya sudah dari terbaru di SIAKAD
        });

        // Masukkan ke data utama
        allData.registrasi = reg || [];
        
        // Update Active Thaka untuk Keuangan (Biar sinkron)
        const activeReg = allData.registrasi.find((x) => (x.status || '').toLowerCase().includes('aktif')) || allData.registrasi[0];
        if (activeReg?.semester) {
            // Coba ambil tahun dari string "Semester Ganjil 2025/2026"
            const match = activeReg.semester.match(/(\d{4})/);
            const isGanjil = activeReg.semester.toLowerCase().includes('ganjil') || activeReg.semester.toLowerCase().includes('gasal');
            const isGenap = activeReg.semester.toLowerCase().includes('genap');
            
            if (match) {
                const tahun = match[1];
                const term = isGanjil ? '1' : (isGenap ? '2' : '3');
                allData.keuangan.totals.activeThaka = `${tahun}${term}`;
            }
        }

        console.log("✅ Registrasi Fixed:", allData.registrasi.length + " item");
    } catch { console.log("❌ Error Registrasi"); }


    // ---------------------------------------------------------
    // LINK 4: KHS (Kartu Hasil Studi)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek KHS...");
        await gotoWithRetry('https://siakad.um.ac.id/khs/', 2);
        await assertStillLoggedIn('khs');

        // Ensure KHS is on the active semester (derive from Registrasi page)
        {
            const activePeriod = deriveActivePeriod(allData.registrasi);
            if (activePeriod) {
                const didSwitch = await evalFirstFrameArgs<boolean, [string, string]>((year, term) => {
                    const normalize = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
                    const sel = document.querySelector('select[name="sesi"], select#sesi') as HTMLSelectElement | null;
                    if (!sel) return false;

                    const options = Array.from(sel.options);
                    const wantYear = year.replace(/\s+/g, '');
                    const wantTerm = term.toLowerCase();
                    const opt = options.find((o) => {
                        const text = normalize(o.textContent || '');
                        const compact = text.replace(/\s+/g, '');
                        return compact.includes(wantYear) && text.toLowerCase().includes(wantTerm);
                    });
                    if (!opt) return false;

                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));

                    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]')) as Array<HTMLElement>;
                    const apply = buttons.find((b) => {
                        const t = (b instanceof HTMLInputElement ? b.value : b.textContent) || '';
                        const tt = normalize(t).toLowerCase();
                        return tt.includes('tampil') || tt.includes('ganti') || tt.includes('proses') || tt.includes('lihat');
                    });
                    if (apply) {
                        apply.click();
                        return true;
                    }

                    const form = sel.closest('form') as HTMLFormElement | null;
                    if (form) {
                        form.submit();
                        return true;
                    }

                    return true;
                }, activePeriod.year, activePeriod.term);

                if (didSwitch) {
                    await stepDelay(900);
                }
            }
        }

        await page.waitForFunction(
            () => {
                const body = (document.body as HTMLElement).innerText || document.body.textContent || "";
                // table likely loaded if there are grade letters or SKS numbers
                return /\b[A-E][+-]?\b/.test(body) || body.toLowerCase().includes('khs');
            },
            { timeout: TIMEOUT_EL },
        );
        await stepDelay();
                // Attach active THAKA (from registrasi aktif) to keuangan totals for UI highlight and consistency.
                try {
                    const activePeriod = deriveActivePeriod(allData.registrasi);
                    if (activePeriod) {
                        const yearStart = Number(String(activePeriod.year).slice(0, 4));
                        const term = String(activePeriod.term).toLowerCase().includes('gasal') ? 1 : String(activePeriod.term).toLowerCase().includes('genap') ? 2 : 0;
                        if (yearStart && term) {
                            allData.keuangan.totals.activeThaka = `${yearStart}${term}`;
                        }
                    }
                } catch {
                    // ignore
                }

        await pushDebug('khs');

        const khs = await evalFirstFrame<Khs>(() => {
            const normalize = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
            const items: KhsItem[] = [];

            const sel = document.querySelector('select[name="sesi"], select#sesi') as HTMLSelectElement | null;
            const headingText = Array.from(document.querySelectorAll('h1,h2,h3'))
                .map((h) => normalize(h.textContent || ''))
                .find((t) => /hasil\s+studi/i.test(t) || /periode/i.test(t));

            const headingPeriod = headingText?.match(/\b(Gasal|Genap)\b\s*(20\d{2}\s*\/\s*20\d{2})/i);
            const semFromHeading = headingPeriod ? `${headingPeriod[1]} ${headingPeriod[2].replace(/\s+/g, '')}` : headingText || '';

            const sem =
                normalize(sel?.selectedOptions?.[0]?.textContent || '') ||
                normalize(sel?.options?.[sel?.selectedIndex ?? -1]?.textContent || '') ||
                normalize(semFromHeading) ||
                'Semester Ini';

            // Prefer extracting IPS from the page text if present.
            const body = normalize((document.body as HTMLElement).innerText || document.body.textContent || '');
            const ipsMatch =
                body.match(/\bIPS\b\s*[:=]?\s*(\d[\.,]\d{2})/i) ||
                body.match(/\bIP\b\s*[:=]?\s*(\d[\.,]\d{2})/i) ||
                body.match(/(\d[\.,]\d{2})\s*\bIP\b/i);
            const ipsFromText = ipsMatch?.[1] ? String(ipsMatch[1]).replace(',', '.') : '';

            const tables = Array.from(document.querySelectorAll('table'));
            const pick =
                tables
                    .map((t) => {
                        const head = normalize((t.querySelector('thead')?.textContent || t.querySelector('tr')?.textContent || '')).toLowerCase();
                        const score =
                            (head.includes('mata kuliah') || head.includes('matakuliah') || head.includes('nama mata') ? 2 : 0) +
                            (head.includes('sks') ? 1 : 0) +
                            (head.includes('nilai') || head.includes('huruf') || head.includes('nh') ? 1 : 0);
                        const rows = t.querySelectorAll('tr').length;
                        return { t, score, rows };
                    })
                    .sort((a, b) => (b.score - a.score) || (b.rows - a.rows))[0]?.t ||
                tables[0];
            if (!pick) return { semester: sem, ips: ipsFromText || '0.00', matkul: [] };

            const rows = Array.from(pick.querySelectorAll('tr'));
            const headerCells = Array.from(rows[0]?.querySelectorAll('th,td') || []).map((c) => normalize(c.textContent || '').toLowerCase());
            const idxMatkul = headerCells.findIndex((h) => h.includes('mata kuliah') || h.includes('matakuliah') || h.includes('nama mata') || h.includes('nama mk') || h === 'mk');
            const idxSks = headerCells.findIndex((h) => h.includes('sks'));
            const idxNilai = headerCells.findIndex((h) => {
                const compact = h.replace(/[^a-z0-9]/g, '');
                return h.includes('nilai') || h.includes('huruf') || compact === 'nh' || compact === 'nH'.toLowerCase();
            });

            let totalSks = 0;
            let totalBobot = 0;
            const gradeBobot = (nilai: string) => {
                const n = (nilai || '').trim().toUpperCase();
                if (n.startsWith('A')) return 4;
                if (n.startsWith('B')) return 3;
                if (n.startsWith('C')) return 2;
                if (n.startsWith('D')) return 1;
                return 0;
            };

            for (const row of rows.slice(1)) {
                const cells = Array.from(row.querySelectorAll('td')).map((c) => normalize(c.textContent || ''));
                if (cells.length === 0) continue;

                const matkul = (idxMatkul >= 0 ? cells[idxMatkul] : cells.find((c) => c.length > 5 && !/^\d+$/.test(c) && !/\bIPS\b/i.test(c))) || '';
                const sksRaw = (idxSks >= 0 ? cells[idxSks] : cells.find((c) => /^\d{1,2}$/.test(c))) || '';
                const nilai = (idxNilai >= 0 ? cells[idxNilai] : cells.find((c) => /^[A-E][+-]?$/.test(c))) || '';
                const sks = Number(sksRaw) || 0;

                if (!matkul) continue;
                items.push({ matkul, sks, nilai });

                if (sks > 0 && nilai) {
                    totalSks += sks;
                    totalBobot += sks * gradeBobot(nilai);
                }
            }

            const ipsComputed = totalSks > 0 ? (totalBobot / totalSks).toFixed(2) : '0.00';
            return { semester: sem, ips: ipsFromText || ipsComputed, matkul: items };
        });
        if (khs) allData.khs = khs;
        console.log("✅ KHS IPS:", allData.khs.ips);
    } catch { console.log("❌ Error KHS"); }


    // ---------------------------------------------------------
    // LINK 5: DHS (Transkrip)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek DHS...");
        await gotoWithRetry('https://siakad.um.ac.id/dhs/', 2);
        await assertStillLoggedIn('dhs');
        await page.waitForFunction(
            () => {
                const body = (document.body as HTMLElement).innerText || document.body.textContent || "";
                return /IPK\s*[:=]?\s*\d[\.,]\d{2}/i.test(body) || body.toLowerCase().includes('dhs');
            },
            { timeout: TIMEOUT_EL },
        );
        await stepDelay();

        await pushDebug('dhs');

        const dhs = await evalFirstFrame<Dhs>(() => {
            const body = (document.body as HTMLElement).innerText || document.body.textContent || "";

            const afterIpk = body.match(/IPK\s*[:=]?\s*(\d[\.,]\d{2})/i);
            const beforeIpk = body.match(/(\d[\.,]\d{2})\s*IPK/i);
            const ipkRaw = afterIpk?.[1] || beforeIpk?.[1] || "0.00";

            const afterSks = body.match(/(Total\s*SKS|Jumlah\s*SKS)\s*[:=]?\s*(\d+)/i);
            const beforeSks = body.match(/(\d+)\s*(Total\s*SKS|Jumlah\s*SKS)/i);
            const totalSksRaw = afterSks?.[2] || beforeSks?.[1] || "0";

            return {
                ipk: String(ipkRaw).replace(',', '.'),
                totalSks: String(totalSksRaw),
            };
        });
        if (dhs) allData.dhs = dhs;
        console.log("✅ DHS IPK:", allData.dhs.ipk);
    } catch { console.log("❌ Error DHS"); }


    // ---------------------------------------------------------
    // LINK 6: KRS (Jadwal)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek KRS...");
        await gotoWithRetry('https://siakad.um.ac.id/krs/', 2);
        await assertStillLoggedIn('krs');

        // Ensure KRS is on the active semester (derive from Registrasi page)
        const activePeriod = deriveActivePeriod(allData.registrasi);
        if (activePeriod) {
            const didSwitch = await evalFirstFrameArgs<boolean, [string, string]>((year, term) => {
                const normalize = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
                const yearSelect =
                    (document.querySelector('select[name*="tahun" i], select[name*="th" i]') as HTMLSelectElement | null) ||
                    (document.querySelector('select#tahun, select#thaka') as HTMLSelectElement | null);
                const semSelect =
                    (document.querySelector('select[name*="semester" i]') as HTMLSelectElement | null) ||
                    (document.querySelector('select#semester') as HTMLSelectElement | null);

                const setByText = (sel: HTMLSelectElement | null, want: string) => {
                    if (!sel) return false;
                    const options = Array.from(sel.options);
                    const opt = options.find((o) => normalize(o.textContent || '').replace(/\s+/g, '') === want.replace(/\s+/g, ''));
                    const opt2 = opt || options.find((o) => normalize(o.textContent || '').toLowerCase().includes(want.toLowerCase()));
                    if (!opt2) return false;
                    sel.value = opt2.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                };

                const yOk = setByText(yearSelect, year);
                const sOk = setByText(semSelect, term);

                const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]')) as Array<HTMLElement>;
                const ganti = buttons.find((b) => {
                    const t = (b instanceof HTMLInputElement ? b.value : b.textContent) || '';
                    return normalize(t).toLowerCase().includes('ganti');
                });
                if (ganti) {
                    (ganti as HTMLElement).click();
                    return true;
                }

                const form = (yearSelect?.closest('form') || semSelect?.closest('form')) as HTMLFormElement | null;
                if (form && (yOk || sOk)) {
                    form.submit();
                    return true;
                }
                return false;
            }, activePeriod.year, activePeriod.term);

            if (didSwitch) {
                // Let the page update after switching period
                await stepDelay(900);
            }
        }

        await waitForAnyTableInFrames();
        await stepDelay();

        await pushDebug('krs');

        const jadwal = await evalFirstFrame<JadwalItem[]>(() => {
            const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
            const tables = Array.from(document.querySelectorAll('table'));
            const pick = tables.find((t) => {
                const head = normalize((t.querySelector('thead')?.textContent || t.querySelector('tr')?.textContent || '')).toLowerCase();
                return (
                    head.includes('hari') ||
                    head.includes('jam') ||
                    head.includes('waktu') ||
                    head.includes('mata kuliah') ||
                    head.includes('nama matakuliah') ||
                    head.includes('nama mata kuliah') ||
                    head.includes('matakuliah') ||
                    head.includes('ruang') ||
                    head.includes('dosen')
                );
            }) || tables[0];
            if (!pick) return [];

            const headerRow = pick.querySelector('tr');
            const headerCells = Array.from(headerRow?.querySelectorAll('th,td') || []).map((c) => normalize(c.textContent || '').toLowerCase());
            const indexOf = (pred: (s: string) => boolean) => headerCells.findIndex(pred);
            const idxHari = indexOf((s) => s.includes('hari'));
            const idxJam = indexOf((s) => s.includes('jam') || s.includes('waktu'));
            const idxMatkul = indexOf((s) => s.includes('nama') || s.includes('mata') || s.includes('matkul') || s.includes('mk') || s.includes('kuliah'));
            const idxRuang = indexOf((s) => s.includes('ruang') || s.includes('kelas'));
            const idxDosen = indexOf((s) => s.includes('dosen'));

            const out: JadwalItem[] = [];
            const rows = Array.from(pick.querySelectorAll('tr')).slice(1);
            for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('td')).map((c) => normalize(c.textContent || ''));
                if (cells.length === 0) continue;

                const hari = (idxHari >= 0 ? cells[idxHari] : cells.find((c) => /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)$/i.test(c))) || '';
                const jam = (idxJam >= 0 ? cells[idxJam] : cells.find((c) => /\d{2}:\d{2}/.test(c))) || '';
                const matkul = (idxMatkul >= 0 ? cells[idxMatkul] : cells.find((c) => c.length > 5 && !/\d{2}:\d{2}/.test(c) && !/^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)$/i.test(c))) || '';
                const ruang = (idxRuang >= 0 ? cells[idxRuang] : cells.find((c) => /Gedung/i.test(c) || /[A-Z]\d{1,3}/.test(c))) || '';
                const dosen = (idxDosen >= 0 ? cells[idxDosen] : '') || '';

                // KRS sering tidak memuat hari/jam; minimal ambil daftar matkul.
                if (matkul) out.push({ matkul, hari, jam, ruang, dosen });
            }
            return out;
        });
        const cleaned = (jadwal ?? [])
            .map((j) => ({
                matkul: (j.matkul || '').trim(),
                hari: (j.hari || '').trim(),
                jam: (j.jam || '').trim(),
                ruang: (j.ruang || '').trim(),
                dosen: (j.dosen || '').trim(),
            }))
            .filter((j) => {
                if (!j.matkul) return false;
                const t = j.matkul.toLowerCase();
                if (t.includes('catatan')) return false;
                if (t.includes('pilih tahun')) return false;
                if (t.includes('jumlah sks')) return false;
                if (t === 'total') return false;
                return true;
            });

        // Deduplicate in a way that doesn't inflate counts:
        // - Remove exact duplicates
        // - If the same matkul appears twice and one is "empty" (no hari/jam/ruang), drop the empty one.
        const byMatkul = new Map<string, JadwalItem[]>();
        for (const j of cleaned) {
            const k = (j.matkul || '').toLowerCase();
            const arr = byMatkul.get(k) || [];
            arr.push(j);
            byMatkul.set(k, arr);
        }

        const uniq: JadwalItem[] = [];
        const seen = new Set<string>();
        for (const [, group] of byMatkul) {
            const detailText = (x: JadwalItem) => `${x.hari || ''}${x.jam || ''}${x.ruang || ''}${x.dosen || ''}`.trim();
            const hasDetail = group.some((x) => detailText(x).length > 0);
            const candidates = hasDetail ? group.filter((x) => detailText(x).length > 0) : group;
            for (const j of candidates) {
                const key = [j.matkul, j.hari, j.jam, j.ruang, j.dosen].join('|').toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                uniq.push(j);
            }
        }

        allData.jadwal = uniq;
        console.log("✅ Jadwal:", allData.jadwal.length + " Matkul");
    } catch { console.log("❌ Error KRS"); }


    // ---------------------------------------------------------
    // LINK 7: DHE (Ekstra)
    // ---------------------------------------------------------
    try {
        console.log("📍 Cek DHE...");
        await gotoWithRetry('https://siakad.um.ac.id/dhe/', 2);
        await assertStillLoggedIn('dhe');
        await waitForAnyTableInFrames();
        await stepDelay();

        await pushDebug('dhe');

        const dhe = await evalFirstFrame<DheItem[]>(() => {
            const res: DheItem[] = [];
            document.querySelectorAll('table tr').forEach((row, idx) => {
                if(idx===0) return;
                const cols = row.querySelectorAll('td');
                if(cols.length >= 2) {
                    const kegiatan = ((cols[1]?.textContent || "").trim() || "-");
                    const poin = ((cols[cols.length-1]?.textContent || "").trim() || "-");
                    if(kegiatan !== "-" && kegiatan.length > 3) res.push({ kegiatan, poin });
                }
            });
            return res.slice(0, 3);
        });
        allData.dhe = dhe ?? [];
        console.log("✅ DHE:", allData.dhe.length + " item");
    } catch { console.log("❌ Error DHE"); }


    console.log("🎉 SELESAI!");

    // Persist/update session cookies for next "real live" sync.
    let outSessionToken = sessionToken;
    try {
        const latestCookiesRaw = await page.cookies();
        const latestCookies: SiakadSession['cookies'] = latestCookiesRaw.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: (c.sameSite as SiakadSession['cookies'][number]['sameSite']) ?? undefined,
        }));

        if (useSession && outSessionToken) {
            updateSession(outSessionToken, latestCookies);
        } else {
            const created = createSession(nim, latestCookies);
            outSessionToken = created.token;
        }
    } catch {
        // ignore session persistence failures
    }

    await browser.close();

    const res = NextResponse.json({
        success: true,
        nim: nim,
        ...allData,
        ...(debugEnabled ? { debug } : {}),
    });
    if (outSessionToken) {
        res.cookies.set('siakad_session', outSessionToken, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 12 * 60 * 60,
        });
    }
    return res;

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log("🔥 FATAL ERROR: " + message);
    if (browser) await browser.close();
        // If debug enabled, include debug bundle to help pinpoint blocked pages/frames.
        return NextResponse.json(
            { success: false, message, ...(debugEnabled ? { debug } : {}) },
            { status: 500 },
        );
  }
    }, 12 * 60 * 1000);
}