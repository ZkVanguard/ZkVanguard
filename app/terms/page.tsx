export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
        <h1 className="text-4xl font-bold mb-8 text-gray-900 dark:text-white">Terms of Service</h1>
        
        <div className="space-y-6 text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">1. Acceptance of Terms</h2>
            <p>
              By accessing and using ZkVanguard, you agree to be bound by these Terms of Service. If you do not
              agree to these terms, please do not use our platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">2. Description of Service</h2>
            <p>
              ZkVanguard is a decentralized portfolio management platform that uses AI agents and zero-knowledge
              proofs to provide privacy-preserving financial services on the Cronos blockchain.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">3. Risk Disclosure</h2>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 my-4">
              <p className="font-semibold text-yellow-900 dark:text-yellow-200 mb-2">⚠️ Important Risks</p>
              <ul className="list-disc pl-6 space-y-2 text-yellow-800 dark:text-yellow-300">
                <li>Cryptocurrency investments carry high risk and volatility</li>
                <li>You may lose part or all of your invested capital</li>
                <li>AI recommendations are not financial advice</li>
                <li>Smart contracts may contain bugs or vulnerabilities</li>
                <li>Past performance does not guarantee future results</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">4. User Responsibilities</h2>
            <p>You are responsible for:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Securing your private keys and wallet credentials</li>
              <li>Conducting your own research before making investment decisions</li>
              <li>Complying with local laws and regulations</li>
              <li>Paying all applicable gas fees and transaction costs</li>
              <li>Understanding the risks of decentralized finance (DeFi)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">5. AI Agent Disclaimers</h2>
            <p>
              Our AI agents provide automated analysis and suggestions, but:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>They do not constitute financial, investment, or legal advice</li>
              <li>You should consult qualified professionals for personalized advice</li>
              <li>AI predictions may be inaccurate or incomplete</li>
              <li>We do not guarantee any specific investment outcomes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">6. Smart Contract Risks</h2>
            <p>
              ZkVanguard operates through smart contracts on the Cronos blockchain. While our contracts have been
              tested, users acknowledge that:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Smart contracts are experimental technology</li>
              <li>Bugs or vulnerabilities may exist despite our best efforts</li>
              <li>Blockchain transactions are irreversible</li>
              <li>We are not liable for losses due to smart contract failures</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">7. Intellectual Property</h2>
            <p>
              ZkVanguard is open-source software licensed under Apache 2.0. You may use, modify, and distribute
              the code subject to the license terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, ZkVanguard and its contributors shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages, including loss of profits, data,
              or other intangible losses resulting from your use of the platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">9. No Warranties</h2>
            <p>
              The platform is provided "AS IS" without warranties of any kind, either express or implied,
              including but not limited to warranties of merchantability, fitness for a particular purpose, or
              non-infringement.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">10. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws. Any disputes
              shall be resolved through binding arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">11. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the platform after changes
              constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">12. Contact Information</h2>
            <p>
              For questions about these Terms, contact:{' '}
              <a href="mailto:legal@zkvanguard.io" className="text-blue-600 dark:text-blue-400 hover:underline">
                legal@zkvanguard.io
              </a>
            </p>
          </section>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-8">
            <p className="text-sm text-blue-900 dark:text-blue-200">
              <strong>By connecting your wallet and using ZkVanguard, you acknowledge that you have read,
              understood, and agree to be bound by these Terms of Service.</strong>
            </p>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
            Last Updated: January 2, 2026
          </p>
        </div>
      </div>
    </div>
  );
}
