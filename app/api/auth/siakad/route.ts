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
    name: string; prodi: string; fakultas: string; dosenPa: string; status: string; jalur: string; foto: string | null;
};
type AllData = {
    profile: Profile;
    keuangan: { master: any; riwayat: any[]; totals: any };
    registrasi: any[]; khs: any; dhs: any; jadwal: any[]; dhe: any[];
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
            console.log("🚀 Robot Scraper: ALL-IN-ONE SYNC (7 ITEM)");

            // Setup Browser
            if (process.env.NODE_ENV === 'production') {
                browser = await puppeteerCore.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            } else {
                const { default: puppeteer } = await import('puppeteer-extra');
                const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
                puppeteer.use(StealthPlugin());
                browser = await puppeteer.launch({
                    headless: true, // Ubah false kalau mau lihat browser
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
                });
            }

            const page = await browser.newPage();
            // Timeout agak panjang tapi kita main cepat di navigasi
            page.setDefaultNavigationTimeout(45000); 
            page.setDefaultTimeout(30000);
            await page.setViewport({ width: 1366, height: 768 });

            // Helper: Navigasi Aman & Cepat
            const gotoSafe = async (url: string) => {
                try {
                    // Cukup tunggu domcontentloaded biar ngebut di Vercel
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (e) {
                    console.log(`Retry ${url}...`);
                }
            };

            // Helper: Scrape di dalam Frame (Wajib buat SIAKAD)
            const scrapeInFrames = async <T>(fn: () => T | null): Promise<T | null> => {
                const frames = [page.mainFrame(), ...page.frames()];
                for (const frame of frames) {
                    try {
                        const res = await frame.evaluate(fn);
                        if (res) return res; 
                    } catch {}
                }
                return null;
            };

            // --- 1. LOGIN ---
            if (useSession) {
                await gotoSafe('https://siakad.um.ac.id/');
                await page.setCookie(...session!.cookies);
            } else {
                await gotoSafe('https://siakad.um.ac.id/');
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
            if (!isLogin) throw new Error("Gagal Login (Password Salah/Captcha)");

            const allData: AllData = {
                profile: { name: "", prodi: "-", fakultas: "-", dosenPa: "-", status: "Aktif", jalur: "-", foto: null },
                keuangan: { master: {}, riwayat: [], totals: { ukt: 0, totalPaid: 0, paidCount: 0, unpaidCount: 0 } },
                registrasi: [],
                khs: { semester: "-", ips: "0.00", matkul: [] },
                dhs: { ipk: "0.00", totalSks: "0" },
                jadwal: [],
                dhe: []
            };

            // --- ITEM 1: DASHBOARD (PROFIL) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/dashboard/');
                const profData = await scrapeInFrames(() => {
                    const body = document.body.innerText;
                    const get = (k: string) => (body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim().replace(/^[:\-\s]+/, '') || "-";
                    return {
                        name: document.querySelector('.user-name span')?.textContent?.trim() || "Mahasiswa",
                        prodi: get('Program Studi'), fakultas: get('Fakultas'),
                        dosenPa: get('Dosen PA'), status: get('Status'), jalur: get('Jalur Masuk')
                    };
                });
                if(profData) allData.profile = { ...allData.profile, ...profData };
                
                // Ambil Foto
                const imgUrl = await scrapeInFrames(() => (document.querySelector('img[src*="foto"], img[src*="GetFoto"]') as HTMLImageElement)?.src);
                if (imgUrl) {
                    const viewSource = await page.goto(imgUrl);
                    const buffer = await viewSource?.buffer();
                    if(buffer) allData.profile.foto = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                    await page.goBack();
                }
            } catch {}

            // --- ITEM 2: KEUANGAN (FIX 450 JUTA) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/riwayat-keuangan/');
                // Tunggu tabel sebentar
                await new Promise(r => setTimeout(r, 1000));
                
                const keuData = await scrapeInFrames(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const targetTable = tables.find(t => t.innerText.includes('THAKA') || t.innerText.includes('Semester'));
                    
                    if (targetTable) {
                        Array.from(targetTable.querySelectorAll('tr')).forEach((row, idx) => {
                            if (idx === 0) return;
                            const t = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                            
                            const thakaRaw = t.find(txt => /^\d{5}$/.test(txt));
                            const tglRaw = t.find(txt => /\d{2}\/\d{2}\/\d{4}/.test(txt));
                            // Cari nominal yang BUKAN thaka
                            const nominalRaw = t.find(txt => txt !== thakaRaw && (txt.includes('Rp') || (txt.match(/\d/g)||[]).length > 4)) || "0";

                            if(thakaRaw) {
                                const th = thakaRaw.slice(0,4), kd=thakaRaw.slice(4);
                                const lb = kd==='1'?'Ganjil':kd==='2'?'Genap':'Antara';
                                
                                // === FIX LOGIC UANG ===
                                // 1. Split koma (buang desimal ,00)
                                const mainPart = nominalRaw.split(',')[0];
                                // 2. Hapus titik dan karakter non-digit
                                const cleanNominal = parseInt(mainPart.replace(/\./g, '').replace(/\D/g, '')) || 0;
                                // ======================

                                const isLunas = !!(tglRaw && tglRaw.length > 6);
                                res.push({
                                    thaka: thakaRaw, 
                                    semester: `Semester ${lb} ${th}/${parseInt(th)+1}`,
                                    nominal: `Rp ${new Intl.NumberFormat('id-ID').format(cleanNominal)}`,
                                    spp: cleanNominal, 
                                    total: cleanNominal, 
                                    status: isLunas ? "Lunas" : "Belum Bayar", 
                                    ukt: cleanNominal,
                                    tglBayar: tglRaw || "-"
                                });
                            }
                        });
                    }
                    if(res.length===0) return null;
                    const r = res.reverse();
                    const uktTotal = r.reduce((a:any,b:any)=>a+(b.spp||0),0);
                    return { riwayat: r, totals: { ukt: uktTotal, totalPaid:0, paidCount:0, unpaidCount:0 } };
                });
                if(keuData) allData.keuangan = { ...allData.keuangan, ...keuData };
            } catch {}

            // --- ITEM 3: JADWAL / KRS (ANTI KOSONG) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/krs/');
                await new Promise(r => setTimeout(r, 1000));
                
                const jadwalData = await scrapeInFrames(() => {
                    const out: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('mata kuliah') || t.innerText.toLowerCase().includes('hari')) || tables[0];
                    if(pick) {
                        Array.from(pick.querySelectorAll('tr')).forEach(r => {
                            const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                            const h = c.find(t => /^(Senin|Selasa|Rabu|Kamis|Jumat)$/i.test(t));
                            const j = c.find(t => /\d{2}:\d{2}/.test(t));
                            const rg = c.find(t => /Gedung/i.test(t) || /[A-Z]\d{2,3}/.test(t));
                            const mk = c.find(t => t.length>5 && !/\d{2}:\d{2}/.test(t) && !/^(Senin|Selasa|Rabu|Kamis|Jumat)$/i.test(t) && !t.includes('Gedung'));
                            
                            if(mk && !mk.toLowerCase().includes('total')) {
                                out.push({ matkul: mk, hari: h||"-", jam: j||"-", ruang: rg||"-", dosen: "" });
                            }
                        });
                    }
                    return out;
                });
                if(jadwalData) allData.jadwal = jadwalData;
            } catch {}

            // --- ITEM 4: KHS (IPS/SKS) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/khs/');
                await new Promise(r => setTimeout(r, 500));

                const khsData = await scrapeInFrames(() => {
                    const body = document.body.innerText;
                    const ipsMatch = body.match(/\bIPS\b\s*[:=]?\s*(\d+[\.,]\d{2})/i) || body.match(/(\d+[\.,]\d{2})\s*\bIP\b/i);
                    const sksMatch = body.match(/(SKS\s*Semester|SKS\s*Total)\s*[:=]?\s*(\d+)/i);
                    
                    return { 
                        semester: "Semester Ini", 
                        ips: ipsMatch ? ipsMatch[1].replace(',', '.') : "0.00", 
                        sks_sem: sksMatch ? sksMatch[2] : "0",
                        matkul: [] 
                    };
                });
                if(khsData) allData.khs = khsData;
            } catch {}

            // --- ITEM 5: REGISTRASI (AUTO STATUS) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/riwayat-registrasi/');
                const regData = await scrapeInFrames(() => {
                    const out: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const pick = tables.find(t => t.innerText.toLowerCase().includes('status')) || tables[0];
                    if(pick) {
                        Array.from(pick.querySelectorAll('tr')).forEach(r => {
                            const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                            const sem = c.find(t => /^\d{5}$/.test(t));
                            const stat = c.find(t => /^(aktif|cuti|non-aktif|lulus)$/i.test(t)) || c[c.length-1];
                            if(sem && stat && stat!=='-') {
                                const th=sem.slice(0,4), kd=sem.slice(4);
                                const lb=kd==='1'?'Ganjil':kd==='2'?'Genap':'Antara';
                                out.push({ semester: `Semester ${lb} ${th}/${parseInt(th)+1}`, status: stat });
                            }
                        });
                    }
                    return out.length ? out : null;
                });
                if(regData) allData.registrasi = regData;
            } catch {}

            // --- ITEM 6: DHE (DATA HASIL EVALUASI) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/dhe/');
                const dheData = await scrapeInFrames(() => {
                    const res: any[] = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    const target = tables.find(t => t.innerText.includes('Kegiatan') || t.innerText.includes('Poin'));
                    if(target) {
                        Array.from(target.querySelectorAll('tr')).forEach((row, idx) => {
                            if(idx===0) return;
                            const c = Array.from(row.querySelectorAll('td')).map(x => x.innerText.trim());
                            if(c.length > 1) {
                                const poin = c.find(x => /^\d+$/.test(x)) || "0";
                                const kegiatan = c.find(x => x.length > 5 && x !== poin) || "-";
                                if(kegiatan !== "-") res.push({ kegiatan, poin });
                            }
                        });
                    }
                    return res.length ? res : null;
                });
                if(dheData) allData.dhe = dheData;
            } catch {}

            // --- ITEM 7: DHS (IPK TOTAL) ---
            try {
                await gotoSafe('https://siakad.um.ac.id/dhs/');
                const dhsData = await scrapeInFrames(() => {
                    const body = document.body.innerText;
                    const ipkMatch = body.match(/IPK\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                    const sksMatch = body.match(/(Total\s*SKS|Jumlah\s*SKS)\s*[:=]?\s*(\d+)/i);
                    return {
                        ipk: ipkMatch ? ipkMatch[1].replace(',', '.') : "0.00",
                        totalSks: sksMatch ? sksMatch[2] : "0"
                    };
                });
                if (dhsData) {
                    allData.dhs = dhsData;
                    if (allData.khs.ips === "0.00") allData.khs.ips = dhsData.ipk; 
                }
            } catch {}

            // Save Session
            try {
                const cookies = await page.cookies();
                if(useSession && sessionToken) updateSession(sessionToken, cookies as any);
                else { const s = createSession(nim, cookies as any); if(s) sessionToken = s.token; }
            } catch {}

            await browser.close();
            const res = NextResponse.json({ success: true, nim, ...allData });
            if (sessionToken) res.cookies.set('siakad_session', sessionToken, { httpOnly: true, secure: true, path: '/' });
            return res;

        } catch (error: any) {
            if (browser) await browser.close();
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}