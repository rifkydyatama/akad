import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

// --- BARIS INI WAJIB ADA ---
import "./globals.css";
// ---------------------------

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SIAKAD 5.0",
  description: "Student Dashboard",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SIAKAD 5.0",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "SIAKAD 5.0",
    title: "SIAKAD 5.0",
    description: "Student Dashboard",
  },
  twitter: {
    card: "summary",
    title: "SIAKAD 5.0",
    description: "Student Dashboard",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e293b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="application-name" content="SIAKAD 5.0" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SIAKAD 5.0" />
        <meta name="description" content="Student Dashboard" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
        <meta name="msapplication-TileColor" content="#1e293b" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta name="theme-color" content="#1e293b" />

        <link rel="apple-touch-icon" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512x512.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icon-192x192.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="mask-icon" href="/icon-192x192.png" color="#1e293b" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
      <body className={inter.className}>
        <div className="bg-gradient-mesh" aria-hidden>
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
        </div>

        {children}
      </body>
    </html>
  );
}