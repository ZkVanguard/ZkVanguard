import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import '../../styles/globals.css';
import { Providers } from '../providers';
import { Navbar } from '../../components/Navbar';
import { Footer } from '../../components/Footer';
import { CookieConsent } from '../../components/CookieConsent';
import { locales } from '../../i18n/request';
import { IntlProvider } from '../../components/IntlProvider';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params: { locale }
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'hero' });
  
  return {
    title: 'ZkVanguard - AI-Powered RWA Risk Management with Zero-Knowledge Proofs',
    description: t('subtitle'),
    keywords: ['RWA', 'DeFi', 'AI Agents', 'Risk Management', 'Cronos', 'zkEVM'],
    authors: [{ name: 'ZkVanguard Team' }],
    icons: {
      icon: '/logo-official.svg',
      shortcut: '/logo-official.svg',
      apple: '/logo-official.svg',
    },
    openGraph: {
      title: 'ZkVanguard',
      description: 'AI-Powered RWA Risk Management Platform',
      type: 'website',
      images: ['/logo-official.svg'],
    },
  };
}

export default async function LocaleLayout({
  children,
  params: { locale }
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  // Validate locale
  if (!locales.includes(locale as typeof locales[number])) {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Resource hints for faster loading */}
        <link rel="preconnect" href="https://api.crypto.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.crypto.com" />
        <link rel="preconnect" href="https://testnet.cronos.org" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://testnet.cronos.org" />
        
        {/* Preload critical fonts (system fonts, no external fonts needed) */}
        <style dangerouslySetInnerHTML={{ __html: `
          /* Critical inline CSS for instant render */
          * { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          body { margin: 0; background: #fff; }
          @keyframes shimmer { 0% { background-position: -1000px 0; } 100% { background-position: 1000px 0; } }
        `}} />
        
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Critical theme initialization (no FOUC - Flash Of Unstyled Content)
              (function() {
                const theme = localStorage.getItem('theme') || 'light';
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased bg-[#fbfbfd] min-h-screen" suppressHydrationWarning>
        <IntlProvider locale={locale}>
          <Providers>
            <div className="flex flex-col min-h-screen">
              <Navbar />
              <main className="flex-1">
                {children}
              </main>
              <Footer />
              <CookieConsent />
            </div>
          </Providers>
        </IntlProvider>
      </body>
    </html>
  );
}
