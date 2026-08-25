import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://repo-time-machine.vercel.app';

const description =
  'Watch a public GitHub repository grow commit by commit: a playable timeline, an evolving file tree, commit diffs, and transparent milestone heuristics.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Repo Time Machine',
    template: '%s — Repo Time Machine',
  },
  description,
  applicationName: 'Repo Time Machine',
  keywords: ['git history', 'github', 'repository visualisation', 'commit timeline', 'code archaeology'],
  authors: [{ name: 'renrenmimi', url: 'https://github.com/renrenmimi' }],
  creator: 'renrenmimi',
  openGraph: {
    type: 'website',
    siteName: 'Repo Time Machine',
    title: 'Repo Time Machine',
    description,
    url: SITE_URL,
    locale: 'en',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Repo Time Machine',
    description,
  },
  robots: { index: true, follow: true },
  category: 'technology',
};

export const viewport: Viewport = {
  themeColor: '#0c0f0d',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
