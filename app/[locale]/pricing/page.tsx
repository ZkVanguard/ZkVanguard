import { Metadata } from 'next';
import { PricingSection } from '@/components/PricingSection';
import { Link } from '@/i18n/routing';
import { REVENUE_STREAMS, POOL_ECONOMICS, PREMIUM_PRODUCT_FEES } from '@/lib/config/pricing';

export const metadata: Metadata = {
  title: 'Pricing | ZkVanguard',
  description:
    'Three revenue streams, all mapped to shipped code: automatic pool fees, per-use premium product fees, and SaaS subscriptions for end users + B2B API access.',
};

export default async function PricingPage() {
  return (
    <div className="min-h-screen bg-[#fbfbfd]">
      {/* Navbar — collapses to compact on mobile (link labels shorten) */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5 pt-safe pl-safe pr-safe">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2 min-w-0">
          <Link href="/" className="text-base sm:text-[20px] font-semibold text-[#1d1d1f] truncate">
            ZkVanguard
          </Link>
          <div className="flex items-center gap-2 sm:gap-6 flex-shrink-0">
            <Link href="/developers" className="text-[13px] sm:text-[14px] text-[#86868b] hover:text-[#1d1d1f] hidden xs:inline">
              API
            </Link>
            <Link href="/dashboard" className="text-[13px] sm:text-[14px] text-[#86868b] hover:text-[#1d1d1f] hidden sm:inline">
              Dashboard
            </Link>
            <Link
              href="/dashboard"
              className="bg-[#007AFF] text-white h-9 sm:h-auto px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-[14px] font-medium hover:bg-[#0066d6] active:scale-[0.98] transition-all"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 pt-20 sm:pt-24 pb-12 sm:pb-16 min-w-0">
        {/* Hero */}
        <header className="text-center max-w-3xl mx-auto mb-8 sm:mb-12 min-w-0">
          <div className="text-[11px] sm:text-[12px] text-[#86868b] uppercase tracking-wide font-medium mb-2 sm:mb-3">
            Three revenue streams · all mapped to shipped code
          </div>
          <h1 className="text-3xl sm:text-[40px] md:text-[48px] font-semibold text-[#1d1d1f] tracking-[-0.02em] leading-tight break-words">
            Pay only for the value you actually use.
          </h1>
          <p className="text-sm sm:text-base md:text-[17px] text-[#86868b] mt-3 sm:mt-4 leading-relaxed px-1">
            Pool depositors pay automatic on-chain fees. Premium products are per-use.
            Subscriptions unlock private hedges, portfolio creation, and the
            Aladdin-as-a-Service B2B API surface.
          </p>
        </header>

        {/* Three-stream framing */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-10 sm:mb-16 min-w-0">
          {REVENUE_STREAMS.map((stream) => (
            <div
              key={stream.id}
              className="bg-white border border-black/5 rounded-2xl p-4 sm:p-6 min-w-0"
            >
              <div
                className={`text-[10px] sm:text-[11px] uppercase tracking-wide font-semibold mb-1.5 sm:mb-2 ${
                  stream.status === 'live'
                    ? 'text-green-700'
                    : stream.status === 'tranche-2'
                      ? 'text-amber-700'
                      : 'text-[#4ca3ff]'
                }`}
              >
                {stream.status === 'live' ? 'live now' : stream.status.replace('-', ' ')}
              </div>
              <h3 className="text-base sm:text-[17px] font-semibold text-[#1d1d1f] mb-2 break-words">
                {stream.label}
              </h3>
              <p className="text-xs sm:text-[13px] text-[#86868b] mb-3 leading-relaxed break-words">
                {stream.blurb}
              </p>
              <ul className="text-[11px] sm:text-[12px] text-[#1d1d1f] space-y-1">
                {stream.examples.map((ex, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#86868b] flex-shrink-0">·</span>
                    <span className="break-words">{ex}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Pool fees explicit block */}
        <section className="bg-gradient-to-br from-[#f5f5f7] to-white border border-black/5 rounded-2xl p-4 sm:p-6 mb-8 sm:mb-12 min-w-0">
          <h2 className="text-lg sm:text-[20px] font-semibold text-[#1d1d1f] mb-2 break-words">
            Stream 1 — Community pool fees (automatic, no subscription)
          </h2>
          <p className="text-xs sm:text-[14px] text-[#86868b] mb-3 sm:mb-4 leading-relaxed">
            Anyone who deposits USDC in the SUI Community Pool pays these on-chain via
            <code className="bg-white px-1.5 py-0.5 rounded mx-1 break-all">community_pool_usdc.move</code>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 min-w-0">
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
        <section className="bg-white border border-black/5 rounded-2xl p-4 sm:p-6 mb-8 sm:mb-12 min-w-0">
          <h2 className="text-lg sm:text-[20px] font-semibold text-[#1d1d1f] mb-2 break-words">
            Stream 2 — Premium products (per-use)
          </h2>
          <p className="text-xs sm:text-[14px] text-[#86868b] mb-3 sm:mb-4 leading-relaxed">
            Charged at the action that creates value — no recurring base fee on the products themselves.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 min-w-0">
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
        <section className="mb-10 sm:mb-16 min-w-0">
          <header className="mb-6 sm:mb-8">
            <h2 className="text-xl sm:text-[24px] font-semibold text-[#1d1d1f] break-words">
              Stream 3 — Subscriptions
            </h2>
            <p className="text-xs sm:text-[14px] text-[#86868b] mt-1 leading-relaxed">
              Unlocks premium product access and the B2B API surface (Aladdin-as-a-Service).
              Free tier is always usable — pool fees and per-use fees apply regardless.
            </p>
          </header>
          <PricingSection />
        </section>

        {/* FAQ */}
        <section className="mt-10 sm:mt-16 min-w-0">
          <h2 className="text-2xl sm:text-[28px] font-semibold text-[#1d1d1f] text-center mb-6 sm:mb-10 break-words">
            Frequently asked questions
          </h2>

          <div className="max-w-3xl mx-auto space-y-3 sm:space-y-4">
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
              <Link href="/developers" className="text-[#4ca3ff] underline">/developers</Link>{' '}
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

      <footer className="bg-white border-t border-black/5 py-6 sm:py-8 pb-safe">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 text-center text-[11px] sm:text-[13px] text-[#86868b] leading-relaxed" suppressHydrationWarning>
          © {new Date().getFullYear()} ZkVanguard · Pricing aligns with{' '}
          <code className="bg-[#f5f5f7] px-1 py-0.5 rounded break-all">community_pool_usdc.move</code>{' '}
          on Sui mainnet · subscriptions Stripe-ready, live with Tranche 2
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] sm:text-[11px] text-[#86868b] uppercase tracking-wide font-medium mb-1 truncate">
        {label}
      </div>
      <div className="text-lg sm:text-[24px] font-semibold text-[#1d1d1f] tabular-nums break-all">{value}</div>
      {sub && <div className="text-[11px] sm:text-[12px] text-[#86868b] mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function FeeCard({
  title, priceTop, subtitle, note,
}: { title: string; priceTop: string; subtitle: string; note: string }) {
  return (
    <div className="border border-black/5 rounded-xl p-3 sm:p-4 bg-[#fbfbfd] min-w-0">
      <div className="text-[13px] sm:text-[14px] font-semibold text-[#1d1d1f] mb-1 truncate">{title}</div>
      <div className="text-base sm:text-[20px] font-semibold text-[#1d1d1f] tabular-nums break-all">{priceTop}</div>
      <div className="text-[11px] sm:text-[12px] text-[#86868b] break-words">{subtitle}</div>
      <div className="text-[10px] sm:text-[11px] text-[#86868b] mt-2 font-mono break-all">{note}</div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="bg-white rounded-2xl border border-black/5 p-4 sm:p-5 group min-w-0">
      <summary className="cursor-pointer text-sm sm:text-[15px] font-semibold text-[#1d1d1f] flex items-center justify-between gap-2 min-w-0">
        <span className="break-words min-w-0">{q}</span>
        <span className="text-[#86868b] text-[12px] group-open:rotate-180 transition-transform flex-shrink-0">▾</span>
      </summary>
      <div className="text-xs sm:text-[14px] text-[#86868b] leading-relaxed mt-3 break-words">{children}</div>
    </details>
  );
}
