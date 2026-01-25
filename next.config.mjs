import withPWA from 'next-pwa';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ini adalah kunci agar robot Puppeteer tidak error saat dijalankan Next.js
  serverExternalPackages: ['puppeteer-extra', 'puppeteer-extra-plugin-stealth', 'puppeteer'],

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