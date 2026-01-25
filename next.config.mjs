/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow server-side external packages used for Chromium / Puppeteer
  serverExternalPackages: [
    'puppeteer-core',
    '@sparticuz/chromium-min',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
  ],

  // Avoid failing Vercel builds due to typecheck/lint warnings
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;