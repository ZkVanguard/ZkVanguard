/**
 * WDK Wallet Storage
 *
 * localStorage persistence for encrypted wallet data.
 * Isolated from context to enable testing and reuse.
 */

export const STORAGE_KEY = 'wdk_wallet_v2';

export interface StoredWallet {
  encryptedData: string;
  iv: string;
  keyJwk: string;
  addresses: Record<string, string>;
  lastChain: string;
  passkeyId?: string;
  zkProofHash?: string;
  zkBindingHash?: string;
  passwordHash?: string;
}

export function saveWallet(wallet: StoredWallet): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  }
}

export function loadWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;

  try {
    const parsed = JSON.parse(data);
    if (!parsed.encryptedData || !parsed.iv || !parsed.keyJwk) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed as StoredWallet;
  } catch {
    return null;
  }
}

export function clearWallet(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
