import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Spine — a memory layer for your AI',
  description:
    'Your AI forgets you every morning. Spine is a quiet memory layer that remembers across sessions and across models, so your assistant finally knows you.',
  openGraph: {
    title: 'Spine — a memory layer for your AI',
    description:
      'Your AI forgets you every morning. We fix that.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#f3ede1',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans min-h-screen" style={{ background: 'var(--s-bg)', color: 'var(--s-ink)' }}>{children}</body>
    </html>
  );
}
