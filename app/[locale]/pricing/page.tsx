import { Metadata } from 'next';
import { PricingSection } from '@/components/PricingSection';
import Link from 'next/link';
import { REVENUE_STREAMS, POOL_ECONOMICS, PREMIUM_PRODUCT_FEES } from '@/lib/config/pricing';

export const metadata: Metadata = {
  title: 'Pricing | ZkVanguard',
  description:
    'Three revenue streams, all mapped to shipped code: automatic pool fees, per-use premium product fees, and SaaS subscriptions for end users + B2B API access.',
};

export default async function PricingPage() {
  return (
    <div className="min-h-screen bg-[#fbfbfd]">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="text-[20px] font-semibold text-[#1d1d1f]">
            ZkVanguard
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/api-docs" className="text-[14px] text-[#86868b] hover:text-[#1d1d1f]">
              API
            </Link>
            <Link href="/dashboard" className="text-[14px] text-[#86868b] hover:text-[#1d1d1f]">
              Dashboard
            </Link>
            <Link
              href="/dashboard"
              className="bg-[#007AFF] text-white px-4 py-2 rounded-full text-[14px] font-medium hover:bg-[#0066d6]"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 pt-24 pb-16">
        {/* Hero */}
        <header className="text-center max-w-3xl mx-auto mb-12">
          <div className="text-[12px] text-[#86868b] uppercase tracking-wide font-medium mb-3">
            Three revenue streams · all mapped to shipped code
          </div>
          <h1 className="text-[40px] sm:text-[48px] font-semibold text-[#1d1d1f] tracking-[-0.02em] leading-tight">
            Pay only for the value you actually use.
          </h1>
          <p className="text-[17px] text-[#86868b] mt-4 leading-relaxed">
            Pool depositors pay automatic on-chain fees. Premium products are per-use.
            Subscriptions unlock private hedges, portfolio creation, and the
            Aladdin-as-a-Service B2B API surface.
          </p>
        </header>

        {/* Three-stream framing */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
          {REVENUE_STREAMS.map((stream) => (
            <div
              key={stream.id}
              className="bg-white border border-black/5 rounded-2xl p-6"
            >
              <div
                className={`text-[11px] uppercase tracking-wide font-semibold mb-2 ${
                  stream.status === 'live'
                    ? 'text-green-700'
                    : stream.status === 'tranche-2'
                      ? 'text-amber-700'
                      : 'text-[#4ca3ff]'
                }`}
              >
                {stream.status === 'live' ? 'live now' : stream.status.replace('-', ' ')}
              </div>
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                {stream.label}
              </h3>
              <p className="text-[13px] text-[#86868b] mb-3 leading-relaxed">
                {stream.blurb}
              </p>
              <ul className="text-[12px] text-[#1d1d1f] space-y-1">
                {stream.examples.map((ex, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#86868b]">·</span>
                    <span>{ex}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Pool fees explicit block */}
        <section className="bg-gradient-to-br from-[#f5f5f7] to-white border border-black/5 rounded-2xl p-6 mb-12">
          <h2 className="text-[20px] font-semibold text-[#1d1d1f] mb-2">
            Stream 1 — Community pool fees (automatic, no subscription)
          </h2>
          <p className="text-[14px] text-[#86868b] mb-4">
            Anyone who deposits USDC in the SUI Community Pool pays these on-chain via
            <code className="bg-white px-1.5 py-0.5 rounded mx-1">community_pool_usdc.move</code>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Stat
              label="Management fee"
              value={`${POOL_ECONOMICS.managementFeeBps / 100}%`}
              sub="annual, on AUM"
            />
            <Stat
              label="Performance fee"
              value={`${POOL_ECONOMICS.performanceFeePercent}%`}
              sub="on profits above HWM"
            />
            <Stat
              label="Fee recipient"
              value={POOL_ECONOMICS.feeRecipient}
              sub="multisig-controlled"
            />
          </div>
        </section>

        {/* Premium per-use fees */}
        <section className="bg-white border border-black/5 rounded-2xl p-6 mb-12">
          <h2 className="text-[20px] font-semibold text-[#1d1d1f] mb-2">
            Stream 2 — Premium products (per-use)
          </h2>
          <p className="text-[14px] text-[#86868b] mb-4">
            Charged at the action that creates value — no recurring base fee on the products themselves.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeeCard
              title="Private Hedges"
              priceTop={`$${PREMIUM_PRODUCT_FEES.privateHedge.perHedgeUsd} or ${PREMIUM_PRODUCT_FEES.privateHedge.feeRateBps} bps`}
              subtitle="per hedge — lower of the two"
              note="zk_hedge_commitment.move on Sui mainnet"
            />
            <FeeCard
              title="Private Portfolio Creator"
              priceTop={`$${PREMIUM_PRODUCT_FEES.privatePortfolio.creationFeeUsd} setup`}
              subtitle={`+ ${PREMIUM_PRODUCT_FEES.privatePortfolio.ongoingMgmtFeeBps / 100}% annual mgmt`}
              note="zk_proxy_vault PDA-style proxies"
            />
            <FeeCard
              title="Custody Attestation"
              priceTop={`$${PREMIUM_PRODUCT_FEES.custodyAttestation.custodianEnrollmentUsd.toLocaleString()}`}
              subtitle={`per custodian enrollment · $${PREMIUM_PRODUCT_FEES.custodyAttestation.perAttestationSubmissionUsd} per attestation`}
              note="rwa_custody_attestor.move (Tranche 2-3 deploy)"
            />
          </div>
        </section>

        {/* Subscription tiers (existing PricingSection) */}
        <section className="mb-16">
          <header className="mb-8">
            <h2 className="text-[24px] font-semibold text-[#1d1d1f]">
              Stream 3 — Subscriptions
            </h2>
            <p className="text-[14px] text-[#86868b] mt-1">
              Unlocks premium product access and the B2B API surface (Aladdin-as-a-Service).
              Free tier is always usable — pool fees and per-use fees apply regardless.
            </p>
          </header>
          <PricingSection />
        </section>

        {/* FAQ */}
        <section className="mt-16">
          <h2 className="text-[28px] font-semibold text-[#1d1d1f] text-center mb-10">
            Frequently asked questions
          </h2>

          <div className="max-w-3xl mx-auto space-y-4">
            <Faq q="Do I need a subscription to deposit in the community pool?">
              No. Anyone with a SUI wallet can deposit USDC; pool fees are charged
              automatically on-chain. Subscriptions only unlock the premium products
              (private hedges, private portfolios, custody attestation) and the B2B
              API surface.
            </Faq>

            <Faq q="What's the performance fee and how is it charged?">
              The pool charges {POOL_ECONOMICS.performanceFeePercent}% of profits above the per-share
              high-water mark. The fee is debited from the pool by{' '}
              <code className="bg-[#f5f5f7] px-1.5 py-0.5 rounded">community_pool_usdc.move</code>{' '}
              at fee-collection time and routed to a multisig-controlled FeeManagerCap.
              No subscription tier changes this number.
            </Faq>

            <Faq q="What does API access actually get me?">
              Free tier: 120 req/min read-only public endpoints (predictions, risk
              overview, agent activity). Pro: write APIs (open/close hedges
              programmatically, attest decisions). Institutional: 10K req/min and
              custody-attestation request flow. Enterprise: white-label the entire
              autonomous risk engine. See{' '}
              <Link href="/api-docs" className="text-[#4ca3ff] underline">/api-docs</Link>{' '}
              for the full surface.
            </Faq>

            <Faq q="What are ZK proofs and the per-month quota?">
              Each tier includes a quota of off-chain ZK-STARK proof generations from the
              Python prover (NIST P-521, no trusted setup). Beyond the quota a per-proof fee
              applies. Pool depositors get attestation proofs automatically on every
              cron tick — those come out of the pool's quota, not yours.
            </Faq>

            <Faq q="Why are the institutional prices so high if TVL is only $57?">
              The contract-enforced $10K TVL cap is intentional pre-audit. Subscription
              tiers exist so revenue can scale post-audit without a re-pricing cycle.
              Today's primary monetization path is the grant + audit deposit, not
              subscription revenue.
            </Faq>

            <Faq q="Can I upgrade or downgrade my plan?">
              Yes. Upgrades take effect immediately, downgrades at the end of your
              billing period. Annual plans get ~17% discount. Stripe schema is already
              wired in <code className="bg-[#f5f5f7] px-1.5 py-0.5 rounded">lib/config/subscription-types.ts</code>;
              billing goes live with Tranche 2 audit fix-up.
            </Faq>

            <Faq q="What chains are supported?">
              SUI mainnet is the live production deployment. EVM mirrors on Arbitrum
              Sepolia, Hedera Testnet, Oasis Emerald/Sapphire, and Ethereum Sepolia
              are deployment-ready but the live product is SUI-first by design — new
              features land on SUI before any other chain.
            </Faq>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-black/5 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-[13px] text-[#86868b]" suppressHydrationWarning>
          © {new Date().getFullYear()} ZkVanguard · Pricing aligns with{' '}
          <code className="bg-[#f5f5f7] px-1 py-0.5 rounded">community_pool_usdc.move</code>{' '}
          on Sui mainnet · subscriptions Stripe-ready, live with Tranche 2
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium mb-1">
        {label}
      </div>
      <div className="text-[24px] font-semibold text-[#1d1d1f]">{value}</div>
      {sub && <div className="text-[12px] text-[#86868b] mt-0.5">{sub}</div>}
    </div>
  );
}

function FeeCard({
  title, priceTop, subtitle, note,
}: { title: string; priceTop: string; subtitle: string; note: string }) {
  return (
    <div className="border border-black/5 rounded-xl p-4 bg-[#fbfbfd]">
      <div className="text-[14px] font-semibold text-[#1d1d1f] mb-1">{title}</div>
      <div className="text-[20px] font-semibold text-[#1d1d1f]">{priceTop}</div>
      <div className="text-[12px] text-[#86868b]">{subtitle}</div>
      <div className="text-[11px] text-[#86868b] mt-2 font-mono">{note}</div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="bg-white rounded-2xl border border-black/5 p-5 group">
      <summary className="cursor-pointer text-[15px] font-semibold text-[#1d1d1f] flex items-center justify-between">
        {q}
        <span className="text-[#86868b] text-[12px] group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="text-[14px] text-[#86868b] leading-relaxed mt-3">{children}</div>
    </details>
  );
}
