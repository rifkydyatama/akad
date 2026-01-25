import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cleanupSessions, createSession, dedupeInflight, getSession, updateSession } from './_session';
import type { SiakadSession } from './_session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

type RegistrasiItem = { semester: string; status: string };

type KeuanganRiwayat = {
  thaka: string;
  semester?: string;
  nominal: number;
  nominalFormatted?: string;
  tglBayar?: string | null;
  status: string;
};

type Profile = {
  name: string;
  prodi: string;
  fakultas: string;
  dosenPa: string;
  status: string;
  jalur: string;
  foto: string | null;
};

type KhsItem = { matkul: string; sks: number; nilai: string };
type Khs = { semester: string; ips: string; matkul: KhsItem[] };
type Dhs = { ipk: string; totalSks: string };
type JadwalItem = { matkul: string; hari: string; jam: string; ruang: string; dosen?: string };
type DheItem = { kegiatan: string; poin: string };

type AllData = {
  profile: Profile;
  keuangan: {
    riwayat: KeuanganRiwayat[];
    totals: {
      totalPaid: number;
      paidCount: number;
      unpaidCount: number;
    };
  };
  registrasi: RegistrasiItem[];
  khs: Khs;
  dhs: Dhs;
  jadwal: JadwalItem[];
  dhe: DheItem[];
};

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

  const nim = String(body.nim || '').trim();
  const password = String(body.password || '').trim();

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
    // Use existing session data
    // For now, we'll still need to scrape, but we can use cached data or minimal scraping
  }

  // Hardcoded SIAKAD URL - this should be configurable or detected
  const siakadUrl = 'https://siakad.um.ac.id/'; // Replace with actual SIAKAD URL

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any | null = null;
  try {
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    if (isProd) {
      // Production: use puppeteer-core + @sparticuz/chromium-min
      const puppeteerCore = await import('puppeteer-core');
      const chromium = (await import('@sparticuz/chromium-min')) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      browser = await puppeteerCore.launch({
        executablePath: chromium.executablePath,
        headless: true,
        args: chromium.args,
        defaultViewport: null,
      });
    } else {
      // Development: use puppeteer-extra (which uses local puppeteer)
      const puppeteerExtra = (await import('puppeteer-extra')).default;
      browser = await puppeteerExtra.launch({
        headless: false,
        defaultViewport: null,
        args: ['--no-sandbox'],
      });
    }

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    );
    await page.goto(siakadUrl, { waitUntil: 'networkidle2', timeout: 60_000 });

    // If we have credentials, perform login
    if (!useSession && nim && password) {
      // Perform login logic here
      // This would involve filling login form and submitting
      // For now, we'll assume login is successful and proceed to scraping
    }

    // Extract tables as arrays of rows->cells text
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables: string[][][] = await page.$$eval('table', (nodes: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodes.map((t: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Array.from(t.querySelectorAll('tr')).map((tr: any) => Array.from(tr.querySelectorAll('th,td')).map((td: any) => (td.textContent || '').trim())),
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

    // Mock data for other fields - in real implementation, these would be scraped from different pages
    const mockData = {
      profile: {
        name: "Nama Mahasiswa",
        prodi: "Program Studi",
        fakultas: "Fakultas",
        dosenPa: "Dosen PA",
        status: "Aktif",
        jalur: "Reguler",
        foto: null,
      },
      khs: {
        semester: "2024/2025 Ganjil",
        ips: "3.75",
        matkul: [
          { matkul: "Mata Kuliah 1", sks: 3, nilai: "A" },
          { matkul: "Mata Kuliah 2", sks: 2, nilai: "B+" },
        ],
      },
      dhs: { ipk: "3.5", totalSks: "120" },
      jadwal: [
        { matkul: "Mata Kuliah 1", hari: "Senin", jam: "08:00-10:00", ruang: "Ruang 101" },
        { matkul: "Mata Kuliah 2", hari: "Selasa", jam: "10:00-12:00", ruang: "Ruang 102" },
      ],
      dhe: [
        { kegiatan: "Kegiatan 1", poin: "10" },
        { kegiatan: "Kegiatan 2", poin: "15" },
      ],
    };

    // Create session if this was a fresh login
    let outSessionToken: string | undefined;
    if (!useSession && nim && password) {
      // Mock session creation - in real implementation, this would use actual login cookies
      const mockCookies = [
        { name: 'session_id', value: 'mock_session_' + Date.now(), domain: 'siakad.uns.ac.id' }
      ];
      const newSession = createSession(nim, mockCookies);
      outSessionToken = newSession.token;
    }

    const response = NextResponse.json({
      success: true,
      ...mockData,
      keuangan: keuanganPayload,
      registrasi,
    }, { status: 200 });

    if (outSessionToken) {
      response.cookies.set('siakad_session', outSessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 12 * 60 * 60,
      });
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
  }
}