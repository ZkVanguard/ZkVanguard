
import { describe, expect, test, beforeAll } from "bun:test";
import { ethers } from "ethers";

// Polyfill window/crypto for encryption lib
if (typeof window === 'undefined') {
    (global as any).window = {
        crypto: crypto,
        btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
        atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    };
}

import { generateKey, exportKey, importKey, encryptData, decryptData } from "../../lib/wdk/encryption";

// Definitions from wdk-context.tsx
interface StoredWallet {
  encryptedData: string;
  iv: string;
  keyJwk: string;
  addresses: Record<string, string>;
  lastChain: string;
  passkeyId?: string;
}

const SUPPORTED_CHAINS = ['sepolia', 'cronos-mainnet', 'hedera-mainnet'];

describe("WDK Wallet Security Recipe", () => {
    
    test("End-to-End: Create, Encrypt, Save, Load, Decrypt, Recover", async () => {
        // ---------------------------------------------------------
        // 1. Create Wallet (User Action)
        // ---------------------------------------------------------
        console.log("Step 1: Creating random wallet...");
        const wallet = ethers.HDNodeWallet.createRandom();
        const mnemonic = wallet.mnemonic?.phrase;
        if (!mnemonic) throw new Error("Failed to generate mnemonic");
        
        const originalAddress = wallet.address;
        console.log("Original Address:", originalAddress);

        // ---------------------------------------------------------
        // 2. Encrypt & Save (System Action)
        // ---------------------------------------------------------
        console.log("Step 2: Encrypting...");
        
        // Generate a unique key for this wallet
        const key = await generateKey();
        const keyJwk = await exportKey(key);
        
        // Encrypt the mnemonic
        const { data: encryptedData, iv } = await encryptData(mnemonic, key);
        
        // Mock Storage State
        const stored: StoredWallet = {
            encryptedData,
            iv,
            keyJwk,
            addresses: {},
            lastChain: 'sepolia',
            passkeyId: 'credential-id-123' 
        };
        SUPPORTED_CHAINS.forEach(chain => {
            stored.addresses[chain] = wallet.address;
        });
        
        // Verify we are not storing plain text
        expect(stored.encryptedData).not.toBe(mnemonic);
        expect(JSON.stringify(stored)).not.toContain(mnemonic);

        // ---------------------------------------------------------
        // 3. User Returns & Logs in (System Action)
        // ---------------------------------------------------------
        console.log("Step 3: Decrypting...");

        // Simulate Passkey Auth (PasskeyService.authenticate returns true)
        const isPasskeyValid = true; 
        expect(isPasskeyValid).toBe(true);

        // Recover Key
        const recoveredKey = await importKey(stored.keyJwk);
        
        // Decrypt Mnemonic
        const decryptedMnemonic = await decryptData(stored.encryptedData, stored.iv, recoveredKey);
        expect(decryptedMnemonic).toBe(mnemonic);
        
        // ---------------------------------------------------------
        // 4. Re-initialize Wallet (System Action)
        // ---------------------------------------------------------
        console.log("Step 4: Re-initializing...");
        const recoveredWallet = ethers.HDNodeWallet.fromPhrase(decryptedMnemonic);
        
        expect(recoveredWallet.address).toBe(originalAddress);
        console.log("Recovered Address:", recoveredWallet.address);
        
        console.log("✅ SECURITY CHECK PASSED");
    });
});
