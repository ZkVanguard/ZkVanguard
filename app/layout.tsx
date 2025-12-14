import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../styles/globals.css';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Chronos Vanguard - AI-Powered RWA Risk Management',
  description: 'Multi-agent AI system for real-world asset risk management on Cronos zkEVM',
  keywords: ['RWA', 'DeFi', 'AI Agents', 'Risk Management', 'Cronos', 'zkEVM'],
  authors: [{ name: 'Chronos Vanguard Team' }],
  openGraph: {
    title: 'Chronos Vanguard',
    description: 'AI-Powered RWA Risk Management Platform',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <div className="flex flex-col min-h-screen">
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
