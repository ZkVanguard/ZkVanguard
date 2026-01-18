'use client';

import { useState, useEffect } from 'react';
import { X, Settings, Shield, Bell, Eye, Wallet, Zap, Moon, Sun } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserSettings {
  // Auto-Approval Settings
  autoApprovalEnabled: boolean;
  autoApprovalThreshold: number;
  
  // Notification Settings
  priceAlerts: boolean;
  hedgeAlerts: boolean;
  agentAlerts: boolean;
  
  // Privacy Settings
  privateMode: boolean;
  zkProofsEnabled: boolean;
  
  // Display Settings
  darkMode: boolean;
  compactView: boolean;
  
  // Risk Settings
  maxLeverage: number;
  defaultStopLoss: number;
  defaultTakeProfit: number;
}

const defaultSettings: UserSettings = {
  autoApprovalEnabled: false,
  autoApprovalThreshold: 10000,
  priceAlerts: true,
  hedgeAlerts: true,
  agentAlerts: true,
  privateMode: false,
  zkProofsEnabled: true,
  darkMode: false,
  compactView: false,
  maxLeverage: 10,
  defaultStopLoss: 5,
  defaultTakeProfit: 10,
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [activeTab, setActiveTab] = useState<'general' | 'hedging' | 'notifications' | 'privacy'>('general');
  const [saving, setSaving] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('user_settings');
    if (savedSettings) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(savedSettings) });
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem('user_settings', JSON.stringify(settings));
      // Small delay to show saving state
      await new Promise(resolve => setTimeout(resolve, 500));
      onClose();
    } catch (e) {
      console.error('Failed to save settings:', e);
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'hedging', label: 'Hedging', icon: Shield },
    { id: 'notifications', label: 'Alerts', icon: Bell },
    { id: 'privacy', label: 'Privacy', icon: Eye },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-[24px] w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-[14px] flex items-center justify-center">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-[#1d1d1f]">Settings</h2>
              <p className="text-[13px] text-[#86868b]">Configure your dashboard preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-full transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-black/5 px-6">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium transition-all relative ${
                  activeTab === tab.id
                    ? 'text-[#007AFF]'
                    : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#007AFF]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-200px)]">
          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* Display Settings */}
              <div className="bg-[#f5f5f7] rounded-xl p-5">
                <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-4">Display</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {settings.darkMode ? <Moon className="w-5 h-5 text-[#86868b]" /> : <Sun className="w-5 h-5 text-[#86868b]" />}
                      <div>
                        <p className="text-[14px] font-medium text-[#1d1d1f]">Dark Mode</p>
                        <p className="text-[12px] text-[#86868b]">Switch between light and dark themes</p>
                      </div>
                    </div>
                    <ToggleSwitch
                      enabled={settings.darkMode}
                      onChange={(val) => updateSetting('darkMode', val)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[#1d1d1f]">Compact View</p>
                      <p className="text-[12px] text-[#86868b]">Show more data in less space</p>
                    </div>
                    <ToggleSwitch
                      enabled={settings.compactView}
                      onChange={(val) => updateSetting('compactView', val)}
                    />
                  </div>
                </div>
              </div>

              {/* Wallet Settings */}
              <div className="bg-[#f5f5f7] rounded-xl p-5">
                <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  Wallet
                </h3>
                <p className="text-[13px] text-[#86868b]">
                  Wallet settings are managed through your connected wallet provider (MetaMask, WalletConnect, etc.)
                </p>
              </div>
            </div>
          )}

          {/* Hedging Tab */}
          {activeTab === 'hedging' && (
            <div className="space-y-6">
              {/* Auto-Approval */}
              <div className="bg-[#f5f5f7] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-[#FF9500]" />
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Auto-Approval</h3>
                      <p className="text-[12px] text-[#86868b]">Automatically approve hedges below threshold</p>
                    </div>
                  </div>
                  <ToggleSwitch
                    enabled={settings.autoApprovalEnabled}
                    onChange={(val) => updateSetting('autoApprovalEnabled', val)}
                  />
                </div>

                {settings.autoApprovalEnabled && (
                  <div className="mt-4 pt-4 border-t border-black/5">
                    <label className="block text-[13px] font-medium text-[#1d1d1f] mb-3">
                      Threshold: ${settings.autoApprovalThreshold.toLocaleString()}
                    </label>
                    <input
                      type="range"
                      min="1000"
                      max="50000"
                      step="1000"
                      value={settings.autoApprovalThreshold}
                      onChange={(e) => updateSetting('autoApprovalThreshold', Number(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[#007AFF]"
                    />
                    <div className="flex justify-between text-[11px] text-[#86868b] mt-2">
                      <span>$1K</span>
                      <span>$25K</span>
                      <span>$50K</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Risk Settings */}
              <div className="bg-[#f5f5f7] rounded-xl p-5">
                <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-4">Risk Limits</h3>
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-[13px] font-medium text-[#1d1d1f] mb-2">
                      Max Leverage: {settings.maxLeverage}x
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={settings.maxLeverage}
                      onChange={(e) => updateSetting('maxLeverage', Number(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[#007AFF]"
                    />
                    <div className="flex justify-between text-[11px] text-[#86868b] mt-1">
                      <span>1x</span>
                      <span>50x</span>
                      <span>100x</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-[#1d1d1f] mb-2">
                      Default Stop Loss: {settings.defaultStopLoss}%
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="25"
                      value={settings.defaultStopLoss}
                      onChange={(e) => updateSetting('defaultStopLoss', Number(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[#FF3B30]"
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-[#1d1d1f] mb-2">
                      Default Take Profit: {settings.defaultTakeProfit}%
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={settings.defaultTakeProfit}
                      onChange={(e) => updateSetting('defaultTakeProfit', Number(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[#34C759]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div className="bg-[#f5f5f7] rounded-xl p-5">
                <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-4">Alert Preferences</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[#1d1d1f]">Price Alerts</p>
                      <p className="text-[12px] text-[#86868b]">Get notified on significant price movements</p>
                    </div>
                    <ToggleSwitch
                      enabled={settings.priceAlerts}
                      onChange={(val) => updateSetting('priceAlerts', val)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[#1d1d1f]">Hedge Alerts</p>
                      <p className="text-[12px] text-[#86868b]">Notifications for hedge execution & liquidations</p>
                    </div>
                    <ToggleSwitch
                      enabled={settings.hedgeAlerts}
                      onChange={(val) => updateSetting('hedgeAlerts', val)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[#1d1d1f]">AI Agent Alerts</p>
                      <p className="text-[12px] text-[#86868b]">Updates from AI agents and recommendations</p>
                    </div>
                    <ToggleSwitch
                      enabled={settings.agentAlerts}
                      onChange={(val) => updateSetting('agentAlerts', val)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Privacy Tab */}
          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <div className="bg-[#f5f5f7] rounded-xl p-5">
                <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-4">Privacy Features</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[#1d1d1f]">Private Mode</p>
                      <p className="text-[12px] text-[#86868b]">Hide transaction details with stealth addresses</p>
                    </div>
                    <ToggleSwitch
                      enabled={settings.privateMode}
                      onChange={(val) => updateSetting('privateMode', val)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[#1d1d1f]">ZK-STARK Proofs</p>
                      <p className="text-[12px] text-[#86868b]">Generate zero-knowledge proofs for settlements</p>
                    </div>
                    <ToggleSwitch
                      enabled={settings.zkProofsEnabled}
                      onChange={(val) => updateSetting('zkProofsEnabled', val)}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-[#34C759]/10 border border-[#34C759]/20 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-[#34C759] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-medium text-[#1d1d1f]">Your Privacy is Protected</p>
                    <p className="text-[12px] text-[#86868b] mt-1">
                      All sensitive data is encrypted. ZK proofs ensure your positions remain private while still being verifiable on-chain.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5 bg-[#f5f5f7]/50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-[14px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 text-[14px] font-medium text-white bg-[#007AFF] hover:bg-[#0051D5] rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Toggle Switch Component
function ToggleSwitch({ 
  enabled, 
  onChange 
}: { 
  enabled: boolean; 
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        enabled ? 'bg-[#34C759]' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default SettingsModal;
