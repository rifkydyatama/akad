import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; 

export async function POST(request: Request) {
    let nim = ""; let password = ""; let body: any = {};
    try { body = await request.json(); } catch { body = {}; }

    nim = String(body.nim || "").trim();
    password = String(body.password || "");

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('siakad_session')?.value;
    const session = getSession(sessionToken);

    if (!password && !session) return NextResponse.json({ success: false, message: "Sesi habis." }, { status: 401 });
    if (!password && session) nim = session.nim;

    return await dedupeInflight(sessionToken ? `token:${sessionToken}` : `nim:${nim}`, async () => {
        let browser;
        try {
            console.log("🚀 Robot Scraper: Ironclad Mode (Anti-Selector Error)");

            browser = await puppeteerCore.launch({
                args: [...chromium.args, '--no-zygote', '--single-process', '--disable-gpu'],
                defaultViewport: { width: 1366, height: 768 },
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
            });

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);

            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            // 1. PROSES LOGIN (FIXED SELECTOR)
            await page.goto('https://siakad.um.ac.id/', { waitUntil: 'domcontentloaded' });
            
            if (!password && session) {
                await page.setCookie(...session.cookies);
                await page.reload({ waitUntil: 'domcontentloaded' });
            } else {
                // Tunggu form muncul
                const userField = 'input[name="username"], input[name="identity"], #username';
                await page.waitForSelector(userField, { timeout: 20000 });
                
                await page.type(userField, nim);
                await page.type('input[type="password"]', password);

                // FIXED: Cari tombol submit dengan cara lebih luas
                const loginBtn = 'button[type="submit"], input[type="submit"], .btn-primary, button[name="login"]';
                await page.waitForSelector(loginBtn, { timeout: 10000 });
                
                await Promise.all([
                    page.click(loginBtn),
                    page.waitForNavigation({ waitUntil: 'networkidle2' })
                ]);
            }

            const allData: any = {
                profile: { name: "Mahasiswa", prodi: "-", status: "-", jalur: "KIPK" },
                keuangan: { riwayat: [], totals: { ukt: 0 } },
                registrasi: [],
                khs: { ips: "0.00" },
                dhs: { ipk: "0.00", totalSks: "0" },
                jadwal: [],
                dhe: []
            };

            const scrapeFrames = async (url: string, fn: any) => {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded' });
                    const frames = [page.mainFrame(), ...page.frames()];
                    for (const f of frames) {
                        const r = await f.evaluate(fn);
                        if (r && (Array.isArray(r) ? r.length > 0 : true)) return r;
                    }
                } catch { return null; }
            };

            // ITEM 1: DASHBOARD
            allData.profile = await scrapeFrames('https://siakad.um.ac.id/dashboard/', () => {
                const b = document.body.innerText;
                const get = (k: string) => (b.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim().replace(/^[:\-\s]+/, '') || "-";
                return { name: document.querySelector('.user-name span')?.textContent?.trim() || get('Nama'), prodi: get('Program Studi'), status: get('Status'), jalur: get('Jalur Masuk') };
            });

            // ITEM 2: KEUANGAN (FIX 4.5 JT)
            const keu = await scrapeFrames('https://siakad.um.ac.id/riwayat-keuangan/', () => {
                const res: any[] = [];
                document.querySelectorAll('tr').forEach(row => {
                    const c = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                    const thaka = c.find(t => /^\d{5}$/.test(t));
                    if (thaka) {
                        const money = c.find(t => t.includes('.') && t.includes(',') && !t.includes('/')) || "0";
                        const tgl = c.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t));
                        const nominal = parseInt(money.split(',')[0].replace(/\D/g, '')) || 0;
                        res.push({ thaka, nominal: `Rp ${new Intl.NumberFormat('id-ID').format(nominal)}`, spp: nominal, status: nominal === 0 && !!tgl ? "Lunas (KIP-K)" : (tgl ? "Lunas" : "Belum Bayar") });
                    }
                });
                return res;
            });
            if (keu) {
                allData.keuangan.riwayat = keu.reverse();
                allData.keuangan.totals.ukt = keu.reduce((a:any, b:any) => a + b.spp, 0);
            }

            // ITEM 3: JADWAL (MATKUL & DOSEN)
            allData.jadwal = await scrapeFrames('https://siakad.um.ac.id/krs/', () => {
                const out: any[] = [];
                document.querySelectorAll('tr').forEach(r => {
                    const c = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                    const matkul = c.find(t => t.length > 10 && !t.includes(',') && !t.includes('('));
                    const dosen = c.find(t => (t.includes(',') && t.includes('.')) || t.length > 15);
                    if (matkul && !matkul.toLowerCase().includes('total')) out.push({ matkul, dosen: dosen || "-", hari: "-", jam: "-", ruang: "-" });
                });
                return out;
            });

            // ITEM 4 & 7: KHS & DHS (FIX FALLBACK 3.96)
            const ips = await scrapeFrames('https://siakad.um.ac.id/khs/', () => {
                const m = document.body.innerText.match(/\bIPS\b\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                return m ? m[1].replace(',', '.') : "0.00";
            });
            allData.khs.ips = ips || "0.00";

            const dhs = await scrapeFrames('https://siakad.um.ac.id/dhs/', () => {
                const b = document.body.innerText;
                const ipkM = b.match(/IPK\s*[:=]?\s*(\d+[\.,]\d{2})/i);
                const sksM = b.match(/(Total\s*SKS|SKS\s*Lulus)\s*[:=]?\s*(\d+)/i);
                return { ipk: ipkM ? ipkM[1].replace(',', '.') : null, sks: sksM ? sksM[2] : "20" };
            });
            allData.dhs.ipk = (dhs?.ipk && dhs.ipk !== "0.00") ? dhs.ipk : allData.khs.ips;
            allData.dhs.totalSks = dhs?.sks || "20";

            // ITEM 5 & 6: REGISTRASI & DHE
            allData.registrasi = await scrapeFrames('https://siakad.um.ac.id/riwayat-registrasi/', () => {
                return Array.from(document.querySelectorAll('tr')).map(row => {
                    const c = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                    return { semester: c.find(t => /^\d{5}$/.test(t)) || "-", status: c.find(t => /Aktif|Lunas/i.test(t)) || "-" };
                }).filter((x:any) => x.semester !== "-");
            });

            allData.dhe = await scrapeFrames('https://siakad.um.ac.id/dhe/', () => {
                return Array.from(document.querySelectorAll('tr')).slice(1).map(row => {
                    const c = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                    return { kegiatan: c[1] || "-", poin: c[c.length-1] || "0" };
                }).filter((x:any) => x.kegiatan !== "-");
            });

            const s = createSession(nim, (await page.cookies()) as any);
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