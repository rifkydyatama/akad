import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Detik

// Helper parsing
const parseNominal = (raw: string | undefined | null) => {
  if (!raw) return 0;
  const first = String(raw).split(',')[0];
  const digits = first.replace(/\./g, '').replace(/[^0-9-]/g, '');
  const n = parseInt(digits || '0', 10);
  return Number.isFinite(n) ? n : 0;
};

const formatRp = (n: number) => {
  try { return `Rp ${n.toLocaleString('id-ID')}`; } catch { return String(n); }
};

export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch {}

  const nim = String(body.nim || '').trim();
  const password = String(body.password || '').trim();
  
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('siakad_session')?.value;
  const session = getSession(sessionToken);
  const useSession = !password && !!session;

  if (!useSession && (!nim || !password)) {
    return NextResponse.json({ success: false, message: "Login gagal. Masukkan NIM & Password." }, { status: 401 });
  }

  const activeNim = useSession ? session!.nim : nim;
  // Gunakan key unik untuk deduplikasi request
  const inflightKey = sessionToken ? `token:${sessionToken}` : `nim:${activeNim}`;

  return await dedupeInflight(inflightKey, async () => {
    let browser: any = null;
    
    try {
      console.log("🚀 Memulai Robot Scraper...");
      
      // --- LOGIKA BROWSER (VERCEL vs LOCAL) ---
      if (process.env.NODE_ENV === 'production') {
        // MODE VERCEL
        console.log("⚙️ Mode: Production (Vercel)");
        const chromium = await import('@sparticuz/chromium');
        const puppeteerCore = await import('puppeteer-core');
        
        browser = await puppeteerCore.default.launch({
          args: chromium.default.args,
          defaultViewport: chromium.default.defaultViewport,
          executablePath: await chromium.default.executablePath(),
          headless: chromium.default.headless,
        });
      } else {
        // MODE LOCAL (Laptop)
        console.log("⚙️ Mode: Development (Local)");
        const puppeteer = await import('puppeteer-extra');
        const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
        
        puppeteer.default.use(StealthPlugin.default());
        browser = await puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
        });
      }

      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60000);
      page.setDefaultTimeout(30000);
      
      // User Agent biar dikira manusia
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

      // Helper Navigasi
      const gotoWithRetry = async (url: string) => {
        try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); }
        catch { await page.reload({ waitUntil: 'networkidle2' }); }
      };

      // 1. LOGIN
      if (useSession) {
        await gotoWithRetry('https://siakad.um.ac.id/');
        await page.setCookie(...session!.cookies);
      } else {
        await gotoWithRetry('https://siakad.um.ac.id/');
        const inputSelector = 'input[name="username"], input[name="identity"], #username';
        await page.waitForSelector(inputSelector, { timeout: 10000 });
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

      // 2. SCRAPE PROFIL
      try {
        await gotoWithRetry('https://siakad.um.ac.id/dashboard/');
        allData.profile = await page.evaluate(() => {
          const body = document.body.innerText;
          const getT = (k: string) => (body.match(new RegExp(`${k}\\s*[:]?\\s*([^\\n]+)`, 'i')) || [])[1]?.trim().replace(/^[:\-\s]+/, '') || "-";
          return {
            name: document.querySelector('.user-name span')?.textContent?.trim() || "Mahasiswa",
            prodi: getT('Program Studi'),
            fakultas: getT('Fakultas'),
            dosenPa: getT('Dosen PA'),
            status: getT('Status'),
            jalur: getT('Jalur Masuk')
          };
        });
      } catch (e) { console.log("Skip Profil", e); }

      // 3. SCRAPE KEUANGAN (FIX 450 JUTA + AUTO COLUMN)
      try {
        await gotoWithRetry('https://siakad.um.ac.id/riwayat-keuangan/');
        try { await page.waitForSelector('table', { timeout: 10000 }); } catch {}

        allData.keuangan = await page.evaluate(() => {
          const res: any[] = [];
          const tables = Array.from(document.querySelectorAll('table'));
          // Cari tabel yang header-nya ada THAKA dan TGL BAYAR
          const target = tables.find(t => t.innerText.includes('THAKA') && t.innerText.toUpperCase().includes('TGL BAYAR'));
          
          if (target) {
            const rows = Array.from(target.querySelectorAll('tr'));
            rows.forEach((row, idx) => {
              if (idx === 0) return;
              const cols = Array.from(row.querySelectorAll('td'));
              const texts = cols.map(c => (c.innerText || "").trim());

              // Cari kolom THAKA (5 digit angka)
              const thakaIdx = texts.findIndex(t => /^\d{5}$/.test(t));
              if (thakaIdx === -1) return;

              const thakaRaw = texts[thakaIdx];
              // Nominal biasanya kolom sebelah kanannya
              const nominalRaw = texts[thakaIdx + 1] || "0";
              // Tanggal format dd/mm/yyyy
              const tglRaw = texts.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t)) || "-";

              // Bersihkan Nominal (Buang desimal, buang titik)
              const mainNominal = nominalRaw.split(',')[0];
              const nominalValue = parseInt(mainNominal.replace(/\./g, '')) || 0;
              const nominalDisplay = `Rp ${new Intl.NumberFormat('id-ID').format(nominalValue)}`;

              // Parse Semester
              const th = thakaRaw.substring(0, 4);
              const kd = thakaRaw.substring(4, 5);
              const semLabel = kd === '1' ? 'Ganjil' : (kd === '2' ? 'Genap' : 'Antara');
              const semNama = `Semester ${semLabel} ${th}/${parseInt(th)+1}`;

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
                total: nominalValue
              });
            });
          }
          const riwayat = res.reverse();
          const totalPaid = riwayat.filter((r: any) => r.status.includes('Lunas')).reduce((a: number, b: any) => a + b.spp, 0);
          return { riwayat, totals: { totalPaid } };
        });
      } catch (e) { console.log("Skip Keuangan", e); }

      // 4. SCRAPE REGISTRASI
      try {
        await gotoWithRetry('https://siakad.um.ac.id/riwayat-registrasi/');
        try { await page.waitForSelector('table', { timeout: 10000 }); } catch {}
        
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
                 let sem = (cols[0]?.innerText || "").trim();
                 const stat = (cols[cols.length-1]?.innerText || "").trim();
                 if (/^\d{5}$/.test(sem)) {
                   const th = sem.substring(0,4);
                   const k = sem.substring(4,5);
                   const l = k==='1'?'Ganjil':(k==='2'?'Genap':'Antara');
                   sem = `Semester ${l} ${th}/${parseInt(th)+1}`;
                 }
                 out.push({ semester: sem, status: stat });
               }
             });
          }
          return out;
        });
      } catch (e) { console.log("Skip Registrasi"); }

      // --- SELESAI ---
      let outSessionToken = sessionToken;
      try {
        const latestCookies = await page.cookies();
        if (useSession && outSessionToken) updateSession(outSessionToken, latestCookies as any);
        else outSessionToken = createSession(activeNim, latestCookies as any).token;
      } catch {}

      await browser.close();

      const res = NextResponse.json({ success: true, nim: activeNim, ...allData });
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