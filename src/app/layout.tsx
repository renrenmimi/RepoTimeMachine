import type { Metadata, Viewport } from 'next';
import { THEME_BOOTSTRAP } from '@/lib/theme';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://repo-time-machine.vercel.app';

const description =
  'Step through the commits of a public GitHub repository: an evolving file tree, the diff each commit introduced, and a side-by-side comparison of any two points.';

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
  // Both themes are first-class, so the browser chrome follows the one in use.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#111714' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning` covers the `data-theme` attribute: the script
     * below writes it before the first paint, so the server markup — which
     * cannot know the visitor's stored choice — never carries it.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Runs before paint, so an explicitly chosen theme never flashes the
          other one. Inline rather than a module because a fetch would be a
          round trip in front of the first pixel, and written as a child rather
          than through `dangerouslySetInnerHTML` because it is a compile-time
          constant with nothing interpolated into it.
        */}
        <script>{THEME_BOOTSTRAP}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
