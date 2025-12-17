import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../styles/globals.css';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ZkVanguard - AI-Powered RWA Risk Management with Zero-Knowledge Proofs',
  description: 'Multi-agent AI system for real-world asset risk management on Cronos zkEVM',
  keywords: ['RWA', 'DeFi', 'AI Agents', 'Risk Management', 'Cronos', 'zkEVM'],
  authors: [{ name: 'ZkVanguard Team' }],
  icons: {
    icon: '/assets/branding/logo-icon.svg',
    shortcut: '/assets/branding/logo-icon.svg',
    apple: '/assets/branding/logo-navbar.svg',
  },
  openGraph: {
    title: 'ZkVanguard',
    description: 'AI-Powered RWA Risk Management Platform',
    type: 'website',
    images: ['/logo.svg'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Aggressively block WalletConnect Cloud API calls
                const blockedDomains = ['api.web3modal.org', 'pulse.walletconnect.org', 'explorer-api.walletconnect.com'];
                
                // Store original fetch
                const _fetch = window.fetch;
                
                // Override fetch with blocking logic
                window.fetch = function(input, init) {
                  const url = typeof input === 'string' ? input : input?.url || '';
                  
                  // Check if URL contains blocked domain
                  for (let i = 0; i < blockedDomains.length; i++) {
                    if (url.indexOf(blockedDomains[i]) !== -1) {
                      logger.debug('[API Blocked]', { url: url.substring(0, 100) });
                      
                      // Return mock successful response immediately
                      return Promise.resolve(new Response(
                        JSON.stringify({ success: true, data: [], wallets: [], total: 0, features: {} }),
                        {
                          status: 200,
                          statusText: 'OK',
                          headers: new Headers({ 'Content-Type': 'application/json' })
                        }
                      ));
                    }
                  }
                  
                  // Call original fetch for non-blocked URLs
                  return _fetch.apply(this, arguments);
                };
                
                // Also patch fetch on prototype
                Object.defineProperty(window, 'fetch', {
                  value: window.fetch,
                  writable: false,
                  configurable: false
                });
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.className} bg-slate-900 text-white`}>
        <Providers>
          <div className="flex flex-col min-h-screen bg-slate-900">
            <Navbar />
            <main className="flex-grow pt-20">
              {children}
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
