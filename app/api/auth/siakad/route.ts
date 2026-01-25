import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Batas maksimal Vercel Hobby

// --- STRUKTUR DATA UNTUK TYPE SAFETY ---
type Profile = { name: string; prodi: string; fakultas: string; dosenPa: string; status: string; jalur: string; foto: string | null; };
type AllData = {
    profile: Profile;
    keuangan: { riwayat: any[]; totals: { ukt: number; count: number } };
    registrasi: any[];
    khs: { ips: string; semester: string };
    dhs: { ipk: string; totalSks: string };
    jadwal: any[];
    dhe: any[];
};

export async function POST(request: Request) {
    let nim = ""; let password = ""; let body: any = {};
    try { body = await request.json(); } catch { body = {}; }

    nim = String(body.nim || "").trim();
    password = String(body.password || "");

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('siakad_session')?.value;
    const session = getSession(sessionToken);

    // Proteksi: Jangan jalankan robot kalau tidak ada bahan (NIM/Session)
    if (!password && !session) {
        return NextResponse.json({ success: false, message: "Sesi habis, silakan login ulang." }, { status: 401 });
    }
    if (!password && session) nim = session.nim;

    return await dedupeInflight(sessionToken ? `token:${sessionToken}` : `nim:${nim}`, async () => {
        let browser;
        try {
            console.log("🚀 Memulai Robot Scraper: Versi Benteng (God Mode)");

            // 1. SETUP BROWSER (Optimasi RAM Vercel)
            browser = await puppeteerCore.launch({
                args: [...chromium.args, '--no-zygote', '--single-process', '--disable-gpu'],
                defaultViewport: { width: 1366, height: 768 },
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
            });

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);

            // Bloking request berat biar hemat memori & cepat
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            // 2. PROSES LOGIN / RESTORE SESSION
            await page.goto('https://siakad.um.ac.id/', { waitUntil: 'domcontentloaded' });
            if (!password && session) {
                await page.setCookie(...session.cookies);
                await page.reload({ waitUntil: 'domcontentloaded' });
            } else {
                await page.type('input[name="username"], #username', nim);
                await page.type('input[type="password"]', password);
                await Promise.all([
                    page.click('button[type="submit"]'),
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' })
                ]);
            }

            // 3. CONTAINER DATA (Default Values)
            const allData: AllData = {
                profile: { name: "Mahasiswa", prodi: "-", fakultas: "-", dosenPa: "-", status: "Aktif", jalur: "KIPK", foto: null },
                keuangan: { riwayat: [], totals: { ukt: 0, count: 0 } },
                registrasi: [],
                khs: { ips: "0.00", semester: "Semester Ini" },
                dhs: { ipk: "0.00", totalSks: "0" },
                jadwal: [],
                dhe: []
            };

            // HELPER: Scrape Frame-Aware (Anti SIAKAD Iframe)
            const scrapeFast = async (url: string, fn: any) => {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    const frames = [page.mainFrame(), ...page.frames()];
                    for (const f of frames) {
                        const r = await f.evaluate(fn);
                        if (r && (Array.isArray(r) ? r.length > 0 : true)) return r;
                    }
                } catch (e) { console.error(`Gagal Scrape ${url}:`, e); }
                return null;
            };

            // --- EKSEKUSI 7 ITEM ---

            // ITEM 1: DASHBOARD (PROFIL)
            allData.profile = await scrapeFast('https://siakad.um.ac.id/dashboard/', () => {
                const b = document.body.innerText;
                const get = (k: string) => (b.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim().replace(/^[:\-\s]+/, '') || "-";
                return {
                    name: document.querySelector('.user-name span')?.textContent?.trim() || get('Nama'),
                    prodi: get('Program Studi'), fakultas: get('Fakultas'),
                    dosenPa: get('Dosen PA'), status: get('Status'), jalur: get('Jalur Masuk'), foto: null
                };
            }) || allData.profile;

            // ITEM 2: KEUANGAN (FIX 450 JT & LOGIC KIPK)
            const keuRes = await scrapeFast('https://siakad.um.ac.id/riwayat-keuangan/', () => {
                const out: any[] = [];
                document.querySelectorAll('tr').forEach(row => {
                    const c = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                    const thaka = c.find(t => /^\d{5}$/.test(t));
                    if (thaka) {
                        const moneyCell = c.find(t => t.includes('.') && t.includes(',') && !t.includes('/')) || "0";
                        const tglCell = c.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t));
                        // FIX: Ambil sebelum koma agar 4.500.000,00 tidak jadi 450 Juta
                        const nominal = parseInt(moneyCell.split(',')[0].replace(/\D/g, '')) || 0;
                        out.push({
                            thaka, semester: thaka,
                            nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominal)}`,
                            spp: nominal,
                            status: (nominal === 0 && !!tglCell) ? "Lunas (KIP-K)" : (tglCell ? "Lunas" : "Belum Bayar")
                        });
                    }
                });
                return out;
            });
            if (keuRes) {
                allData.keuangan.riwayat = keuRes.reverse();
                allData.keuangan.totals.ukt = keuRes.reduce((a: any, b: any) => a + b.spp, 0);
            }

            // ITEM 3: KRS/JADWAL (MATKUL & DOSEN ONLY)
            allData.jadwal = await scrapeFast('https://siakad.um.ac.id/krs/', () => {
                const res: any[] = [];
                document.querySelectorAll('tr').forEach(row => {
                    const c = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                    const matkul = c.find(t => t.length > 10 && !t.includes(',') && !/^\d+$/.test(t));
                    const dosen = c.find(t => t.includes(',') && (t.includes('.') || t.length > 15));
                    if (matkul && !matkul.toLowerCase().includes('total')) {
                        res.push({ matkul, dosen: dosen || "-", hari: "-", jam: "-", ruang: "-" });
                    }
                });
                return res;
            }) || [];

            // ITEM 4: KHS (IPS)
            const ipsValue = await scrapeFast('https://siakad.um.ac.id/khs/', () => {
                const m = document.body.innerText.match(/\bIPS\b\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                return m ? m[1].replace(',', '.') : "0.00";
            });
            allData.khs.ips = ipsValue || "0.00";

            // ITEM 5: REGISTRASI
            allData.registrasi = await scrapeFast('https://siakad.um.ac.id/riwayat-registrasi/', () => {
                return Array.from(document.querySelectorAll('tr')).map(r => {
                    const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                    return { semester: c.find(t => /^\d{5}$/.test(t)) || "-", status: c.find(t => /Aktif|Lunas|Lulus/i.test(t)) || "-" };
                }).filter((x: any) => x.semester !== "-");
            }) || [];

            // ITEM 6: DHE (POIN)
            allData.dhe = await scrapeFast('https://siakad.um.ac.id/dhe/', () => {
                return Array.from(document.querySelectorAll('tr')).slice(1).map(r => {
                    const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                    return { kegiatan: c[1] || "-", poin: c[c.length - 1] || "0" };
                }).filter((x: any) => x.kegiatan !== "-");
            }) || [];

            // ITEM 7: DHS (IPK - FALLBACK TO KHS)
            const dhsVal = await scrapeFast('https://siakad.um.ac.id/dhs/', () => {
                const b = document.body.innerText;
                const ipkM = b.match(/IPK\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                const sksM = b.match(/(Total\s*SKS|SKS\s*Lulus)\s*[:=]?\s*(\d+)/i);
                return { ipk: ipkM ? ipkM[1].replace(',', '.') : null, sks: sksM ? sksM[2] : "0" };
            });
            allData.dhs.ipk = (dhsVal?.ipk && dhsVal.ipk !== "0.00") ? dhsVal.ipk : allData.khs.ips;
            allData.dhs.totalSks = dhsVal?.sks || "20";

            // --- FINALISASI ---
            const cookiesLatest = await page.cookies();
            const s = createSession(nim, cookiesLatest as any);
            await browser.close();

            const response = NextResponse.json({ success: true, nim, ...allData });
            response.cookies.set('siakad_session', s.token, { httpOnly: true, secure: true, path: '/', maxAge: 43200 });
            return response;

        } catch (error: any) {
            if (browser) await browser.close();
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}