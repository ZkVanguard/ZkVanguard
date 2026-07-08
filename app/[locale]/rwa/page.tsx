'use client';

import { Link } from '@/i18n/routing';
import { Navbar } from '@/components/Navbar';
import {
  ShieldCheck, FileText, Lock, ArrowRight, Download,
  Building2, KeyRound, GitBranch, CheckCircle2,
} from 'lucide-react';

// Standalone /rwa page — for RWA issuers, custodians, and institutional
// counterparties. Explains the custody-attestation product without requiring
// the reader to already understand the pool. Mirrors the visual language
// of /zk so the two feel like siblings, not different projects.

export default function RwaPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-24 sm:pt-32 pb-16 sm:pb-24">
        {/* Hero */}
        <div className="text-center mb-12 sm:mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-[#007AFF]/10 rounded-full text-xs sm:text-sm font-medium mb-4 sm:mb-6 text-[#007AFF]">
            <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>For RWA issuers &amp; institutional custodians</span>
          </div>
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-[#1D1D1F] mb-4 sm:mb-6 tracking-tight leading-[1.1]">
            Real-world assets, <br className="hidden md:block" />
            <span className="text-[#007AFF]">provably backed on-chain.</span>
          </h1>
          <p className="text-base sm:text-xl text-[#424245] max-w-2xl mx-auto leading-relaxed">
            Bind an off-chain asset list to an on-chain portfolio with a custodian-signed attestation.
            Counterparties verify the binding cryptographically — <strong>without ever seeing the assets themselves.</strong>
          </p>
          <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row justify-center items-stretch sm:items-center gap-3">
            <Link
              href="/dashboard/custody"
              className="inline-flex items-center justify-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-[#007AFF] text-white rounded-full font-medium hover:bg-[#0056b3] active:scale-[0.98] transition-all text-sm sm:text-base"
            >
              View attestations
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="mailto:ashishregmi2017@gmail.com?subject=ZkVanguard%20RWA%20custody%20onboarding"
              className="inline-flex items-center justify-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-white border border-[#d2d2d7] text-[#1d1d1f] rounded-full font-medium hover:bg-[#f5f5f7] active:scale-[0.98] transition-all text-sm sm:text-base"
            >
              Request custodian onboarding
            </a>
          </div>
        </div>

        {/* How it works */}
        <section className="mb-12 sm:mb-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1D1D1F] mb-5 sm:mb-8">How it works</h2>
          <ol className="space-y-3 sm:space-y-4">
            {[
              {
                icon: FileText,
                title: 'Agree on the asset list off-chain',
                body: 'You and your custodian settle the exact list of assets that back the portfolio — outside the blockchain, in whatever format your compliance regime requires.',
              },
              {
                icon: KeyRound,
                title: 'Compute the canonical hash',
                body: 'Both sides independently hash the list via POST /api/custody · action:hash-assets. If your hashes match, you have a shared reference the chain can commit to.',
              },
              {
                icon: Lock,
                title: 'Custodian signs, you submit',
                body: 'Custodian signs a build-message payload with their enrolled ed25519 key. You submit the signature via rwa_custody_attestor::submit_attestation.',
              },
              {
                icon: ShieldCheck,
                title: 'Anyone verifies, no asset list required',
                body: 'Any counterparty calls POST /api/custody · action:verify with the attestation object id. They learn "yes, this portfolio is backed by an asset list this custodian signed" — nothing about which assets, nothing about the value.',
              },
            ].map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6 flex gap-4">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#007AFF]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1D1D1F] mb-1 text-[15px] sm:text-base">
                    <span className="text-[#86868B] mr-1.5">{i + 1}.</span>{title}
                  </h3>
                  <p className="text-[#424245] text-sm leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Who uses this */}
        <section className="mb-12 sm:mb-20">
          <div className="rounded-2xl bg-[#F5F5F7] p-5 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-bold text-[#1D1D1F] mb-4 sm:mb-6">Who this is for</h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 sm:gap-y-5">
              {[
                ['Tokenized-treasury issuers', 'Bind on-chain treasury bill wrappers to the actual custody holdings without revealing the position list.'],
                ['Real estate / receivables platforms', 'Prove that a portfolio is backed by an underlying loan or property pool without disclosing borrower identities.'],
                ['Fund managers issuing on-chain shares', 'Give LPs cryptographic proof of NAV backing at any point in time — auditor-ready artifacts, no share leakage.'],
                ['Custodians serving crypto-native clients', 'Sign attestations once. Every counterparty verification is a stateless off-chain call — no ongoing operational burden.'],
              ].map(([title, body]) => (
                <div key={title as string}>
                  <dt className="font-semibold text-[#1D1D1F] text-[15px] mb-1">{title}</dt>
                  <dd className="text-[#424245] text-sm leading-relaxed">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Technical detail */}
        <section className="mb-12 sm:mb-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1D1D1F] mb-5 sm:mb-8">Under the hood</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-3">
                <GitBranch className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Move contract</h3>
              <p className="text-[#424245] text-sm leading-relaxed mb-3">
                <code className="text-xs bg-[#F5F5F7] px-1.5 py-0.5 rounded">rwa_custody_attestor.move</code> — Sui Move, 340 LOC, 11/11 tests passing.
                Ed25519 signature verification, canonical SHA-256 asset-list hash, nonce + expiry gating.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-3">
                <Download className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Portable artifacts</h3>
              <p className="text-[#424245] text-sm leading-relaxed">
                Every attestation is downloadable as a canonical JSON that any counterparty can verify off-chain via a single POST request — no wallet connection required.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Composable API</h3>
              <p className="text-[#424245] text-sm leading-relaxed">
                <code className="text-xs bg-[#F5F5F7] px-1.5 py-0.5 rounded">/api/custody</code> exposes <code className="text-xs bg-[#F5F5F7] px-1.5 py-0.5 rounded">hash-assets</code>, <code className="text-xs bg-[#F5F5F7] px-1.5 py-0.5 rounded">build-message</code>, <code className="text-xs bg-[#F5F5F7] px-1.5 py-0.5 rounded">verify</code>, <code className="text-xs bg-[#F5F5F7] px-1.5 py-0.5 rounded">list-attestations</code>. Off-chain flow is stateless.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-5 sm:p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-3">
                <ShieldCheck className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Privacy by construction</h3>
              <p className="text-[#424245] text-sm leading-relaxed">
                Only the SHA-256 hash and custodian pubkey hit the chain. Asset list, position sizes, counterparty identities: all off-chain, all confidential.
              </p>
            </div>
          </div>
        </section>

        {/* Deployment status callout */}
        <section className="mb-12 sm:mb-20">
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-amber-700" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-amber-900 mb-1 text-[15px]">Contract audited internally, mainnet deploy pending</h3>
                <p className="text-sm text-amber-800 leading-relaxed">
                  <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs">rwa_custody_attestor.move</code> is written, tested (11/11), and awaiting external audit sign-off as a
                  {' '}Tranche 2/3 deliverable. The off-chain API + JSON artifact downloader are already live so integration work can start today.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-[#E5E5E7] pt-8 sm:pt-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1D1D1F] mb-3">
            Onboard as a custodian
          </h2>
          <p className="text-[#424245] text-base sm:text-lg max-w-2xl mx-auto mb-6 sm:mb-8">
            Enrol your ed25519 signing key, run through the hash-assets flow with a test payload, then start issuing attestations. We&apos;ll walk you through the whole loop in a 30-min call.
          </p>
          <a
            href="mailto:ashishregmi2017@gmail.com?subject=ZkVanguard%20RWA%20custody%20onboarding"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#1d1d1f] text-white rounded-full font-medium hover:bg-[#0A0E1A] active:scale-[0.98] transition-all text-sm sm:text-base"
          >
            Book onboarding call
            <ArrowRight className="w-4 h-4" />
          </a>
        </section>
      </main>
    </div>
  );
}
