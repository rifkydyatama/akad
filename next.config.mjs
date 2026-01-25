/** @type {import('next').NextConfig} */
const nextConfig = {
  // 1. DAFTAR PENGECUALIAN (WAJIB LENGKAP)
  // Kita harus exclude 'puppeteer-extra' dan plugin-nya agar Webpack tidak error
  serverExternalPackages: [
    'puppeteer-core', 
    '@sparticuz/chromium',
    'puppeteer-extra', 
    'puppeteer-extra-plugin-stealth' 
  ],

  // 2. ABAYKAN ERROR SAAT BUILD (Penting buat Vercel)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // 3. CONFIG TAMBAHAN (Opsional, tapi bagus untuk safety net)
  webpack: (config) => {
    config.externals.push({
      '@sparticuz/chromium': 'commonjs @sparticuz/chromium',
      'puppeteer-core': 'commonjs puppeteer-core',
    });
    return config;
  },
};

export default nextConfig;