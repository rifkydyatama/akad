/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tambahkan paket-paket ini agar Webpack tidak error saat build
  serverExternalPackages: [
    'puppeteer-core', 
    'puppeteer-extra', 
    'puppeteer-extra-plugin-stealth',
    '@sparticuz/chromium-min',
  ],
  
  // Opsi eksperimental (jaga-jaga untuk Next.js versi baru)
  experimental: {
    serverComponentsExternalPackages: [
        'puppeteer-core', 
        'puppeteer-extra', 
        'puppeteer-extra-plugin-stealth',
        '@sparticuz/chromium-min',
    ],
  },
};

// Kalau Mas pakai PWA, bungkus export default di bawah ini
// import withPWA from 'next-pwa';
// export default withPWA({
//   dest: 'public',
//   register: true,
//   skipWaiting: true,
// })(nextConfig);

// Kalau TIDAK pakai PWA, langsung saja:
export default nextConfig;

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