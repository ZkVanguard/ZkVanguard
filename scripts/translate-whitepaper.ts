/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Whitepaper Translation Script using ASI/Ollama
 * Translates hardcoded whitepaper content to all supported languages
 */

import * as fs from 'fs';
import * as path from 'path';

// Supported locales
const LOCALES = ['zh', 'fr', 'es', 'de', 'ja', 'ko', 'it', 'ru', 'pt', 'ar', 'hi'];

// Language names for prompts
const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  it: 'Italian',
  ru: 'Russian',
  pt: 'Portuguese (Brazilian)',
  ar: 'Arabic',
  hi: 'Hindi',
};

// Ollama configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

// ASI configuration
const ASI_API_URL = 'https://api.asi1.ai/v1';
const ASI_API_KEY = process.env.ASI_API_KEY || process.env.ASI_ONE_API_KEY;
const ASI_MODEL = process.env.ASI_MODEL || 'asi1-mini';

interface TranslationResult {
  locale: string;
  translations: Record<string, string>;
  success: boolean;
  error?: string;
}

// Check if Ollama is running
async function checkOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.models && data.models.length > 0) {
        console.log('✅ Ollama available with models:', data.models.map((m: any) => m.name).join(', '));
        return true;
      }
    }
  } catch (e) {
    console.log('⚠️ Ollama not available');
  }
  return false;
}

// Check if ASI is available
async function checkASI(): Promise<boolean> {
  if (!ASI_API_KEY) {
    console.log('⚠️ ASI API key not configured');
    return false;
  }
  try {
    const response = await fetch(`${ASI_API_URL}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ASI_API_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      console.log('✅ ASI API available');
      return true;
    }
  } catch (e) {
    console.log('⚠️ ASI API not available');
  }
  return false;
}

// Translate using Ollama
async function translateWithOllama(text: string, targetLang: string): Promise<string> {
  const prompt = `Translate the following English text to ${LANGUAGE_NAMES[targetLang]}. 
Keep technical terms like "ZkVanguard", "ZK-STARK", "Cronos", "Moonlander", "x402", "EIP-3009", cryptocurrency names (BTC, ETH, USDC), and blockchain terminology accurate.
Maintain the same tone and style - professional and technical.
Return ONLY the translated text, nothing else.

Text to translate:
${text}`;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2048,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.response.trim();
}

// Translate using ASI API
async function translateWithASI(text: string, targetLang: string): Promise<string> {
  const prompt = `Translate the following English text to ${LANGUAGE_NAMES[targetLang]}. 
Keep technical terms like "ZkVanguard", "ZK-STARK", "Cronos", "Moonlander", "x402", "EIP-3009", cryptocurrency names (BTC, ETH, USDC), and blockchain terminology accurate.
Maintain the same tone and style - professional and technical.
Return ONLY the translated text, nothing else.

Text to translate:
${text}`;

  const response = await fetch(`${ASI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ASI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ASI_MODEL,
      messages: [
        { role: 'system', content: 'You are a professional translator specializing in blockchain and financial technology documentation.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    throw new Error(`ASI request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// Main translation function
async function translate(text: string, targetLang: string, useASI: boolean): Promise<string> {
  if (useASI) {
    return translateWithASI(text, targetLang);
  }
  return translateWithOllama(text, targetLang);
}

// Whitepaper sections to translate (English source)
const WHITEPAPER_SECTIONS = {
  // Problem Section 3.3
  'problem.privacy': 'Privacy Exposure',
  'problem.privacyText': 'Public blockchain transparency creates significant competitive disadvantages for institutional traders:',
  'problem.frontRunning': 'Front-Running:',
  'problem.frontRunningText': 'MEV bots extract $500M+ annually by detecting and front-running large orders',
  'problem.strategyLeakage': 'Strategy Leakage:',
  'problem.strategyLeakageText': 'Competitors can reverse-engineer trading strategies from on-chain activity',
  'problem.regulatoryRisk': 'Regulatory Risk:',
  'problem.regulatoryRiskText': 'Public portfolio exposure may violate confidentiality requirements',
  'problem.marketImpact': 'Market Impact:',
  'problem.marketImpactText': 'Visible large positions attract predatory trading',

  // Solution Section
  'solution.title': 'Our Solution: Predictive Intelligence',
  'solution.paradigm': 'The Predictive Paradigm',
  'solution.paradigmText': 'ZkVanguard introduces a fundamentally different approach: predictive risk management powered by crowd-sourced intelligence. Instead of reacting to crashes, we anticipate them:',
  'solution.coreStack': 'Core Innovation Stack',
  'solution.multiAgent': 'Multi-Agent AI System',
  'solution.multiAgentDesc': 'Six specialized agents coordinate autonomously to analyze, recommend, execute, and report on portfolio protection strategies.',
  'solution.prediction': 'Prediction Intelligence',
  'solution.predictionDesc': 'Real-time integration with Delphi/Polymarket prediction markets for crowd-sourced forecasting with 78%+ accuracy.',
  'solution.zkStark': 'ZK-STARK Privacy',
  'solution.zkStarkDesc': 'CUDA-accelerated post-quantum zero-knowledge proofs (512-bit security, 180-bit soundness) protect all portfolio and trading data from public exposure.',
  'solution.gasless': 'Gasless Execution',
  'solution.gaslessDesc': 'x402 protocol provides 97.4% gas coverage, reducing transaction costs from $15-50 to effectively $0.00.',
  'solution.uxFlow': 'User Experience Flow',
  'solution.ux1': 'Connect Portfolio (5 sec): Link wallet or RWA positions—AI automatically discovers all assets',
  'solution.ux2': 'AI Risk Analysis (10 sec): Risk Agent calculates VaR, Sharpe ratio, and checks prediction markets',
  'solution.ux3': 'Review Prediction (10 sec): User sees "🔮 Delphi Alert: 73% probability BTC volatility spike"',
  'solution.ux4': 'User Decision (5 sec): Approve hedge, add to watchlist, or dismiss',
  'solution.ux5': 'Auto-Execution (instant): Hedging Agent opens position on Moonlander perpetuals',
  'solution.ux6': 'Gasless Settlement (instant): x402 processes transaction with $0.00 fees',
  'solution.ux7': 'ZK Verification (2-5 sec): Privacy-preserved proof published on-chain',

  // Architecture Section
  'architecture.title': 'Technical Architecture',
  'architecture.overview': 'System Overview',
  'architecture.overviewText': 'ZkVanguard employs a layered architecture designed for security, scalability, and autonomous operation:',
  'architecture.techStack': 'Technology Stack',
  'architecture.tableLayer': 'Layer',
  'architecture.tableTechnology': 'Technology',
  'architecture.tablePurpose': 'Purpose',
  'architecture.contracts': 'Deployed Smart Contracts',
  'architecture.contractsText': 'All smart contracts are deployed on Cronos Testnet (Chain ID: 338) and verified:',

  // Agents Section
  'agents.title': 'Multi-Agent AI System',
  'agents.intro': 'ZkVanguard deploys six specialized AI agents that operate autonomously while maintaining human-in-the-loop control for critical decisions:',
  'agents.lead': 'Lead Agent - Strategy Orchestrator',
  'agents.risk': 'Risk Agent - Real-Time Monitoring',
  'agents.hedging': 'Hedging Agent - Predictive Execution',
  'agents.settlement': 'Settlement Agent - Gasless Transactions',
  'agents.reporting': 'Reporting Agent - ZK-Verified Compliance',
  'agents.priceMonitor': 'Price Monitor Agent - Autonomous Surveillance',

  // ZK Privacy Section
  'zkp.title': 'Zero-Knowledge Privacy Layer',
  'zkp.protocol': 'ZK-STARK Protocol',
  'zkp.protocolText': 'ZkVanguard implements a CUDA-accelerated ZK-STARK (Zero-Knowledge Scalable Transparent ARgument of Knowledge) proof system based on the FRI (Fast Reed-Solomon Interactive Oracle Proof) protocol:',
  'zkp.security': 'Security Parameters & Soundness Proof',
  'zkp.verification': 'Formal Mathematical Verification',
  'zkp.verificationTitle': 'All 6 Cryptographic Theorems Proved',
  'zkp.verificationText': 'Our implementation has been formally verified against the academic definitions in Ben-Sasson et al. This is not just testing—it\'s mathematical proof.',
  'zkp.hedgeArch': 'Privacy-Preserving Hedge Architecture',
  'zkp.hedgeArchText': 'When executing hedges on public blockchains, ZkVanguard protects user privacy through:',

  // Gasless Section
  'gasless.title': 'Gasless Transaction Protocol (x402)',
  'gasless.overview': 'Protocol Overview',
  'gasless.overviewText': 'The x402 protocol eliminates gas fees for end users by leveraging EIP-3009 authorization and protocol-sponsored transactions:',
  'gasless.implementation': 'Technical Implementation',
  'gasless.flowDiagram': 'Flow Diagram',

  // Predictions Section
  'predictions.title': 'Prediction Market Integration',
  'predictions.sources': 'Data Sources',
  'predictions.sourcesText': 'ZkVanguard integrates with leading prediction markets to provide crowd-sourced forecasting:',
  'predictions.hedgeRatio': 'Hedge Ratio Calculation',
  'predictions.hedgeRatioText': 'The Hedging Agent uses prediction probabilities to dynamically adjust hedge ratios:',
  'predictions.scenarios': 'Example Prediction Scenarios',
  'predictions.tableQuestion': 'Market Question',
  'predictions.tableProbability': 'Probability',
  'predictions.tableImpact': 'Impact',
  'predictions.tableAction': 'AI Action',

  // Multi-Chain Section
  'multichain.title': 'Multi-Chain Strategy',
  'multichain.networks': 'Supported Networks',
  'multichain.tableChain': 'Chain',
  'multichain.tableType': 'Type',
  'multichain.tableStatus': 'Status',
  'multichain.tableFeatures': 'Features',
  'multichain.roadmap': 'Expansion Roadmap',

  // Security Section
  'security.title': 'Security Analysis',
  'security.contracts': 'Smart Contract Security',
  'security.cryptographic': 'Cryptographic Security',
  'security.operational': 'Operational Security',

  // Tokenomics Section
  'tokenomics.title': 'Tokenomics & Economics',
  'tokenomics.revenue': 'Revenue Streams',
  'tokenomics.projections': '5-Year Projections',
  'tokenomics.tableMetric': 'Metric',

  // Roadmap Section
  'roadmap.title': 'Roadmap',
  'roadmap.q1_2026': 'Q1 2026 - Beta Launch ✅',
  'roadmap.q1_2026_desc': '5 AI agents, ZK-STARK privacy, x402 gasless, Cronos testnet deployment',
  'roadmap.q2_2026': 'Q2 2026 - SUI Integration',
  'roadmap.q2_2026_desc': 'Multi-chain expansion, SUI mainnet deployment, cross-chain portfolio',
  'roadmap.q3_2026': 'Q3 2026 - Ethereum L2s',
  'roadmap.q3_2026_desc': 'Arbitrum, Optimism, Base integration, unified multi-chain dashboard',
  'roadmap.q4_2026': 'Q4 2026 - Advanced Derivatives',
  'roadmap.q4_2026_desc': 'Full Moonlander integration, options strategies, advanced hedging',
  'roadmap.2027_2030': '2027-2030 - Global Scale',
  'roadmap.2027_2030_desc': '$100B+ TVL, 10,000+ institutions, IPO-ready platform',

  // References Section
  'references.title': 'References',

  // Footer CTA
  'footerCta.title': 'Ready to Experience Predictive Risk Management?',
  'footerCta.subtitle': 'Join institutional traders who are already protecting their portfolios with AI-powered prediction intelligence.',
  'footerCta.launchApp': 'Launch App',
  'footerCta.viewDocs': 'View Documentation',
};

async function translateWhitepaperSection(locale: string, useASI: boolean): Promise<TranslationResult> {
  console.log(`\n🌍 Translating to ${LANGUAGE_NAMES[locale]}...`);
  
  const translations: Record<string, string> = {};
  const entries = Object.entries(WHITEPAPER_SECTIONS);
  let completed = 0;
  
  for (const [key, englishText] of entries) {
    try {
      const translated = await translate(englishText, locale, useASI);
      translations[key] = translated;
      completed++;
      process.stdout.write(`\r   Progress: ${completed}/${entries.length} (${Math.round(completed/entries.length*100)}%)`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error: any) {
      console.error(`\n   ⚠️ Failed to translate "${key}": ${error.message}`);
      translations[key] = englishText; // Fallback to English
    }
  }
  
  console.log(`\n   ✅ ${LANGUAGE_NAMES[locale]} complete!`);
  
  return {
    locale,
    translations,
    success: true,
  };
}

async function updateMessagesFile(locale: string, newTranslations: Record<string, string>) {
  const messagesPath = path.join(process.cwd(), 'messages', `${locale}.json`);
  
  // Read existing messages
  const existingContent = fs.readFileSync(messagesPath, 'utf-8');
  const messages = JSON.parse(existingContent);
  
  // Update whitepaper section with new translations
  if (!messages.whitepaper) {
    messages.whitepaper = {};
  }
  
  // Merge new translations into existing whitepaper namespace
  for (const [key, value] of Object.entries(newTranslations)) {
    // Handle nested keys like 'problem.privacy'
    const parts = key.split('.');
    if (parts.length === 2) {
      if (!messages.whitepaper[parts[0]]) {
        messages.whitepaper[parts[0]] = {};
      }
      if (typeof messages.whitepaper[parts[0]] === 'object') {
        messages.whitepaper[parts[0]][parts[1]] = value;
      } else {
        // It's a flat key, just add it
        messages.whitepaper[key] = value;
      }
    } else {
      messages.whitepaper[key] = value;
    }
  }
  
  // Write back
  fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2) + '\n', 'utf-8');
  console.log(`   📝 Updated ${messagesPath}`);
}

async function main() {
  console.log('🚀 ZkVanguard Whitepaper Translation Script');
  console.log('==========================================\n');
  
  // Check available providers
  const ollamaAvailable = await checkOllama();
  const asiAvailable = await checkASI();
  
  if (!ollamaAvailable && !asiAvailable) {
    console.error('\n❌ No AI provider available!');
    console.error('   Please start Ollama (ollama serve) or configure ASI_API_KEY');
    process.exit(1);
  }
  
  const useASI = !ollamaAvailable && asiAvailable;
  const providerName = useASI ? `ASI (${ASI_MODEL})` : `Ollama (${OLLAMA_MODEL})`;
  console.log(`\n📡 Using ${providerName} for translations\n`);
  
  // Get target locales from args or use all
  const targetLocales = process.argv.slice(2).length > 0 
    ? process.argv.slice(2).filter(l => LOCALES.includes(l))
    : LOCALES;
  
  if (targetLocales.length === 0) {
    console.log('Usage: npx ts-node scripts/translate-whitepaper.ts [locale1] [locale2] ...');
    console.log('Available locales:', LOCALES.join(', '));
    console.log('Running with all locales...');
  }
  
  console.log(`🌐 Target languages: ${targetLocales.map(l => LANGUAGE_NAMES[l]).join(', ')}`);
  
  // Translate each locale
  for (const locale of targetLocales) {
    try {
      const result = await translateWhitepaperSection(locale, useASI);
      if (result.success) {
        await updateMessagesFile(locale, result.translations);
      }
    } catch (error: any) {
      console.error(`\n❌ Failed to translate ${LANGUAGE_NAMES[locale]}: ${error.message}`);
    }
  }
  
  console.log('\n✅ Translation complete!');
  console.log('   Run "npm run build" to verify translations');
}

main().catch(console.error);
