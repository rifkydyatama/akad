import withPWA from 'next-pwa';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Paket native/large yang harus dibiarkan di luar bundler Next.js (server-only)
  // Tambahkan `puppeteer-core` dan `@sparticuz/chromium-min` untuk runtime Vercel
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium-min'],

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