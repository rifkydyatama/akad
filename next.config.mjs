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