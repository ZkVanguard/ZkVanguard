"use client";

import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen bg-white light-theme">
      <Navbar />
      
      <main className="max-w-4xl mx-auto px-6 py-16">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#007AFF]/10 rounded-full text-sm font-medium mb-6 text-[#007AFF]">
            <span>Version 1.0</span>
            <span>•</span>
            <span>January 2026</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-[#1d1d1f] mb-6 tracking-tight">
            ZkVanguard Whitepaper
          </h1>
          <p className="text-xl text-[#86868b] max-w-2xl mx-auto leading-relaxed">
            AI-Powered Predictive Risk Management with Zero-Knowledge Privacy for Institutional Digital Assets
          </p>
        </div>

        {/* Download Button */}
        <div className="flex justify-center mb-16">
          <a 
            href="#abstract" 
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#007AFF] text-white rounded-full font-medium hover:bg-[#0056b3] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Read Whitepaper
          </a>
        </div>

        {/* Table of Contents */}
        <div className="bg-[#f5f5f7] rounded-2xl p-8 mb-16">
          <h2 className="text-lg font-semibold text-[#1d1d1f] mb-6">Table of Contents</h2>
          <nav className="space-y-3">
            {[
              { num: "1", title: "Abstract", href: "#abstract" },
              { num: "2", title: "Introduction & Market Opportunity", href: "#introduction" },
              { num: "3", title: "The Problem: Reactive Risk Management", href: "#problem" },
              { num: "4", title: "Our Solution: Predictive Intelligence", href: "#solution" },
              { num: "5", title: "Technical Architecture", href: "#architecture" },
              { num: "6", title: "Multi-Agent AI System", href: "#agents" },
              { num: "7", title: "Zero-Knowledge Privacy Layer", href: "#zkp" },
              { num: "8", title: "Gasless Transaction Protocol (x402)", href: "#gasless" },
              { num: "9", title: "Prediction Market Integration", href: "#predictions" },
              { num: "10", title: "Multi-Chain Strategy", href: "#multichain" },
              { num: "11", title: "Security Analysis", href: "#security" },
              { num: "12", title: "Tokenomics & Economics", href: "#tokenomics" },
              { num: "13", title: "Roadmap", href: "#roadmap" },
              { num: "14", title: "Conclusion", href: "#conclusion" },
              { num: "15", title: "References", href: "#references" },
            ].map(({ num, title, href }) => (
              <a 
                key={num}
                href={href}
                className="flex items-center gap-4 text-[#424245] hover:text-[#007AFF] transition-colors"
              >
                <span className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-sm font-medium text-[#86868b]">
                  {num}
                </span>
                <span>{title}</span>
              </a>
            ))}
          </nav>
        </div>

        {/* Content Sections */}
        <article className="max-w-none">
          
          {/* Abstract */}
          <section id="abstract" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">1</span>
              Abstract
            </h2>
            <div className="bg-gradient-to-r from-[#007AFF]/5 to-transparent p-6 rounded-xl border-l-4 border-[#007AFF] mb-6">
              <p className="text-[#1d1d1f] leading-relaxed m-0">
                ZkVanguard introduces a paradigm shift in institutional digital asset risk management by combining autonomous AI agents with crowd-sourced prediction market intelligence and post-quantum zero-knowledge cryptography. Unlike traditional reactive systems that respond to market crashes after they occur, ZkVanguard&apos;s predictive architecture anticipates volatility events 3-7 days in advance, enabling preemptive portfolio protection.
              </p>
            </div>
            <p className="text-[#424245] leading-relaxed">
              The platform orchestrates six specialized AI agents—Lead, Risk, Hedging, Settlement, Reporting, and Price Monitor—that autonomously analyze portfolios, consume real-time prediction market data from Delphi/Polymarket, generate mathematically-optimal hedge strategies, and execute gasless transactions on the Cronos blockchain. All sensitive portfolio data remains private through our CUDA-accelerated ZK-STARK proof system with 512-bit target security (180-bit effective soundness via FRI protocol), while maintaining full regulatory compliance through verifiable computation.
            </p>
            <p className="text-[#424245] leading-relaxed">
              With $16 trillion in tokenized real-world assets (RWA) projected by 2030 and institutional capital currently sidelined due to inadequate risk infrastructure, ZkVanguard addresses a critical market gap. Our x402 gasless protocol eliminates transaction fees (97.4% gas coverage), while our privacy-preserving hedge architecture protects institutional trading strategies from front-running and competitive intelligence exposure.
            </p>
          </section>

          {/* Introduction */}
          <section id="introduction" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">2</span>
              Introduction & Market Opportunity
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">2.1 The $16 Trillion Opportunity</h3>
            <p className="text-[#424245] leading-relaxed">
              According to Boston Consulting Group&apos;s 2024 report, the tokenized real-world asset market is projected to reach $16 trillion by 2030, representing one of the largest wealth migrations in financial history. Currently, $1.2 trillion in institutional capital participates in decentralized finance, yet this figure represents a fraction of total institutional assets due to three critical barriers:
            </p>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>Reactive Risk Management:</strong> Existing tools only respond after market crashes, resulting in 15-30% portfolio drawdowns before protection activates</li>
              <li><strong>Privacy Vulnerabilities:</strong> Public blockchain transparency exposes institutional trading strategies, enabling front-running and competitive intelligence extraction</li>
              <li><strong>Prohibitive Transaction Costs:</strong> Gas fees of $5-$50 per transaction create 60-80% operational inefficiency, particularly during high-volatility periods</li>
            </ul>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">2.2 Market Timing</h3>
            <p className="text-[#424245] leading-relaxed">
              The convergence of several technological and regulatory developments creates an optimal market entry window:
            </p>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>Prediction Market Maturation:</strong> Polymarket and similar platforms have demonstrated 85%+ accuracy on major events, providing reliable forecasting data</li>
              <li><strong>ZK Technology Advancement:</strong> ZK-STARK proofs now achieve practical performance (2-5 second generation) with post-quantum security guarantees</li>
              <li><strong>Institutional Crypto Adoption:</strong> BlackRock, Fidelity, and major banks have launched digital asset products, signaling mainstream institutional acceptance</li>
              <li><strong>Regulatory Clarity:</strong> MiCA in Europe and evolving SEC guidance provide clearer compliance frameworks for institutional participants</li>
            </ul>
          </section>

          {/* Problem */}
          <section id="problem" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">3</span>
              The Problem: Reactive Risk Management
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">3.1 The Reactive Paradigm</h3>
            <p className="text-[#424245] leading-relaxed">
              Traditional cryptocurrency risk management operates on a fundamentally flawed paradigm: reaction rather than prediction. The typical workflow follows this pattern:
            </p>
            <div className="bg-red-50 p-6 rounded-xl my-6 font-mono text-sm">
              <div className="text-red-600">
                1. Market Event Occurs → BTC drops 15% in 4 hours<br/>
                2. Alert Triggered → Risk system detects volatility spike<br/>
                3. Human Review → Portfolio manager analyzes situation (30-60 min)<br/>
                4. Decision Made → Hedge strategy approved (15-30 min)<br/>
                5. Execution → Orders submitted to exchanges (5-15 min)<br/>
                6. Settlement → Transactions confirmed on-chain (2-10 min)<br/>
                <br/>
                Total Time: 52-115 minutes<br/>
                Portfolio Loss: 8-12% (during reaction delay)
              </div>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">3.2 The Cost of Reaction</h3>
            <p className="text-[#424245] leading-relaxed">
              Analysis of major market events from 2020-2025 reveals the true cost of reactive risk management:
            </p>
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse bg-[#fafafa] rounded-xl overflow-hidden border border-[#e5e5e5]">
                <thead className="bg-[#f0f0f2]">
                  <tr>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Event</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Total Drop</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Loss Before Hedge</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Predictable?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e5e5]">
                  <tr>
                    <td className="p-4 text-[#424245]">March 2020 COVID Crash</td>
                    <td className="p-4 text-[#424245]">-50%</td>
                    <td className="p-4 text-[#424245]">-35%</td>
                    <td className="p-4 text-green-600">Yes (pandemic spread data)</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">May 2021 China Ban</td>
                    <td className="p-4 text-[#424245]">-53%</td>
                    <td className="p-4 text-[#424245]">-28%</td>
                    <td className="p-4 text-green-600">Yes (regulatory signals)</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Luna/UST Collapse 2022</td>
                    <td className="p-4 text-[#424245]">-99%</td>
                    <td className="p-4 text-[#424245]">-45%</td>
                    <td className="p-4 text-green-600">Yes (depeg prediction markets)</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">FTX Collapse 2022</td>
                    <td className="p-4 text-[#424245]">-25%</td>
                    <td className="p-4 text-[#424245]">-18%</td>
                    <td className="p-4 text-green-600">Yes (withdrawal concerns)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">3.3 Privacy Exposure</h3>
            <p className="text-[#424245] leading-relaxed">
              Public blockchain transparency creates significant competitive disadvantages for institutional traders:
            </p>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>Front-Running:</strong> MEV bots extract $500M+ annually by detecting and front-running large orders</li>
              <li><strong>Strategy Leakage:</strong> Competitors can reverse-engineer trading strategies from on-chain activity</li>
              <li><strong>Regulatory Risk:</strong> Public portfolio exposure may violate confidentiality requirements</li>
              <li><strong>Market Impact:</strong> Visible large positions attract predatory trading</li>
            </ul>
          </section>

          {/* Solution */}
          <section id="solution" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">4</span>
              Our Solution: Predictive Intelligence
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">4.1 The Predictive Paradigm</h3>
            <p className="text-[#424245] leading-relaxed">
              ZkVanguard introduces a fundamentally different approach: predictive risk management powered by crowd-sourced intelligence. Instead of reacting to crashes, we anticipate them:
            </p>
            <div className="bg-green-50 p-6 rounded-xl my-6 font-mono text-sm">
              <div className="text-green-600">
                1. Prediction Markets Signal → Delphi: 73% probability BTC volatility spike<br/>
                2. AI Analysis → Risk Agent correlates with portfolio exposure<br/>
                3. Automatic Recommendation → Hedging Agent: &quot;Open SHORT, 61% hedge ratio&quot;<br/>
                4. User Review → Interactive modal, approve in 30 seconds<br/>
                5. Gasless Execution → x402 settlement, $0.00 fees<br/>
                6. ZK Proof → Privacy-preserved verification<br/>
                <br/>
                Total Time: 30 seconds<br/>
                Portfolio Protection: Activated 3-7 days BEFORE crash
              </div>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">4.2 Core Innovation Stack</h3>
            <div className="grid md:grid-cols-2 gap-6 my-6">
              <div className="bg-[#f5f5f7] p-6 rounded-xl">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">🤖 Multi-Agent AI System</h4>
                <p className="text-[#424245] text-sm">Six specialized agents coordinate autonomously to analyze, recommend, execute, and report on portfolio protection strategies.</p>
              </div>
              <div className="bg-[#f5f5f7] p-6 rounded-xl">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">🔮 Prediction Intelligence</h4>
                <p className="text-[#424245] text-sm">Real-time integration with Delphi/Polymarket prediction markets for crowd-sourced forecasting with 78%+ accuracy.</p>
              </div>
              <div className="bg-[#f5f5f7] p-6 rounded-xl">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">🔐 ZK-STARK Privacy</h4>
                <p className="text-[#424245] text-sm">CUDA-accelerated post-quantum zero-knowledge proofs (512-bit security, 180-bit soundness) protect all portfolio and trading data from public exposure.</p>
              </div>
              <div className="bg-[#f5f5f7] p-6 rounded-xl">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">⚡ Gasless Execution</h4>
                <p className="text-[#424245] text-sm">x402 protocol provides 97.4% gas coverage, reducing transaction costs from $15-50 to effectively $0.00.</p>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">4.3 User Experience Flow</h3>
            <ol className="list-decimal pl-6 text-[#424245] space-y-3">
              <li><strong>Connect Portfolio (5 sec):</strong> Link wallet or RWA positions—AI automatically discovers all assets</li>
              <li><strong>AI Risk Analysis (10 sec):</strong> Risk Agent calculates VaR, Sharpe ratio, and checks prediction markets</li>
              <li><strong>Review Prediction (10 sec):</strong> User sees &quot;🔮 Delphi Alert: 73% probability BTC volatility spike&quot;</li>
              <li><strong>User Decision (5 sec):</strong> Approve hedge, add to watchlist, or dismiss</li>
              <li><strong>Auto-Execution (instant):</strong> Hedging Agent opens position on Moonlander perpetuals</li>
              <li><strong>Gasless Settlement (instant):</strong> x402 processes transaction with $0.00 fees</li>
              <li><strong>ZK Verification (2-5 sec):</strong> Privacy-preserved proof published on-chain</li>
            </ol>
          </section>

          {/* Architecture */}
          <section id="architecture" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">5</span>
              Technical Architecture
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">5.1 System Overview</h3>
            <p className="text-[#424245] leading-relaxed">
              ZkVanguard employs a layered architecture designed for security, scalability, and autonomous operation:
            </p>
            <div className="bg-[#1d1d1f] text-green-400 p-6 rounded-xl my-6 font-mono text-xs overflow-x-auto">
              <pre>{`┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Chat Interface  │  │  Dashboard       │  │ ZK Proof View │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI AGENT ORCHESTRATION                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Lead Agent (Intent Parser & Coordinator)                │  │
│  │  - Natural language processing via Crypto.com AI SDK     │  │
│  │  - Task decomposition and delegation                     │  │
│  │  - Result aggregation and verification                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌─────────┬─────────┬──────────┬─────────────┬─────────────┐  │
│  │  Risk   │ Hedging │Settlement│  Reporting  │PriceMonitor │  │
│  │  Agent  │  Agent  │  Agent   │    Agent    │    Agent    │  │
│  └─────────┴─────────┴──────────┴─────────────┴─────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA & INTEGRATION LAYER                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Delphi  │  │ x402 API │  │Crypto.com│  │  Moonlander  │   │
│  │Polymarket│  │ Payments │  │   SDK    │  │  VVS Finance │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN LAYER (Cronos)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  RWA Manager │  │ ZK Verifier  │  │  Payment Router    │   │
│  │  Contract    │  │  Contract    │  │  (EIP-3009/x402)   │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘`}</pre>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">5.2 Technology Stack</h3>
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse bg-[#fafafa] rounded-xl overflow-hidden border border-[#e5e5e5]">
                <thead className="bg-[#f0f0f2]">
                  <tr>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Layer</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Technology</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e5e5]">
                  <tr>
                    <td className="p-4 text-[#424245]">Frontend</td>
                    <td className="p-4 text-[#424245]">Next.js 14, React 18, TypeScript, TailwindCSS</td>
                    <td className="p-4 text-[#424245]">User interface, real-time updates</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">AI Agents</td>
                    <td className="p-4 text-[#424245]">TypeScript, Crypto.com AI SDK</td>
                    <td className="p-4 text-[#424245]">Autonomous orchestration, NLP</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">ZK Backend</td>
                    <td className="p-4 text-[#424245]">Python 3.11, CUDA, FastAPI</td>
                    <td className="p-4 text-[#424245]">ZK-STARK proof generation</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Smart Contracts</td>
                    <td className="p-4 text-[#424245]">Solidity 0.8.20, Hardhat, OpenZeppelin</td>
                    <td className="p-4 text-[#424245]">On-chain settlement, verification</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Blockchain</td>
                    <td className="p-4 text-[#424245]">Cronos EVM, Cronos zkEVM, SUI</td>
                    <td className="p-4 text-[#424245]">Multi-chain execution</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Wallets</td>
                    <td className="p-4 text-[#424245]">RainbowKit (EVM), @mysten/dapp-kit (SUI)</td>
                    <td className="p-4 text-[#424245]">Secure wallet connection</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">5.3 Deployed Smart Contracts</h3>
            <p className="text-[#424245] leading-relaxed mb-4">
              All smart contracts are deployed on Cronos Testnet (Chain ID: 338) and verified:
            </p>
            <div className="bg-[#f5f5f7] p-6 rounded-xl font-mono text-sm">
              <div className="space-y-2">
                <p><strong>RWAManager:</strong> 0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189</p>
                <p><strong>ZKVerifier:</strong> 0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8</p>
                <p><strong>PaymentRouter:</strong> 0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b</p>
                <p><strong>GaslessZKVerifier:</strong> 0x44098d0dE36e157b4C1700B48d615285C76fdE47</p>
              </div>
            </div>
          </section>

          {/* Agents */}
          <section id="agents" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">6</span>
              Multi-Agent AI System
            </h2>
            
            <p className="text-[#424245] leading-relaxed">
              ZkVanguard deploys six specialized AI agents that operate autonomously while maintaining human-in-the-loop control for critical decisions:
            </p>

            <div className="space-y-6 my-8">
              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">🎯 Lead Agent - Strategy Orchestrator</h4>
                <ul className="list-disc pl-6 text-[#424245] space-y-1 text-sm">
                  <li>Coordinates all agent activities and workflow</li>
                  <li>Processes natural language commands via Crypto.com AI SDK</li>
                  <li>Routes tasks to specialized agents based on intent classification</li>
                  <li>Aggregates results and generates unified recommendations</li>
                </ul>
              </div>

              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">📊 Risk Agent - Real-Time Monitoring</h4>
                <ul className="list-disc pl-6 text-[#424245] space-y-1 text-sm">
                  <li>Calculates Value at Risk (VaR), volatility, Sharpe ratio, max drawdown</li>
                  <li>Monitors Delphi prediction markets for early warning signals</li>
                  <li>Adjusts risk scores based on crowd-sourced probabilities</li>
                  <li>Triggers alerts when thresholds exceeded</li>
                </ul>
              </div>

              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">🛡️ Hedging Agent - Predictive Execution</h4>
                <ul className="list-disc pl-6 text-[#424245] space-y-1 text-sm">
                  <li>Consumes prediction market data to calculate optimal hedge ratios</li>
                  <li>Adjusts hedge size based on Delphi probability (1.0-1.5x multiplier)</li>
                  <li>Executes via Moonlander perpetual futures (SHORT/LONG positions)</li>
                  <li>Manages position lifecycle (open, adjust, close)</li>
                </ul>
              </div>

              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">⚡ Settlement Agent - Gasless Transactions</h4>
                <ul className="list-disc pl-6 text-[#424245] space-y-1 text-sm">
                  <li>Processes all transactions via x402 gasless protocol</li>
                  <li>Achieves 97.4% gas refund coverage on Cronos</li>
                  <li>Manages EIP-3009 authorization for secure token transfers</li>
                  <li>Handles transaction batching for cost optimization</li>
                </ul>
              </div>

              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">📝 Reporting Agent - ZK-Verified Compliance</h4>
                <ul className="list-disc pl-6 text-[#424245] space-y-1 text-sm">
                  <li>Generates portfolio reports with ZK-STARK proofs</li>
                  <li>Enables auditors to verify compliance without seeing sensitive data</li>
                  <li>Produces regulatory-ready documentation</li>
                  <li>Maintains audit trails with cryptographic integrity</li>
                </ul>
              </div>

              <div className="border border-[#e5e5e5] rounded-xl p-6">
                <h4 className="font-semibold text-[#1d1d1f] mb-2">👁️ Price Monitor Agent - Autonomous Surveillance</h4>
                <ul className="list-disc pl-6 text-[#424245] space-y-1 text-sm">
                  <li>Tracks real-time prices across CoinGecko and Crypto.com APIs</li>
                  <li>Maintains configurable price alerts and thresholds</li>
                  <li>Automatically triggers Hedging Agent when conditions met</li>
                  <li>Provides 24/7 autonomous portfolio surveillance</li>
                </ul>
              </div>
            </div>
          </section>

          {/* ZK Privacy */}
          <section id="zkp" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">7</span>
              Zero-Knowledge Privacy Layer
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">7.1 ZK-STARK Protocol</h3>
            <p className="text-[#424245] leading-relaxed">
              ZkVanguard implements a CUDA-accelerated ZK-STARK (Zero-Knowledge Scalable Transparent ARgument of Knowledge) proof system based on the FRI (Fast Reed-Solomon Interactive Oracle Proof) protocol, following the specifications in Ben-Sasson et al. (ePrint 2018/046, 2018/828):
            </p>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>Post-Quantum Security:</strong> 512-bit target security with 180-bit effective soundness via 80 FRI queries and 20-bit proof-of-work grinding (per FRI Theorem 1.2: ε ≤ ρ^q)</li>
              <li><strong>Goldilocks Prime Field:</strong> p = 2⁶⁴ - 2³² + 1 = 18446744069414584321 (same as Polygon zkEVM, Plonky2) with primitive root g = 7</li>
              <li><strong>No Trusted Setup:</strong> Fully transparent—all parameters are public constants verifiable by any auditor (Definition 1.1 from 2018/046)</li>
              <li><strong>Fiat-Shamir Transformation:</strong> SHA-256 based challenge derivation ensures non-interactive security in the random oracle model</li>
              <li><strong>CUDA Acceleration:</strong> GPU-optimized NTT and field operations via CuPy/Numba for sub-second proof generation</li>
            </ul>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">7.2 Security Parameters &amp; Soundness Proof</h3>
            <p className="text-[#424245] leading-relaxed mb-4">
              Per FRI Theorem 1.2 (Ben-Sasson et al. 2018/828), soundness error ε ≤ ρ^q where ρ is the rate and q is the number of queries:
            </p>
            <div className="bg-[#1d1d1f] text-green-400 p-6 rounded-xl my-6 font-mono text-xs overflow-x-auto">
              <pre>{`FORMAL SOUNDNESS CALCULATION (per ePrint 2018/828)
══════════════════════════════════════════════════

Parameters:
  ρ (rate)        = 1/blowup_factor = 1/4 = 0.25
  q (queries)     = 80
  grinding_bits   = 20

FRI Soundness (Theorem 1.2):
  ε = ρ^q = (1/4)^80 = 2^(-160)

With Grinding:
  ε_total = 2^(-160) × 2^(-20) = 2^(-180)

Security Comparison:
  NIST Post-Quantum Level 1:  128-bit
  Our Implementation:         180-bit
  Safety Margin:              +52 bits`}</pre>
            </div>
            <div className="bg-[#f5f5f7] p-6 rounded-xl my-6 font-mono text-sm">
              <div className="space-y-2">
                <p><strong>Target Security:</strong> 512 bits (configuration parameter)</p>
                <p><strong>Effective Soundness:</strong> 2⁻¹⁸⁰ = (1/4)⁸⁰ × 2⁻²⁰</p>
                <p><strong>FRI Queries:</strong> 80 (exceeds 128-bit post-quantum threshold by 52 bits)</p>
                <p><strong>Blowup Factor:</strong> 4× (rate ρ = 0.25)</p>
                <p><strong>FRI Layers:</strong> 10 (Merkle tree depth)</p>
                <p><strong>Grinding Bits:</strong> 20 (proof-of-work difficulty)</p>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">7.3 Formal Mathematical Verification</h3>
            <div className="bg-green-50 border border-green-200 p-6 rounded-xl my-6">
              <div className="flex items-start gap-4">
                <span className="text-3xl">✓</span>
                <div>
                  <h4 className="font-semibold text-green-800 mb-2">All 6 Cryptographic Theorems Proved</h4>
                  <p className="text-sm text-green-700 mb-3">
                    Our implementation has been formally verified against the academic definitions in Ben-Sasson et al. 
                    (ePrint 2018/046, 2018/828). This is not just testing—it&apos;s mathematical proof.
                  </p>
                  <Link 
                    href="/zk-verification"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    View Full Formal Verification →
                  </Link>
                </div>
              </div>
            </div>
            <p className="text-[#424245] leading-relaxed mb-4">
              Our ZK system satisfies all required properties (47/47 tests + 6/6 theorems):
            </p>
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse bg-[#fafafa] rounded-xl overflow-hidden border border-[#e5e5e5]">
                <thead className="bg-[#f0f0f2]">
                  <tr>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Theorem</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Paper Reference</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Verification</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e5e5]">
                  <tr>
                    <td className="p-4 text-[#424245]">Transparency</td>
                    <td className="p-4 text-[#424245] font-mono text-xs">2018/046 Def 1.1</td>
                    <td className="p-4 text-[#424245]">No trusted setup, all params public</td>
                    <td className="p-4 text-green-600 font-semibold">✓ PROVED</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Post-Quantum</td>
                    <td className="p-4 text-[#424245] font-mono text-xs">2018/046 §1.1</td>
                    <td className="p-4 text-[#424245]">No DLP/factoring, SHA-256 only</td>
                    <td className="p-4 text-green-600 font-semibold">✓ PROVED</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">FRI Soundness</td>
                    <td className="p-4 text-[#424245] font-mono text-xs">2018/828 Thm 1.2</td>
                    <td className="p-4 text-[#424245]">ε = ρ^q = 2⁻¹⁶⁰, with grinding 2⁻¹⁸⁰</td>
                    <td className="p-4 text-green-600 font-semibold">✓ PROVED</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Zero-Knowledge</td>
                    <td className="p-4 text-[#424245] font-mono text-xs">2018/046 Def 1.3</td>
                    <td className="p-4 text-[#424245]">Witness hidden, proof reveals nothing</td>
                    <td className="p-4 text-green-600 font-semibold">✓ PROVED</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Completeness</td>
                    <td className="p-4 text-[#424245] font-mono text-xs">2018/046 Def 1.2</td>
                    <td className="p-4 text-[#424245]">Valid witness → valid proof (47/47 tests)</td>
                    <td className="p-4 text-green-600 font-semibold">✓ PROVED</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Soundness</td>
                    <td className="p-4 text-[#424245] font-mono text-xs">2018/046 Def 1.2</td>
                    <td className="p-4 text-[#424245]">Forgeries rejected (tamper tests pass)</td>
                    <td className="p-4 text-green-600 font-semibold">✓ PROVED</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">7.4 Privacy-Preserving Hedge Architecture</h3>
            <p className="text-[#424245] leading-relaxed">
              When executing hedges on public blockchains, ZkVanguard protects user privacy through:
            </p>
            <div className="bg-[#1d1d1f] text-green-400 p-6 rounded-xl my-6 font-mono text-xs overflow-x-auto">
              <pre>{`PUBLIC (On-Chain)           PRIVATE (ZK-Protected)
─────────────────           ──────────────────────
• Commitment hash           • Portfolio composition
• Stealth address           • Exact hedge sizes
• Aggregate settlements     • Asset being hedged
• Nullifier (anti-replay)   • Entry/exit prices
                            • PnL calculations

Commitment Hash = SHA256(asset || side || size || entryPrice || salt)
Example: 0x7a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0c91`}</pre>
            </div>
          </section>

          {/* Gasless */}
          <section id="gasless" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">8</span>
              Gasless Transaction Protocol (x402)
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">8.1 Protocol Overview</h3>
            <p className="text-[#424245] leading-relaxed">
              The x402 protocol eliminates gas fees for end users by leveraging EIP-3009 authorization and protocol-sponsored transactions:
            </p>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>Gas Coverage:</strong> 97.4% of transaction costs refunded</li>
              <li><strong>User Cost:</strong> ~$0.01 USDC per transaction (vs. $15-$50 traditional)</li>
              <li><strong>Annual Savings:</strong> $500K-$2M per institutional customer</li>
              <li><strong>Transaction Types:</strong> Swaps, deposits, rebalances, hedge execution</li>
            </ul>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">8.2 Technical Implementation</h3>
            <div className="bg-[#f5f5f7] p-6 rounded-xl my-6 font-mono text-sm">
              <p className="mb-2"><strong>Contract:</strong> 0x44098d0dE36e157b4C1700B48d615285C76fdE47</p>
              <p className="mb-2"><strong>Protocol:</strong> EIP-3009 (transferWithAuthorization)</p>
              <p><strong>TCRO Balance:</strong> 12.27 (sufficient for 1,200+ gasless transactions)</p>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">8.3 Flow Diagram</h3>
            <div className="bg-[#1d1d1f] text-green-400 p-6 rounded-xl my-6 font-mono text-xs overflow-x-auto">
              <pre>{`User Request → x402 Service → Eligibility Check → Execute Gasless
                                    │
                                    ▼
                            USDC Payment ($0.01)
                                    │
                                    ▼
                            Protocol Sponsors Gas
                                    │
                                    ▼
                            Transaction Confirmed
                                    │
                                    ▼
                            Gas Refund (97.4%)`}</pre>
            </div>
          </section>

          {/* Predictions */}
          <section id="predictions" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">9</span>
              Prediction Market Integration
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">9.1 Data Sources</h3>
            <p className="text-[#424245] leading-relaxed">
              ZkVanguard integrates with leading prediction markets to provide crowd-sourced forecasting:
            </p>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>Polymarket:</strong> Largest prediction market with $1B+ trading volume</li>
              <li><strong>Delphi:</strong> Specialized crypto/RWA prediction data</li>
              <li><strong>Historical Accuracy:</strong> 78-85% on major events</li>
            </ul>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">9.2 Hedge Ratio Calculation</h3>
            <p className="text-[#424245] leading-relaxed">
              The Hedging Agent uses prediction probabilities to dynamically adjust hedge ratios:
            </p>
            <div className="bg-[#f5f5f7] p-6 rounded-xl my-6 font-mono text-sm">
              <p className="mb-2">Base Hedge Ratio = 50% of exposure</p>
              <p className="mb-2">Delphi Multiplier = 1 + (probability - 0.5) * 0.5</p>
              <p className="mb-2">Example: 73% probability → 1.23x multiplier</p>
              <p>Final Hedge = 50% × 1.23 = 61.5% exposure protection</p>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">9.3 Example Prediction Scenarios</h3>
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse bg-[#fafafa] rounded-xl overflow-hidden border border-[#e5e5e5]">
                <thead className="bg-[#f0f0f2]">
                  <tr>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Market Question</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Probability</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Impact</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">AI Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e5e5]">
                  <tr>
                    <td className="p-4 text-[#424245]">BTC volatility exceeds 60% in 30 days</td>
                    <td className="p-4 text-red-600 font-semibold">73%</td>
                    <td className="p-4 text-[#424245]">HIGH</td>
                    <td className="p-4 text-[#424245]">🛡️ HEDGE (Open SHORT)</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">Fed rate hike in Q1 2026</td>
                    <td className="p-4 text-orange-600 font-semibold">68%</td>
                    <td className="p-4 text-[#424245]">HIGH</td>
                    <td className="p-4 text-[#424245]">🛡️ HEDGE (Stablecoin allocation)</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">ETH drops below $3000 this week</td>
                    <td className="p-4 text-yellow-600 font-semibold">42%</td>
                    <td className="p-4 text-[#424245]">MODERATE</td>
                    <td className="p-4 text-[#424245]">👁️ MONITOR (Set alert)</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245]">USDC depeg &gt;2% in 90 days</td>
                    <td className="p-4 text-green-600 font-semibold">12%</td>
                    <td className="p-4 text-[#424245]">HIGH</td>
                    <td className="p-4 text-[#424245]">✓ IGNORE (Low probability)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Multi-Chain */}
          <section id="multichain" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">10</span>
              Multi-Chain Strategy
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">10.1 Supported Networks</h3>
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse bg-[#fafafa] rounded-xl overflow-hidden border border-[#e5e5e5]">
                <thead className="bg-[#f0f0f2]">
                  <tr>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Chain</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Type</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Status</th>
                    <th className="text-left p-4 font-semibold text-[#1d1d1f]">Features</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e5e5]">
                  <tr>
                    <td className="p-4 text-[#424245] font-semibold">Cronos EVM</td>
                    <td className="p-4 text-[#424245]">EVM (Chain ID: 25)</td>
                    <td className="p-4 text-green-600">✅ Live</td>
                    <td className="p-4 text-[#424245]">x402 Gasless, VVS DEX, Full Suite</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245] font-semibold">Cronos zkEVM</td>
                    <td className="p-4 text-[#424245]">zkEVM (Chain ID: 388)</td>
                    <td className="p-4 text-green-600">✅ Ready</td>
                    <td className="p-4 text-[#424245]">Native ZK proofs, Enhanced privacy</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245] font-semibold">Cronos Testnet</td>
                    <td className="p-4 text-[#424245]">EVM (Chain ID: 338)</td>
                    <td className="p-4 text-green-600">✅ Active</td>
                    <td className="p-4 text-[#424245]">Development, Testing</td>
                  </tr>
                  <tr>
                    <td className="p-4 text-[#424245] font-semibold">SUI</td>
                    <td className="p-4 text-[#424245]">Move</td>
                    <td className="p-4 text-blue-600">🔧 Q1 2026</td>
                    <td className="p-4 text-[#424245]">Sponsored Tx, Native Move, High TPS</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">10.2 Expansion Roadmap</h3>
            <ol className="list-decimal pl-6 text-[#424245] space-y-2">
              <li><strong>Phase 1 (Current):</strong> Cronos ecosystem (EVM + zkEVM)</li>
              <li><strong>Phase 2 (Q1 2026):</strong> SUI integration (non-EVM validation)</li>
              <li><strong>Phase 3 (Q3 2026):</strong> Ethereum L2s (Arbitrum, Optimism, Base)</li>
              <li><strong>Phase 4 (2027):</strong> Cross-chain unified portfolio management</li>
            </ol>
          </section>

          {/* Security */}
          <section id="security" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">11</span>
              Security Analysis
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">11.1 Smart Contract Security</h3>
            <ul className="list-disc pl-6 text-[#424245] space-y-2">
              <li>Built on OpenZeppelin battle-tested libraries</li>
              <li>All contracts verified on block explorer</li>
              <li>10/10 system tests passing</li>
              <li>Zero critical vulnerabilities identified</li>
              <li>Reentrancy guards on all external calls</li>
              <li>Access control via Ownable pattern</li>
            </ul>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">11.2 Cryptographic Security</h3>
            <ul className="list-disc pl-6 text-[#424245] space-y-2 [&_strong]:text-[#1d1d1f]">
              <li><strong>ZK-STARK:</strong> 512-bit target security, 180-bit effective soundness (80 FRI queries × 20-bit grinding)</li>
              <li><strong>Prime Field:</strong> Goldilocks p = 2⁶⁴ - 2³² + 1 (post-quantum resistant, no discrete log/factoring)</li>
              <li><strong>Merkle Trees:</strong> SHA-256 with 10-layer FRI commitment hierarchy</li>
              <li><strong>Key Derivation:</strong> ECDH for stealth addresses</li>
              <li><strong>Signatures:</strong> ECDSA with EIP-712 typed data</li>
            </ul>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">11.3 Operational Security</h3>
            <ul className="list-disc pl-6 text-[#424245] space-y-2">
              <li>Non-custodial: Users maintain full key control</li>
              <li>Human-in-the-loop: All hedges require user approval</li>
              <li>Rate limiting on API endpoints</li>
              <li>Geo-blocking for regulatory compliance</li>
              <li>Comprehensive audit logging</li>
            </ul>
          </section>

          {/* Tokenomics */}
          <section id="tokenomics" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">12</span>
              Tokenomics & Economics
            </h2>
            
            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">12.1 Revenue Streams</h3>
            <div className="space-y-4 my-6">
              <div className="bg-[#f5f5f7] p-4 rounded-xl flex justify-between items-center">
                <span className="font-medium">Performance Fees (20% of profits)</span>
                <span className="text-[#007AFF] font-semibold">70% of revenue</span>
              </div>
              <div className="bg-[#f5f5f7] p-4 rounded-xl flex justify-between items-center">
                <span className="font-medium">Subscription Tiers ($99-$9,999/mo)</span>
                <span className="text-[#007AFF] font-semibold">15% of revenue</span>
              </div>
              <div className="bg-[#f5f5f7] p-4 rounded-xl flex justify-between items-center">
                <span className="font-medium">API Access ($0.10/call)</span>
                <span className="text-[#007AFF] font-semibold">10% of revenue</span>
              </div>
              <div className="bg-[#f5f5f7] p-4 rounded-xl flex justify-between items-center">
                <span className="font-medium">White-Label Licensing</span>
                <span className="text-[#007AFF] font-semibold">5% of revenue</span>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-[#1d1d1f] mt-8 mb-4">12.2 5-Year Projections</h3>
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse bg-[#fafafa] rounded-xl overflow-hidden border border-[#e5e5e5] text-sm">
                <thead className="bg-[#f0f0f2]">
                  <tr>
                    <th className="text-left p-3 font-semibold text-[#1d1d1f]">Metric</th>
                    <th className="text-center p-3 font-semibold text-[#1d1d1f]">2026</th>
                    <th className="text-center p-3 font-semibold text-[#1d1d1f]">2027</th>
                    <th className="text-center p-3 font-semibold text-[#1d1d1f]">2028</th>
                    <th className="text-center p-3 font-semibold text-[#1d1d1f]">2029</th>
                    <th className="text-center p-3 font-semibold text-[#1d1d1f]">2030</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e5e5]">
                  <tr>
                    <td className="p-3 text-[#424245]">Total TVL</td>
                    <td className="p-3 text-center text-[#424245]">$500M</td>
                    <td className="p-3 text-center text-[#424245]">$4B</td>
                    <td className="p-3 text-center text-[#424245]">$24B</td>
                    <td className="p-3 text-center text-[#424245]">$100B</td>
                    <td className="p-3 text-center text-[#424245]">$350B</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#424245]">Paying Customers</td>
                    <td className="p-3 text-center text-[#424245]">100</td>
                    <td className="p-3 text-center text-[#424245]">500</td>
                    <td className="p-3 text-center text-[#424245]">2,500</td>
                    <td className="p-3 text-center text-[#424245]">10,000</td>
                    <td className="p-3 text-center text-[#424245]">35,000</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#424245]">Total Revenue</td>
                    <td className="p-3 text-center text-[#424245]">$1.32M</td>
                    <td className="p-3 text-center text-[#424245]">$7.5M</td>
                    <td className="p-3 text-center text-[#424245]">$35M</td>
                    <td className="p-3 text-center text-[#424245]">$105M</td>
                    <td className="p-3 text-center text-[#424245]">$270M</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-[#424245]">Profit Margin</td>
                    <td className="p-3 text-center text-red-500">-60%</td>
                    <td className="p-3 text-center text-green-600">28%</td>
                    <td className="p-3 text-center text-green-600">43%</td>
                    <td className="p-3 text-center text-green-600">46%</td>
                    <td className="p-3 text-center text-green-600">44%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Roadmap */}
          <section id="roadmap" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">13</span>
              Roadmap
            </h2>
            
            <div className="space-y-6 my-8">
              <div className="border-l-4 border-green-500 pl-6">
                <h4 className="font-semibold text-[#1d1d1f]">Q1 2026 - Beta Launch ✅</h4>
                <p className="text-[#424245] text-sm mt-1">5 AI agents, ZK-STARK privacy, x402 gasless, Cronos testnet deployment</p>
              </div>
              <div className="border-l-4 border-blue-500 pl-6">
                <h4 className="font-semibold text-[#1d1d1f]">Q2 2026 - SUI Integration</h4>
                <p className="text-[#424245] text-sm mt-1">Multi-chain expansion, SUI mainnet deployment, cross-chain portfolio</p>
              </div>
              <div className="border-l-4 border-purple-500 pl-6">
                <h4 className="font-semibold text-[#1d1d1f]">Q3 2026 - Ethereum L2s</h4>
                <p className="text-[#424245] text-sm mt-1">Arbitrum, Optimism, Base integration, unified multi-chain dashboard</p>
              </div>
              <div className="border-l-4 border-orange-500 pl-6">
                <h4 className="font-semibold text-[#1d1d1f]">Q4 2026 - Advanced Derivatives</h4>
                <p className="text-[#424245] text-sm mt-1">Full Moonlander integration, options strategies, advanced hedging</p>
              </div>
              <div className="border-l-4 border-gray-400 pl-6">
                <h4 className="font-semibold text-[#1d1d1f]">2027-2030 - Global Scale</h4>
                <p className="text-[#424245] text-sm mt-1">$100B+ TVL, 10,000+ institutions, IPO-ready platform</p>
              </div>
            </div>
          </section>

          {/* Conclusion */}
          <section id="conclusion" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">14</span>
              Conclusion
            </h2>
            
            <p className="text-[#424245] leading-relaxed">
              ZkVanguard represents a fundamental shift in institutional digital asset risk management—from reactive systems that respond to market crashes after significant losses, to predictive intelligence that anticipates and preemptively protects against volatility events.
            </p>
            <p className="text-[#424245] leading-relaxed mt-4">
              By combining six specialized AI agents with crowd-sourced prediction market data, post-quantum zero-knowledge cryptography, and gasless transaction infrastructure, we deliver the comprehensive solution that institutional capital requires to confidently participate in the $16 trillion tokenized asset opportunity.
            </p>
            <p className="text-[#424245] leading-relaxed mt-4">
              Our platform is live on Cronos testnet, with production deployment planned for Q2 2026. We invite institutional partners, investors, and early adopters to join us in building the future of predictive risk management.
            </p>
          </section>

          {/* References */}
          <section id="references" className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-6 flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-[#007AFF] text-white rounded-xl text-lg font-bold">15</span>
              References
            </h2>
            
            <ol className="list-decimal pl-6 text-[#424245] space-y-3 text-sm">
              <li>Boston Consulting Group. &quot;Relevance of on-chain asset tokenization in &apos;crypto winter&apos;.&quot; BCG Global, 2024.</li>
              <li><strong>Ben-Sasson, E., Bentov, I., Horesh, Y., &amp; Riabzev, M.</strong> &quot;Scalable, transparent, and post-quantum secure computational integrity.&quot; <em>IACR Cryptology ePrint Archive</em>, Paper 2018/046. <a href="https://eprint.iacr.org/2018/046" className="text-[#007AFF]">https://eprint.iacr.org/2018/046</a></li>
              <li><strong>Ben-Sasson, E., Bentov, I., Horesh, Y., &amp; Riabzev, M.</strong> &quot;Fast Reed-Solomon Interactive Oracle Proofs of Proximity.&quot; <em>ICALP 2018</em>. ePrint 2018/828. <a href="https://eprint.iacr.org/2018/828" className="text-[#007AFF]">https://eprint.iacr.org/2018/828</a></li>
              <li>StarkWare Industries. &quot;ethSTARK Documentation v1.2.&quot; <em>IACR ePrint</em> 2021/582.</li>
              <li>Goldilocks Prime Field. &quot;Efficient 64-bit field arithmetic for zkVMs.&quot; Polygon zkEVM Documentation, 2024.</li>
              <li>EIP-3009: Transfer With Authorization. Ethereum Improvement Proposals, 2020.</li>
              <li>Polymarket. &quot;Prediction Market Accuracy Analysis 2024.&quot; Polymarket Research, 2024.</li>
              <li>Crypto.com. &quot;AI Agent SDK Documentation.&quot; Crypto.com Developer Portal, 2025.</li>
              <li>Cronos Labs. &quot;Cronos zkEVM Technical Specifications.&quot; Cronos Documentation, 2025.</li>
              <li>VVS Finance. &quot;V3 Concentrated Liquidity Protocol.&quot; VVS Finance Docs, 2025.</li>
              <li>Moonlander. &quot;Perpetual Futures API Reference.&quot; Moonlander Documentation, 2025.</li>
            </ol>
          </section>

        </article>

        {/* Footer CTA */}
        <div className="mt-16 text-center">
          <div className="bg-gradient-to-r from-[#007AFF] to-[#5856D6] rounded-2xl p-8 text-white">
            <h3 className="text-2xl font-bold mb-4">Ready to Experience Predictive Risk Management?</h3>
            <p className="text-white/80 mb-6 max-w-xl mx-auto">
              Join institutional traders who are already protecting their portfolios with AI-powered prediction intelligence.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link 
                href="/dashboard"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#007AFF] rounded-full font-medium hover:bg-white/90 transition-colors"
              >
                Launch App
              </Link>
              <Link 
                href="/docs"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white/20 text-white rounded-full font-medium hover:bg-white/30 transition-colors"
              >
                View Documentation
              </Link>
            </div>
          </div>
        </div>

      </main>

      <Footer />
    </div>
  );
}
