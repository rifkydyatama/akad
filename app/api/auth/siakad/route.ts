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

            // Determine active semester (prefer status 'Aktif') and convert 5-digit codes to human friendly label
            const semesterAktif = (() => {
                const active = (allData.registrasi || []).find((r:any) => /aktif/i.test(String(r.status || '')));
                let sem = active?.semester || (allData.registrasi && allData.registrasi[0]?.semester) || null;
                if (sem && /^\d{5}$/.test(String(sem))) {
                    const y = String(sem).slice(0,4);
                    const t = String(sem)[4];
                    const term = t === '1' ? 'Ganjil' : t === '2' ? 'Genap' : 'Antara';
                    sem = `Semester ${term} ${y}/${Number(y) + 1}`;
                }
                return sem;
            })();

            // Detailed KHS: extract matkul list with code, name, sks, nilai, dosen
            allData.khs.matkul = await scrapeFrames('https://siakad.um.ac.id/khs/', () => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                    const headers = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                    const joined = headers.join(' ');
                    if ((joined.includes('nama') || joined.includes('matakul')) && (joined.includes('sks') || joined.includes('kode') || joined.includes('nilai'))) {
                        const rows = Array.from(t.querySelectorAll('tr')).slice(1);
                        return rows.map(row => {
                            const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                            const code = cols[0] || '';
                            const name = cols[1] || '';
                            const sks = parseInt(cols[2] || '0') || 0;
                            const nilai = cols[cols.length - 2] || '';
                            const dosen = cols[cols.length - 1] || '';
                            return { code, matkul: name, sks, nilai, dosen };
                        }).filter((x:any) => x.matkul);
                    }
                }
                return [];
            }) || [];

            // Detailed Jadwal: detect columns (kode/nama/dosen/hari/jam/ruang) if present
            const jadwalRaw = await scrapeFrames('https://siakad.um.ac.id/krs/', () => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (const t of tables) {
                    const ths = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim().toLowerCase());
                    const joined = ths.join(' ');
                    if (joined.includes('kode') || joined.includes('nama') || joined.includes('mata')) {
                        const rows = Array.from(t.querySelectorAll('tr')).slice(1);
                        return rows.map(row => {
                            const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                            const idxKode = ths.findIndex(h => h.includes('kode'));
                            const idxNama = ths.findIndex(h => h.includes('nama') || h.includes('mata'));
                            const idxDosen = ths.findIndex(h => h.includes('dosen'));
                            const idxHari = ths.findIndex(h => h.includes('hari') || h.includes('day'));
                            const idxJam = ths.findIndex(h => h.includes('jam') || h.includes('time'));
                            const idxRuang = ths.findIndex(h => h.includes('ruang') || h.includes('room'));
                            const code = idxKode >= 0 ? cols[idxKode] || '' : (cols[0] || '');
                            const name = idxNama >= 0 ? cols[idxNama] || '' : (cols[1] || '');
                            const dosen = idxDosen >= 0 ? cols[idxDosen] || '' : (cols[cols.length - 1] || '-');
                            const hari = idxHari >= 0 ? cols[idxHari] || '-' : '-';
                            const jam = idxJam >= 0 ? cols[idxJam] || '-' : '-';
                            const ruang = idxRuang >= 0 ? cols[idxRuang] || '-' : '-';
                            return { code, matkul: name, dosen: dosen || '-', hari, jam, ruang };
                        }).filter((x:any) => x.matkul);
                    }
                }
                return [];
            }) || [];

            // Merge jadwal with session-stored jadwal respecting semester lock
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const scheduleChanges: any[] = [];
            let finalJadwal: any[] = [];
            if (session && session.semester && session.semester === semesterAktif && Array.isArray((session as any).jadwal)) {
                // Start from existing and update only hari/jam/ruang when new info exists
                finalJadwal = JSON.parse(JSON.stringify((session as any).jadwal || []));
                const mapIdx = new Map(finalJadwal.map((j:any, i:number) => [((j.code || j.matkul) || '').toLowerCase(), i]));
                for (const n of jadwalRaw) {
                    const key = ((n.code || n.matkul) || '').toLowerCase();
                    const idx = mapIdx.get(key);
                    if (typeof idx === 'number') {
                        const old = { hari: finalJadwal[idx].hari, jam: finalJadwal[idx].jam, ruang: finalJadwal[idx].ruang };
                        let changed = false;
                        for (const f of ['hari','jam','ruang']) {
                            if (n[f] && n[f] !== '-' && n[f] !== finalJadwal[idx][f]) {
                                finalJadwal[idx][f] = n[f];
                                changed = true;
                            }
                        }
                        if (changed) scheduleChanges.push({ type: 'updated', key, before: old, after: { hari: finalJadwal[idx].hari, jam: finalJadwal[idx].jam, ruang: finalJadwal[idx].ruang } });
                    } else {
                        // new entry: enrich with KHS dosen when possible
                        const matchKhs = allData.khs.matkul?.find((k:any) => ((k.code || k.matkul) || '').toLowerCase() === key);
                        const toAdd = { ...n, dosen: n.dosen || (matchKhs?.dosen || '-') };
                        finalJadwal.push(toAdd);
                        scheduleChanges.push({ type: 'added', key, item: toAdd });
                    }
                }
            } else {
                // Semester changed or no session -> replace with fresh jadwal (enrich dosen)
                finalJadwal = jadwalRaw.map((n:any) => {
                    const matchKhs = allData.khs.matkul?.find((k:any) => ((k.code || k.matkul) || '').toLowerCase() === ((n.code || n.matkul) || '').toLowerCase());
                    return { ...n, dosen: n.dosen || (matchKhs?.dosen || '-') };
                });
                if (session && session.semester !== semesterAktif) scheduleChanges.push({ type: 'semester_changed', from: session.semester, to: semesterAktif });
            }

            // Persist session with jadwal and semester metadata
            const latestCookies = (await page.cookies()) as any;
            let outSessionToken = sessionToken;
            if (session) {
                updateSession(sessionToken!, latestCookies, { semester: semesterAktif || undefined, jadwal: finalJadwal });
            } else {
                const created = createSession(nim, latestCookies);
                updateSession(created.token, latestCookies, { semester: semesterAktif || undefined, jadwal: finalJadwal });
                outSessionToken = created.token;
            }

            await browser.close();

            const response = NextResponse.json({ success: true, nim, ...allData, scheduleChanges });
            if (outSessionToken) response.cookies.set('siakad_session', outSessionToken, { httpOnly: true, secure: true, path: '/', maxAge: 43200 });
            return response;

        } catch (error: any) {
            if (browser) await browser.close();
            return NextResponse.json({ success: false, message: error.message }, { status: 500 });
        }
    }, 60000);
}