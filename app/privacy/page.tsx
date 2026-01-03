export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
        <h1 className="text-4xl font-bold mb-8 text-gray-900 dark:text-white">Privacy Policy</h1>
        
        <div className="space-y-6 text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">1. Introduction</h2>
            <p>
              ZkVanguard is committed to protecting your privacy. This policy explains how we handle your data
              when you use our decentralized portfolio management platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">2. Data We Collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Wallet Address:</strong> Your public blockchain address when you connect your wallet</li>
              <li><strong>Transaction Data:</strong> On-chain transaction history for portfolio analysis</li>
              <li><strong>Usage Analytics:</strong> Anonymized usage patterns to improve the platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">3. Zero-Knowledge Privacy</h2>
            <p>
              ZkVanguard uses ZK-STARK technology to ensure:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Your portfolio positions remain private</li>
              <li>Transaction amounts are never revealed publicly</li>
              <li>AI agent recommendations are computed without exposing your holdings</li>
              <li>All proofs are verified on-chain without revealing sensitive data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">4. Data Storage</h2>
            <p>
              All financial data is stored on-chain. We do not maintain centralized databases of your
              portfolio information. Your private keys remain in your custody at all times.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">5. Third-Party Services</h2>
            <p>We integrate with:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li><strong>WalletConnect:</strong> For secure wallet connections</li>
              <li><strong>Cronos Network:</strong> For blockchain interactions</li>
              <li><strong>Crypto.com AI SDK:</strong> For portfolio analysis (optional)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">6. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Disconnect your wallet at any time</li>
              <li>Export your on-chain data</li>
              <li>Request deletion of any off-chain analytics data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">7. Contact</h2>
            <p>
              For privacy concerns, contact us at:{' '}
              <a href="mailto:privacy@zkvanguard.io" className="text-blue-600 dark:text-blue-400 hover:underline">
                privacy@zkvanguard.io
              </a>
            </p>
          </section>

          <p className="text-sm text-gray-500 dark:text-gray-400 mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
            Last Updated: January 2, 2026
          </p>
        </div>
      </div>
    </div>
  );
}
