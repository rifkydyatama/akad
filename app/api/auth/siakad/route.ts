import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
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
    keuangan: { riwayat: any[]; totals: { ukt: number; totalPaid?: number; paidCount?: number; unpaidCount?: number; activeThaka?: string }; master?: Record<string, any> };
    dashboard?: { term?: string; paymentStatus?: string; sks?: number; ip?: string };
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
                    args: [...((chromium as any).args || []), '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
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
                        const res = await (f as any).evaluate(fn);
                        if (res) return res;
                    } catch {}
                }
                return null;
            };

            // --- 2. LOGIN (PERBAIKAN UTAMA) ---
            await gotoPage('https://siakad.um.ac.id/');
            
            const isLoginPage = await (page as any).evaluate(() => !!document.querySelector('input[type="password"]'));
            
            if (isLoginPage) {
                if (password) {
                    await page.type('input[name="username"], #username', nim);
                    await page.type('input[type="password"]', password);
                    
                    // FIX: Coba klik tombol login dengan berbagai cara
                    const clicked = await (page as any).evaluate(() => {
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
            const stillLogin = await (page as any).evaluate(() => !!document.querySelector('input[type="password"]'));
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
                const text = document.body.innerText;
                const find = (k: string) => (text.match(new RegExp(`${k}\s*[:]?\s*([^\n]+)`, 'i')) || [])[1]?.trim() || "-";

                const elNama = document.querySelector('a.aku');
                const imgEl = document.querySelector('img[src*="foto"], img[src*="GetFoto"]') as HTMLImageElement | null;

                // Try to extract NIM (e.g. "NIM. 250121621745") and Angkatan
                const nimMatch = text.match(/NIM\.?\s*[:]?\s*(\d{6,})/i);
                const nim = nimMatch ? nimMatch[1].trim() : null;
                let angkatan: string | null = null;
                const ang = (text.match(/Angkatan\s*[:\-\s]*([^\n\r]+)/i) || [])[1];
                if (ang) angkatan = String(ang).trim().split(/\s+/)[0];

                const fotoApi = (nim && angkatan) ? `https://api.um.ac.id/akademik/operasional/GetFoto.ptikUM?nim=${nim}&angkatan=${angkatan}` : null;

                return {
                    name: elNama ? elNama.textContent?.trim() || "Mahasiswa" : find('Nama'),
                    prodi: find('Program Studi') !== '-' ? find('Program Studi') : find('Prodi'),
                    fakultas: find('Fakultas'),
                    dosenPa: find('Dosen PA'),
                    status: find('Status'),
                    jalur: find('Jalur Masuk'),
                    nim,
                    angkatan,
                    fotoUrl: imgEl ? imgEl.src : null,
                    fotoApi
                };
            });
            if (profData) {
                allData.profile = { ...allData.profile, ...profData, foto: null };
                // Prefer UM API photo if available, else fallback to image src
                if (profData.fotoApi) {
                    allData.profile.foto = profData.fotoApi;
                } else if (profData.fotoUrl) {
                    allData.profile.foto = profData.fotoUrl;
                }
            }

            // B. KEUANGAN (Master Pembayaran + Riwayat)
            console.log("📍 Scraping Keuangan...");
            await gotoPage('https://siakad.um.ac.id/riwayat-keuangan/');
            const keuPage = await scrape(() => {
                const parseMoney = (s: string | undefined | null) => {
                    if (!s) return { value: 0, raw: '0' };
                    const txt = String(s).trim();
                    const main = txt.split(',')[0];
                    const digits = main.replace(/\D/g, '') || '0';
                    return { value: parseInt(digits, 10) || 0, raw: txt };
                };

                const result: any = { master: {}, riwayat: [] };

                // Master Pembayaran: look for a table with headers including SPP and HOTMA
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                    try {
                        const headers = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                        if (headers.some(h => h.includes('spp')) && headers.some(h => h.includes('hotma'))) {
                            const row = t.querySelector('tbody tr') || t.querySelector('tr');
                            if (row) {
                                const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                                const map: Record<string, any> = {};
                                // Map by header position
                                headers.forEach((h, i) => {
                                    const key = h.includes('spp') ? 'spp' : h.includes('hotma') ? 'hotma' : h.includes('spsa') ? 'spsa' : h.includes('kpmb') ? 'kpmb' : h.includes('bpp') ? 'bpp' : h.includes('lain') ? 'lain' : `col${i}`;
                                    map[key] = parseMoney(cols[i]);
                                });
                                result.master = {
                                    spp: map.spp?.value || 0,
                                    hotma: map.hotma?.value || 0,
                                    spsa: map.spsa?.value || 0,
                                    kpmb: map.kpmb?.value || 0,
                                    bpp: map.bpp?.value || 0,
                                    lain: map.lain?.value || 0,
                                    total: (map.spp?.value || 0) + (map.hotma?.value || 0) + (map.spsa?.value || 0) + (map.kpmb?.value || 0) + (map.bpp?.value || 0) + (map.lain?.value || 0),
                                    raw: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, (v && (v.raw || '0')) || '0']))
                                };
                                break;
                            }
                        }
                    } catch {}
                }

                // Riwayat Keuangan: find table with THAKA header
                for (const t of tables) {
                    try {
                        const headers = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                        if (headers.some(h => h.includes('thaka'))) {
                            const rows = Array.from(t.querySelectorAll('tbody tr'));
                            const out: any[] = [];
                            for (const r of rows) {
                                const cols = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                                if (cols.length === 0) continue;
                                // detect total row (colspan)
                                if (r.querySelector('th') && /total/i.test(r.querySelector('th')!.textContent || '')) continue;

                                // Build a header->cell map that accounts for a leading <th> in rows (row number)
                                const headerToValue: Record<string, string> = {};
                                let cellIdx = 0;
                                const hasLeadingTh = !!r.querySelector('th');
                                if (hasLeadingTh) {
                                    // headers[0] is the row-number column ('#'), so align headers[1..] with cols[0..]
                                    for (let hi = 1; hi < headers.length; hi++) {
                                        headerToValue[headers[hi]] = cols[cellIdx++] || '';
                                    }
                                } else {
                                    for (let hi = 0; hi < headers.length; hi++) {
                                        headerToValue[headers[hi]] = cols[cellIdx++] || '';
                                    }
                                }

                                const findHeaderValue = (names: string[]) => {
                                    for (const n of names) {
                                        const key = Object.keys(headerToValue).find(h => h.includes(n));
                                        if (key) return headerToValue[key];
                                    }
                                    return undefined;
                                };

                                const thaka = findHeaderValue(['thaka']) || cols[0] || '';
                                const sppRaw = findHeaderValue(['spp']) || cols[1] || '0';
                                const hotmaRaw = findHeaderValue(['hotma']) || cols[2] || '0';
                                const spsaRaw = findHeaderValue(['spsa']) || cols[3] || '0';
                                const kpmbRaw = findHeaderValue(['kpmb']) || cols[4] || '0';
                                const bppRaw = findHeaderValue(['bpp']) || cols[5] || '0';
                                const kknRaw = findHeaderValue(['kkn']) || cols[6] || '0';
                                const pplRaw = findHeaderValue(['ppl']) || cols[7] || '0';
                                const lainRaw = findHeaderValue(['lain']) || cols[8] || '0';
                                const tgl = findHeaderValue(['tgl bayar','tgl']) || cols[9] || '';
                                const bank = findHeaderValue(['bank']) || cols[10] || '';

                                const spp = parseMoney(sppRaw);
                                const hotma = parseMoney(hotmaRaw);
                                const spsa = parseMoney(spsaRaw);
                                const kpmb = parseMoney(kpmbRaw);
                                const bpp = parseMoney(bppRaw);
                                const kkn = parseMoney(kknRaw);
                                const ppl = parseMoney(pplRaw);
                                const lain = parseMoney(lainRaw);

                                out.push({
                                    thaka: String(thaka).trim(),
                                    spp: spp.value,
                                    hotma: hotma.value,
                                    spsa: spsa.value,
                                    kpmb: kpmb.value,
                                    bpp: bpp.value,
                                    kkn: kkn.value,
                                    ppl: ppl.value,
                                    lain: lain.value,
                                    total: spp.value + hotma.value + spsa.value + kpmb.value + bpp.value + kkn.value + ppl.value + lain.value,
                                    tglBayar: String(tgl).trim() || '-',
                                    bank: String(bank).trim() || '-',
                                    // status: 'Lunas' if there's a payment date, otherwise 'Belum Bayar'
                                    status: (String(tgl).trim() && String(tgl).trim() !== '-') ? 'Lunas' : 'Belum Bayar',
                                    // ukt is alias for SPP/UKT column used in UI
                                    ukt: spp.value,
                                    raw: { spp: spp.raw, hotma: hotma.raw, spsa: spsa.raw, kpmb: kpmb.raw, bpp: bpp.raw, kkn: kkn.raw, ppl: ppl.raw, lain: lain.raw }
                                });
                            }
                            result.riwayat = out.reverse();
                            break;
                        }
                    } catch {}
                }

                return result;
            });

            if (keuPage) {
                allData.keuangan.master = keuPage.master || { spp: 0, hotma: 0, spsa: 0, kpmb: 0, bpp: 0, lain: 0, total: 0 };
                allData.keuangan.riwayat = keuPage.riwayat || [];
                const uktTotal = (allData.keuangan.riwayat || []).reduce((a:any,b:any)=>a + (Number(b.spp)||0), 0) || (allData.keuangan.master?.spp ?? 0);
                const paidCount = (allData.keuangan.riwayat || []).filter((r:any)=> r.tglBayar && r.tglBayar !== '-').length;
                const totalPaid = (allData.keuangan.riwayat || []).filter((r:any)=> r.tglBayar && r.tglBayar !== '-').reduce((a:any,b:any)=>a + (Number(b.spp)||0),0);
                const unpaidCount = Math.max((allData.keuangan.riwayat || []).length - paidCount, 0);
                const activeThaka = allData.keuangan.riwayat[0]?.thaka || null;
                allData.keuangan.totals = { ukt: uktTotal, totalPaid, paidCount, unpaidCount, activeThaka };
            }

            // C. JADWAL (detect columns + fallback heuristics)
            console.log("📍 Scraping Jadwal...");
            await gotoPage('https://siakad.um.ac.id/krs/');
            const jadwalData = await scrape(() => {
                // Try to find a headered table first
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                    try {
                        const ths = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                        const rows = Array.from(t.querySelectorAll('tbody tr'));
                        if (!ths.length && rows.length === 0) continue;

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

                // fallback: heuristics across all trs
                const rows = Array.from(document.querySelectorAll('tr'));
                const out: any[] = [];
                rows.forEach(row => {
                    const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim()).filter(Boolean);
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

            // D. KHS (Hasil Studi per semester)
            console.log("📍 Scraping KHS...");
            await gotoPage('https://siakad.um.ac.id/khs/');
            const khsPage = await scrape(() => {
                const text = document.body.innerText || '';

                // Semester: often in H3 like "Hasil Studi Periode Gasal 2025/2026"
                let semester: string | null = null;
                const h3 = document.querySelector('h3')?.textContent || '';
                const m = h3.match(/(Gasal|Genap|Antara)\s*\d{4}\/\d{4}/i);
                if (m) semester = m[0].trim();
                if (!semester) {
                    const m2 = text.match(/(Gasal|Genap|Antara)\s*\d{4}\/\d{4}/i);
                    if (m2) semester = m2[0].trim();
                }

                // Small stat cards: look for strong elements containing SKS and IP
                const strongs = Array.from(document.querySelectorAll('strong')).map(s => (s.textContent || '').trim());
                let totalSks: number | null = null;
                let ips: string | null = null;
                for (const s of strongs) {
                    if (/^\d+$/.test(s) && !totalSks) totalSks = Number(s);
                    if (/^\d+[\.,]\d+$/.test(s) && !ips) ips = s.replace(',', '.');
                }

                // Table with mata kuliah: map headers to indices and skip spacer rows
                const tables = Array.from(document.querySelectorAll('table'));
                let matkul: any[] = [];
                for (const t of tables) {
                    try {
                        const ths = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                        if (!ths.length) continue;
                        const rows = Array.from(t.querySelectorAll('tbody tr'));
                        if (!rows.length) continue;

                        const idx = (names: string[]) => {
                            for (const n of names) {
                                const i = ths.findIndex(h => h.includes(n));
                                if (i >= 0) return i;
                            }
                            return -1;
                        };

                        const iKode = idx(['kode']);
                        const iNama = idx(['nama mata', 'nama', 'mata', 'matakuliah']);
                        const iSks = idx(['sks']);
                        const iKelas = idx(['kelas', 'kelas-offr']);
                        const iDosen = idx(['dosen']);
                        const iNilai = idx(['n.h', 'nilai', 'n.h.']);

                        const entries: any[] = [];
                        for (const r of rows) {
                            const tds = Array.from(r.querySelectorAll('td'));
                            const cols = tds.map(td => (td.textContent || '').replace(/\u00A0/g, ' ').trim());
                            // skip spacer/empty rows
                            if (!cols.length) continue;
                            if (cols.every(c => c === '' || c === '&nbsp;' || c === '\u00A0')) continue;
                            if (cols.filter(Boolean).length < 2) continue;

                            const code = (iKode >= 0 ? (cols[iKode] || '') : (cols.length > 1 ? cols[1] : cols[0])) || '';
                            const name = (iNama >= 0 ? (cols[iNama] || '') : (cols.length > 2 ? cols[2] : cols[1] || cols[0])) || '';
                            const sks = iSks >= 0 ? Number((cols[iSks] || '0').replace(/\D/g, '')) || 0 : Number((cols[3] || cols[2] || '0').replace(/\D/g, '')) || 0;
                            const kelas = iKelas >= 0 ? (cols[iKelas] || '-') : (cols[4] || '-');
                            let dosen: string | undefined = undefined;
                            if (iDosen >= 0) dosen = cols[iDosen] || '-';
                            else if (iNilai >= 0) dosen = cols[iNilai - 1] || '-';
                            else dosen = cols[cols.length - 2] || '-';
                            const nilai = iNilai >= 0 ? (cols[iNilai] || '-') : (cols[cols.length - 1] || '-');

                            const clean = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();
                            const cleanName = clean(name);
                            const cleanDosen = clean(dosen);

                            if (!cleanName || cleanName === '-' || cleanName.toLowerCase().includes('colspan')) continue;

                            entries.push({ code: clean(code), matkul: cleanName, sks, kelas: clean(kelas), dosen: cleanDosen, nilai: clean(nilai) });
                        }

                        if (entries.length) {
                            matkul = entries;
                            break;
                        }
                    } catch {}
                }

                return { semester, ips, totalSks, matkul };
            });

            allData.khs.ips = khsPage?.ips || allData.khs.ips || "0.00";
            allData.khs.semester = khsPage?.semester || allData.khs.semester || "-";
            allData.khs.matkul = Array.isArray(khsPage?.matkul) ? khsPage!.matkul.map((m:any)=>({ matkul: m.matkul, sks: m.sks, nilai: m.nilai, code: m.code, dosen: m.dosen })) : [];

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
                const out: any[] = [];
                const rows = Array.from(document.querySelectorAll('table tbody tr'));
                if (rows.length === 0) {
                    // fallback to any trs
                    rows.push(...Array.from(document.querySelectorAll('tr')));
                }
                for (const r of rows) {
                    try {
                        const cols = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim()).filter(Boolean);
                        if (!cols || cols.length === 0) continue;

                        // semester cell can be human readable like "Gasal 2025/2026" or numeric code like 20251
                        const semHuman = cols.find(c => /(Gasal|Genap|Antara)\s*\d{4}\/\d{4}/i.test(c));
                        const semCode = cols.find(c => /^\d{5}$/.test(c));
                        let semester = '-';
                        if (semHuman) semester = semHuman;
                        else if (semCode) {
                            const th = semCode.slice(0,4), kd = semCode.slice(4);
                            const sm = kd==='1'?'Gasal':kd==='2'?'Genap':'Antara';
                            semester = `${sm} ${th}/${parseInt(th)+1}`;
                        } else {
                            semester = cols[0] || '-';
                        }

                        const status = cols.find(c => /Aktif|Cuti|Lulus|Nonaktif|Tidak Aktif/i.test(c)) || (r.querySelector('label')?.textContent?.trim()) || '-';
                        const tgl = cols.find(c => /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(c)) || '-';
                        const keterangan = cols.find(c => c !== semester && c !== status && c !== tgl) || '-';

                        out.push({ semester: semester.trim(), status: status.trim(), tglRegistrasi: String(tgl).trim() || '-', keterangan: String(keterangan).trim() || '-', active: /Aktif/i.test(String(status)) });
                    } catch {}
                }
                return out;
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
            // Merge jadwal with existing session (preserve manual edits)
            const normalizeKey = (v: string | undefined | null) => String(v || '').toLowerCase().replace(/[\s\-_.()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

            const semesterActive = (allData.registrasi && (allData.registrasi as any[]).find(r => (r as any).active)) ? ((allData.registrasi as any[]).find(r => (r as any).active) as any).semester : (allData.registrasi && (allData.registrasi as any[])[0]?.semester) || undefined;

            const scheduleChanges: any[] = [];
            let finalJadwal: any[] = (allData.jadwal || []).map((j:any) => ({ ...j }));

            if (session && session.semester && semesterActive && session.semester === semesterActive && Array.isArray((session as any).jadwal)) {
                finalJadwal = JSON.parse(JSON.stringify((session as any).jadwal || []));
                const idxMap = new Map(finalJadwal.map((item:any, i:number) => [normalizeKey(item.code || item.matkul || ''), i]));
                for (const n of (allData.jadwal || [])) {
                    const key = normalizeKey(n.code || n.matkul || '');
                    const idx = idxMap.get(key);
                    if (typeof idx === 'number') {
                        const before = { hari: finalJadwal[idx].hari, jam: finalJadwal[idx].jam, ruang: finalJadwal[idx].ruang };
                        let changed = false;
                        for (const f of ['hari','jam','ruang']) {
                            if (n[f] && n[f] !== '-' && n[f] !== finalJadwal[idx][f]) {
                                finalJadwal[idx][f] = n[f];
                                changed = true;
                            }
                        }
                        if (changed) scheduleChanges.push({ type: 'updated', key, before, after: { hari: finalJadwal[idx].hari, jam: finalJadwal[idx].jam, ruang: finalJadwal[idx].ruang } });
                    } else {
                        const matchKhs = (allData.khs?.matkul || []).find((k:any) => normalizeKey(k.code || k.matkul || '') === key);
                        const toAdd = { ...n, dosen: n.dosen || (matchKhs?.dosen || '-') };
                        finalJadwal.push(toAdd);
                        scheduleChanges.push({ type: 'added', key, item: toAdd });
                    }
                }
            } else {
                finalJadwal = (allData.jadwal || []).map((n:any) => {
                    const matchKhs = (allData.khs?.matkul || []).find((k:any) => normalizeKey(k.code || k.matkul || '') === normalizeKey(n.code || n.matkul || ''));
                    return { ...n, dosen: n.dosen || (matchKhs?.dosen || '-') };
                });
                if (session && session.semester && semesterActive && session.semester !== semesterActive) {
                    scheduleChanges.push({ type: 'semester_changed', from: session.semester, to: semesterActive });
                }
            }

            // scheduleStats
            const totalClasses = finalJadwal.length;
            const editedCount = finalJadwal.filter((j:any) => (j.hari && j.hari !== '-' && j.hari !== '') || (j.jam && j.jam !== '-' && j.jam !== '') || (j.ruang && j.ruang !== '-' && j.ruang !== '')).length;
            const dayNames: Record<number,string> = {0:'Minggu',1:'Senin',2:'Selasa',3:'Rabu',4:'Kamis',5:'Jumat',6:'Sabtu'};
            const todayName = dayNames[new Date().getDay()];
            const scheduleToday = finalJadwal.filter((j:any) => (j.hari || '').toLowerCase().includes(todayName.toLowerCase()));

            // persist session (cookiesLatest)
            const cookiesLatest = await page.cookies();
            let outToken = sessionToken;
            if (session) {
                updateSession(sessionToken!, cookiesLatest as any, { semester: semesterActive, jadwal: finalJadwal });
            } else {
                const s = createSession(nim, cookiesLatest as any);
                outToken = s.token;
                updateSession(s.token, cookiesLatest as any, { semester: semesterActive, jadwal: finalJadwal });
            }

            await browser.close();

            const responsePayload = {
                success: true,
                nim,
                profile: allData.profile,
                dashboard: allData.dashboard || {},
                keuangan: allData.keuangan,
                registrasi: allData.registrasi,
                khs: allData.khs,
                dhs: allData.dhs,
                jadwal: finalJadwal,
                dhe: allData.dhe,
                scheduleChanges,
                scheduleStats: { totalClasses, editedCount, scheduleTodayCount: scheduleToday.length, scheduleToday }
            };

            const response = NextResponse.json(responsePayload);
            if (outToken) response.cookies.set('siakad_session', outToken, { httpOnly: true, secure: true, path: '/' });
            return response;

        } catch (error: any) {
            if (browser) await browser.close();
            console.error("🔥 Error:", error.message);
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}