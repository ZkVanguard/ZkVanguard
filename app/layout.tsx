import type { Metadata } from 'next';
import '../styles/globals.css';
import { Providers } from './providers';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';

export const metadata: Metadata = {
  title: 'ZkVanguard - AI-Powered RWA Risk Management with Zero-Knowledge Proofs',
  description: 'Multi-agent AI system for real-world asset risk management on Cronos zkEVM',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
              // Support light mode by default
              document.documentElement.style.backgroundColor = '#FFFFFF';
              if (document.body) {
                document.body.style.backgroundColor = '#F2F2F7';
              }
              
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
      <body className="bg-white text-label-primary">
        <Providers>
          <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-grow pt-[52px]">
              {children}
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
