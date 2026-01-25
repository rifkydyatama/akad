import withPWA from 'next-pwa';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Paket native/large dan plugin yang harus dibiarkan di luar bundler Next.js (server-only)
  // Tambahkan `puppeteer-core`, `@sparticuz/chromium-min` untuk runtime Vercel,
  // serta `puppeteer-extra` dan `puppeteer-extra-plugin-stealth` untuk mencegah
  // webpack mencoba menganalisis modul-modul CJS yang tidak statically-analyzable.
  serverExternalPackages: [
    'puppeteer-core',
    '@sparticuz/chromium-min',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
  ],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ui-avatars.com',
      },
    ],
  },

  // Force webpack for PWA compatibility
  webpack: (config) => {
    return config;
  },
};

export default withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
})(nextConfig);