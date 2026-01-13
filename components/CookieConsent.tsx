'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const CONSENT_KEY = 'zkvanguard_cookie_consent';

interface ConsentSettings {
  necessary: boolean;    // Always true, required for operation
  analytics: boolean;    // Platform improvement analytics
  preferences: boolean;  // User preferences storage
  timestamp: string;
}

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [settings, setSettings] = useState<ConsentSettings>({
    necessary: true,
    analytics: false,
    preferences: false,
    timestamp: '',
  });

  useEffect(() => {
    // Check if consent already given
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) {
      // Small delay to prevent flash on page load
      setTimeout(() => setShowBanner(true), 1000);
    } else {
      try {
        const parsed = JSON.parse(stored);
        setSettings(parsed);
      } catch {
        setShowBanner(true);
      }
    }
  }, []);

  const saveConsent = (consent: ConsentSettings) => {
    const withTimestamp = { ...consent, timestamp: new Date().toISOString() };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(withTimestamp));
    setSettings(withTimestamp);
    setShowBanner(false);
    
    // Dispatch event for analytics service to pick up
    window.dispatchEvent(new CustomEvent('cookie-consent-updated', { detail: withTimestamp }));
  };

  const acceptAll = () => {
    saveConsent({
      necessary: true,
      analytics: true,
      preferences: true,
      timestamp: '',
    });
  };

  const acceptNecessary = () => {
    saveConsent({
      necessary: true,
      analytics: false,
      preferences: false,
      timestamp: '',
    });
  };

  const saveCustom = () => {
    saveConsent(settings);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] p-4 bg-white/95 backdrop-blur-xl border-t border-black/10 shadow-2xl animate-slide-up">
      <div className="max-w-6xl mx-auto">
        {!showDetails ? (
          // Simple Banner
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-[#1d1d1f] text-lg mb-1">🍪 Cookie Preferences</h3>
              <p className="text-[#86868b] text-sm">
                We use cookies to improve your experience and analyze platform usage. 
                Your wallet address is public blockchain data - we don't collect personal information.{' '}
                <Link href="/privacy" className="text-[#007AFF] hover:underline">Privacy Policy</Link>
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => setShowDetails(true)}
                className="px-4 py-2 text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors"
              >
                Customize
              </button>
              <button
                onClick={acceptNecessary}
                className="px-4 py-2 text-sm font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-lg transition-colors"
              >
                Necessary Only
              </button>
              <button
                onClick={acceptAll}
                className="px-5 py-2 text-sm font-medium text-white bg-[#007AFF] hover:bg-[#0056b3] rounded-lg transition-colors"
              >
                Accept All
              </button>
            </div>
          </div>
        ) : (
          // Detailed Settings
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1d1d1f] text-lg">Cookie Settings</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-[#86868b] hover:text-[#1d1d1f]"
              >
                ✕
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {/* Necessary Cookies */}
              <div className="p-4 bg-[#f5f5f7] rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-[#1d1d1f]">Necessary</span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Always On</span>
                </div>
                <p className="text-xs text-[#86868b]">
                  Required for wallet connection, session management, and core platform functionality.
                </p>
              </div>

              {/* Analytics Cookies */}
              <div className="p-4 bg-[#f5f5f7] rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-[#1d1d1f]">Analytics</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.analytics}
                      onChange={(e) => setSettings({ ...settings, analytics: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#007AFF] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>
                <p className="text-xs text-[#86868b]">
                  Anonymous usage data to improve platform features. No PII collected.
                </p>
              </div>

              {/* Preferences Cookies */}
              <div className="p-4 bg-[#f5f5f7] rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-[#1d1d1f]">Preferences</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.preferences}
                      onChange={(e) => setSettings({ ...settings, preferences: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#007AFF] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>
                <p className="text-xs text-[#86868b]">
                  Remember your settings like theme, dashboard layout, and notification preferences.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={acceptNecessary}
                className="px-4 py-2 text-sm font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-lg transition-colors"
              >
                Reject Optional
              </button>
              <button
                onClick={saveCustom}
                className="px-5 py-2 text-sm font-medium text-white bg-[#007AFF] hover:bg-[#0056b3] rounded-lg transition-colors"
              >
                Save Preferences
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

// Hook to check consent status
export function useConsent() {
  const [consent, setConsent] = useState<ConsentSettings | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored) {
      try {
        setConsent(JSON.parse(stored));
      } catch {
        setConsent(null);
      }
    }

    const handleUpdate = (e: CustomEvent<ConsentSettings>) => {
      setConsent(e.detail);
    };

    window.addEventListener('cookie-consent-updated', handleUpdate as EventListener);
    return () => window.removeEventListener('cookie-consent-updated', handleUpdate as EventListener);
  }, []);

  return consent;
}

export default CookieConsent;
