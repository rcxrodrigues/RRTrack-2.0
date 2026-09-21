import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Manrope } from 'next/font/google';

import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
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
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: 'hsl(222 47% 4%)' },
    { media: '(prefers-color-scheme: light)', color: 'hsl(150 20% 99%)' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `class="dark"` já no SSR: o escuro é o padrão do produto e aparece
    // mesmo antes do JS carregar. O next-themes assume daqui em diante.
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${manrope.variable} ${jetbrainsMono.variable}`}>
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
