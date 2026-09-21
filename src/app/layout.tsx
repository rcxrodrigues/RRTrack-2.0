import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'RRTrack',
    template: '%s · RRTrack',
  },
  description: 'Tracking server-side com painel.',
  // O painel é privado: não deve aparecer em buscador nenhum.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/marca/icone-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/marca/rr-icone.webp', sizes: '256x256', type: 'image/webp' },
    ],
    apple: '/marca/icone-180.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: 'hsl(225 45% 5%)' },
    { media: '(prefers-color-scheme: light)', color: 'hsl(210 20% 99%)' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `class="dark"` já no SSR: o escuro é o padrão do produto e aparece
    // mesmo antes do JS carregar. O next-themes assume daqui em diante.
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
