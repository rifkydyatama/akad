/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow server-side external packages used for Chromium / Puppeteer
  serverExternalPackages: [
    'puppeteer-core',
    '@sparticuz/chromium-min',
  ],
};

export default nextConfig;