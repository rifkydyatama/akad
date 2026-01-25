import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

type KeuanganRiwayat = {
  thaka: string;
  semester?: string;
  nominal: number;
  nominalFormatted?: string;
  tglBayar?: string | null;
  status: string;
};

type RegistrasiItem = { semester: string; status: string };

const parseNominal = (raw: string | undefined | null) => {
  if (!raw) return 0;
  // Drop decimal part after comma, then remove thousand dots
  const first = String(raw).split(',')[0];
  const digits = first.replace(/\./g, '').replace(/[^0-9-]/g, '');
  const n = parseInt(digits || '0', 10);
  return Number.isFinite(n) ? n : 0;
};

const formatRp = (n: number) => {
  try {
    return n.toLocaleString('id-ID');
  } catch {
    return String(n);
  }
};

const parseRegistrasiCode = (code: string) => {
  // Expecting e.g. 20251 => Year 2025, term 1
  if (!/^\d{5}$/.test(code)) return null;
  const year = Number(code.slice(0, 4));
  const termDigit = code[4];
  const term = termDigit === '1' ? 'Ganjil' : termDigit === '2' ? 'Genap' : 'Antara';
  return `Semester ${term} ${year}/${year + 1}`;
};

export async function POST(req: Request) {
  const body = await (async () => {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ success: false, message: 'Missing `url` in request body.' }, { status: 400 });

  let browser: any | null = null;
  try {
    // Dynamic imports depending on environment
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    if (isProd) {
      const puppeteerCore = await import('puppeteer-core');
      const chromiumMod = await import('@sparticuz/chromium-min');
      const Chromium = (chromiumMod && (chromiumMod.default || chromiumMod)) as any;
      let executablePath: string | undefined;
      try {
        if (Chromium && typeof Chromium.executablePath === 'function') executablePath = await Chromium.executablePath();
      } catch (e) {
        // ignore
      }

      const args = (Chromium && (Chromium.args || Chromium.defaultArgs)) || ['--no-sandbox', '--disable-setuid-sandbox'];

      browser = await puppeteerCore.launch({
        executablePath: executablePath || undefined,
        headless: true,
        args,
        defaultViewport: null,
      });
    } else {
      // Local/dev: try puppeteer-extra first, fall back to puppeteer
      let puppeteerMod: any;
      try {
        puppeteerMod = await import('puppeteer-extra');
        puppeteerMod = puppeteerMod && (puppeteerMod.default || puppeteerMod);
      } catch {
        puppeteerMod = await import('puppeteer');
        puppeteerMod = puppeteerMod && (puppeteerMod.default || puppeteerMod);
      }

      browser = await puppeteerMod.launch({ headless: false, defaultViewport: null, args: ['--no-sandbox'] });
    }

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

    // Extract tables as arrays of rows->cells text
    const tables: string[][][] = await page.$$eval('table', (nodes) =>
      nodes.map((t) =>
        Array.from(t.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((td) => (td.textContent || '').trim())),
      ),
    );

    // Helper to find date string dd/mm/yyyy
    const dateRegex = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
    const thakaRegex = /^\d{5}$/;

    const keuanganRows: KeuanganRiwayat[] = [];
    const registrasi: RegistrasiItem[] = [];

    for (const table of tables) {
      if (!table || table.length === 0) continue;

      // Flatten to detect if this table looks like keuangan (has a THAKA 5-digit anywhere)
      let thakaColIndex: number | null = null;
      for (const row of table) {
        for (let ci = 0; ci < row.length; ci++) {
          const cell = (row[ci] || '').trim();
          if (thakaRegex.test(cell)) {
            thakaColIndex = ci;
            break;
          }
        }
        if (thakaColIndex !== null) break;
      }

      if (thakaColIndex !== null) {
        // Treat as keuangan table
        for (const row of table) {
          const thaka = String(row[thakaColIndex] || '').trim();
          if (!thakaRegex.test(thaka)) continue;

          const nominalRaw = String(row[thakaColIndex + 1] || '').trim();
          const nominal = parseNominal(nominalRaw);
          // Search for date in the row
          let tgl: string | null = null;
          for (const c of row) {
            const m = String(c || '').match(dateRegex);
            if (m) {
              tgl = m[0];
              break;
            }
          }

          // Determine status
          let status = 'Belum Lunas';
          if (nominal === 0 && !tgl) status = 'Menunggu Tagihan';
          else if (nominal === 0 && tgl) status = 'Lunas (Beasiswa)';
          else if (nominal > 0 && tgl) status = 'Lunas';

          keuanganRows.push({
            thaka,
            nominal,
            nominalFormatted: formatRp(nominal),
            tglBayar: tgl,
            status,
          });
        }
        continue; // don't also treat same table as registrasi
      }

      // Try detect registrasi table: header contains 'semester' or 'status'
      const headerRow = table[0] || [];
      const hdr = headerRow.map((h) => String(h).toLowerCase()).join(' ');
      if (hdr.includes('semester') || hdr.includes('status') || hdr.includes('registrasi')) {
        for (const row of table.slice(1)) {
          // attempt to locate semester code or text
          let semText = '';
          let statusText = '';
          for (const c of row) {
            const s = String(c || '').trim();
            if (!semText && /^\d{5}$/.test(s)) {
              const human = parseRegistrasiCode(s);
              semText = human || s;
              continue;
            }
            if (!semText && /(semester)/i.test(s)) semText = s;
            if (!statusText && /^(aktif|selesai|valid|lunas|menunggu)/i.test(s)) statusText = s;
            // fallback: detect values that look like "2025/2026" + "Ganjil"
            if (!semText && /20\d{2}\/20\d{2}/.test(s)) semText = s;
          }

          if (semText || statusText) {
            registrasi.push({ semester: semText || 'Unknown', status: statusText || 'Unknown' });
          }
        }
      }
    }

    const keuanganPayload = {
      riwayat: keuanganRows,
      totals: {
        totalPaid: keuanganRows.filter((r) => r.status && r.status.toLowerCase().includes('lunas')).reduce((s, r) => s + (r.nominal || 0), 0),
        paidCount: keuanganRows.filter((r) => r.status && r.status.toLowerCase().includes('lunas')).length,
        unpaidCount: keuanganRows.filter((r) => !r.status || !r.status.toLowerCase().includes('lunas')).length,
      },
    };

    return NextResponse.json({ success: true, keuangan: keuanganPayload, registrasi }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: String(err && err.message ? err.message : err) }, { status: 500 });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
  }
}