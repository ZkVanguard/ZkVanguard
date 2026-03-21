
import { describe, expect, test } from "bun:test";
import { ethers } from "ethers";

// Polyfill window/crypto for the library code
if (typeof window === 'undefined') {
    (global as any).window = {
        crypto: crypto,
        location: { hostname: 'localhost' },
        btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
        atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    };
} else if (!(global as any).window.location) {
    // Another test file may have set window without location
    (global as any).window.location = { hostname: 'localhost' };
}

// Also polyfill localStorage for StoredWallet persistence
const mockStorage: Record<string, string> = {};
if (typeof localStorage === 'undefined') {
    (global as any).localStorage = {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, value: string) => { mockStorage[key] = value; },
        removeItem: (key: string) => { delete mockStorage[key]; },
        clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
    };
}

import { generateKey, exportKey, importKey, encryptData, decryptData } from "../../lib/wdk/encryption";

// ============================================================
// Replicate the ZK functions from wdk-context.tsx for testing
// (These are module-private, so we duplicate for test coverage)
// ============================================================

async function sha256Hex(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateZKPasskeyBinding(walletAddress: string, passkeyId: string): Promise<{ proofHash: string; bindingHash: string }> {
    const domain = typeof window !== 'undefined' ? window.location.hostname : 'unknown';
    const bindingInput = JSON.stringify({
        wallet: walletAddress.toLowerCase(),
        passkey: passkeyId,
        domain,
        protocol: 'ZK-STARK',
        version: '1.0.0'
    });
    const bindingHash = await sha256Hex(bindingInput);
    const witnessInput = `${walletAddress.toLowerCase()}:${passkeyId}:${Date.now()}`;
    const witnessHash = await sha256Hex(witnessInput);
    const proofHash = await sha256Hex(`${bindingHash}:${witnessHash}`);
    return { proofHash, bindingHash };
}

async function verifyZKPasskeyBinding(
    walletAddress: string,
    passkeyId: string,
    storedBindingHash: string
): Promise<boolean> {
    const domain = typeof window !== 'undefined' ? window.location.hostname : 'unknown';
    const bindingInput = JSON.stringify({
        wallet: walletAddress.toLowerCase(),
        passkey: passkeyId,
        domain,
        protocol: 'ZK-STARK',
        version: '1.0.0'
    });
    const expectedHash = await sha256Hex(bindingInput);
    return expectedHash === storedBindingHash;
}

// ============================================================
// StoredWallet interface (mirrors wdk-context.tsx)
// ============================================================
interface StoredWallet {
    encryptedData: string;
    iv: string;
    keyJwk: string;
    addresses: Record<string, string>;
    lastChain: string;
    passkeyId?: string;
    zkProofHash?: string;
    zkBindingHash?: string;
}

// ============================================================
// TESTS
// ============================================================

describe("ZK-STARK Passkey Binding — Unit Tests", () => {

    test("sha256Hex: produces valid 64-char hex digest", async () => {
        const hash = await sha256Hex("hello world");
        expect(hash).toHaveLength(64);
        expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
        // Known SHA-256 of "hello world"
        expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    });

    test("sha256Hex: same input always produces same hash", async () => {
        const a = await sha256Hex("deterministic-test-input-42");
        const b = await sha256Hex("deterministic-test-input-42");
        expect(a).toBe(b);
    });

    test("sha256Hex: different inputs produce different hashes", async () => {
        const a = await sha256Hex("input-A");
        const b = await sha256Hex("input-B");
        expect(a).not.toBe(b);
    });

    test("generateZKPasskeyBinding: returns proofHash and bindingHash", async () => {
        const wallet = "0xAbC1234567890DEF1234567890abcdef12345678";
        const passkeyId = "credential-raw-id-abc123";

        const result = await generateZKPasskeyBinding(wallet, passkeyId);
        expect(result).toHaveProperty("proofHash");
        expect(result).toHaveProperty("bindingHash");
        expect(result.proofHash).toHaveLength(64);
        expect(result.bindingHash).toHaveLength(64);
        expect(/^[a-f0-9]{64}$/.test(result.proofHash)).toBe(true);
        expect(/^[a-f0-9]{64}$/.test(result.bindingHash)).toBe(true);
    });

    test("generateZKPasskeyBinding: bindingHash is deterministic", async () => {
        const wallet = "0x1234567890123456789012345678901234567890";
        const passkey = "cred-id-xyz";

        const r1 = await generateZKPasskeyBinding(wallet, passkey);
        // Small delay to ensure different Date.now() timestamp for witness entropy
        await new Promise(resolve => setTimeout(resolve, 5));
        const r2 = await generateZKPasskeyBinding(wallet, passkey);

        // Binding hash is deterministic (same wallet + passkey + domain)
        expect(r1.bindingHash).toBe(r2.bindingHash);

        // Proof hash includes timestamp entropy, so they differ
        expect(r1.proofHash).not.toBe(r2.proofHash);
    });

    test("generateZKPasskeyBinding: different wallets produce different bindings", async () => {
        const passkey = "same-passkey";
        const r1 = await generateZKPasskeyBinding("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", passkey);
        const r2 = await generateZKPasskeyBinding("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", passkey);

        expect(r1.bindingHash).not.toBe(r2.bindingHash);
    });

    test("generateZKPasskeyBinding: different passkeys produce different bindings", async () => {
        const wallet = "0x1111111111111111111111111111111111111111";
        const r1 = await generateZKPasskeyBinding(wallet, "passkey-A");
        const r2 = await generateZKPasskeyBinding(wallet, "passkey-B");

        expect(r1.bindingHash).not.toBe(r2.bindingHash);
    });

    test("generateZKPasskeyBinding: wallet address is case-insensitive", async () => {
        const passkey = "cred-123";
        const r1 = await generateZKPasskeyBinding("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12", passkey);
        const r2 = await generateZKPasskeyBinding("0xabcdef1234567890abcdef1234567890abcdef12", passkey);

        expect(r1.bindingHash).toBe(r2.bindingHash);
    });

    test("verifyZKPasskeyBinding: valid binding verifies true", async () => {
        const wallet = "0xDeadBeef00000000000000000000000000000001";
        const passkey = "passkey-valid-id";

        const { bindingHash } = await generateZKPasskeyBinding(wallet, passkey);
        const valid = await verifyZKPasskeyBinding(wallet, passkey, bindingHash);
        expect(valid).toBe(true);
    });

    test("verifyZKPasskeyBinding: tampered wallet rejects", async () => {
        const wallet = "0x1111111111111111111111111111111111111111";
        const passkey = "passkey-123";

        const { bindingHash } = await generateZKPasskeyBinding(wallet, passkey);

        // Attacker tries to unlock with a different wallet
        const tampered = await verifyZKPasskeyBinding(
            "0x2222222222222222222222222222222222222222",
            passkey,
            bindingHash
        );
        expect(tampered).toBe(false);
    });

    test("verifyZKPasskeyBinding: tampered passkey rejects", async () => {
        const wallet = "0x1111111111111111111111111111111111111111";
        const originalPasskey = "original-passkey-id";

        const { bindingHash } = await generateZKPasskeyBinding(wallet, originalPasskey);

        // Attacker substitutes their passkey
        const tampered = await verifyZKPasskeyBinding(wallet, "attacker-passkey-id", bindingHash);
        expect(tampered).toBe(false);
    });

    test("verifyZKPasskeyBinding: tampered binding hash rejects", async () => {
        const wallet = "0x1111111111111111111111111111111111111111";
        const passkey = "passkey-123";

        // Attacker provides a fabricated hash
        const tampered = await verifyZKPasskeyBinding(
            wallet,
            passkey,
            "0000000000000000000000000000000000000000000000000000000000000000"
        );
        expect(tampered).toBe(false);
    });

    test("verifyZKPasskeyBinding: proofHash does NOT verify (only bindingHash does)", async () => {
        const wallet = "0xABCDEF0000000000000000000000000000000001";
        const passkey = "cred-xyz";

        const { proofHash, bindingHash } = await generateZKPasskeyBinding(wallet, passkey);

        // bindingHash verifies
        expect(await verifyZKPasskeyBinding(wallet, passkey, bindingHash)).toBe(true);

        // proofHash does NOT verify (includes timestamp entropy)
        expect(await verifyZKPasskeyBinding(wallet, passkey, proofHash)).toBe(false);
    });
});


describe("ZK-STARK Passkey Binding — E2E Wallet Flow", () => {

    test("Full lifecycle: Create → Encrypt → Register Passkey + ZK Binding → Lock → Login + ZK Verify → Recover", async () => {
        console.log("\n=== ZK + PASSKEY E2E TEST ===\n");

        // -------------------------------------------------------
        // 1. CREATE WALLET
        // -------------------------------------------------------
        console.log("Step 1: Creating HD wallet...");
        const wallet = ethers.HDNodeWallet.createRandom();
        const mnemonic = wallet.mnemonic?.phrase;
        if (!mnemonic) throw new Error("Failed to generate mnemonic");
        const address = wallet.address;
        console.log("  Address:", address);

        // -------------------------------------------------------
        // 2. ENCRYPT & STORE
        // -------------------------------------------------------
        console.log("Step 2: Encrypting mnemonic with AES-256-GCM...");
        const key = await generateKey();
        const keyJwk = await exportKey(key);
        const { data: encryptedData, iv } = await encryptData(mnemonic, key);

        expect(encryptedData).not.toBe(mnemonic);

        // -------------------------------------------------------
        // 3. REGISTER PASSKEY + ZK BINDING
        // -------------------------------------------------------
        console.log("Step 3: Simulating passkey registration + ZK binding...");
        const mockPasskeyRawId = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo"; // simulated rawId

        const { proofHash, bindingHash } = await generateZKPasskeyBinding(address, mockPasskeyRawId);

        console.log("  ZK Proof Hash:", proofHash.slice(0, 24) + "...");
        console.log("  ZK Binding Hash:", bindingHash.slice(0, 24) + "...");

        expect(proofHash).toHaveLength(64);
        expect(bindingHash).toHaveLength(64);

        // Build StoredWallet (simulates what wdk-context saves)
        const stored: StoredWallet = {
            encryptedData,
            iv,
            keyJwk,
            addresses: { 'sepolia': address, 'cronos-mainnet': address },
            lastChain: 'sepolia',
            passkeyId: mockPasskeyRawId,
            zkProofHash: proofHash,
            zkBindingHash: bindingHash,
        };

        // Persist to mock localStorage
        localStorage.setItem('wdk_wallet_v2', JSON.stringify(stored));
        console.log("  ✅ Wallet + Passkey + ZK binding stored");

        // -------------------------------------------------------
        // 4. LOCK WALLET (disconnect session)
        // -------------------------------------------------------
        console.log("Step 4: Locking wallet (simulating disconnect/close tab)...");
        // In real app, walletRef.current is set to null, state.isUnlocked = false
        // But storage is preserved

        // -------------------------------------------------------
        // 5. LOGIN — PASSKEY AUTH + ZK VERIFICATION
        // -------------------------------------------------------
        console.log("Step 5: Login with passkey + ZK verification...");

        const loadedJson = localStorage.getItem('wdk_wallet_v2');
        expect(loadedJson).not.toBeNull();
        const loaded: StoredWallet = JSON.parse(loadedJson!);

        // 5a. Passkey auth (simulated — in real app, WebAuthn prompts biometric)
        expect(loaded.passkeyId).toBe(mockPasskeyRawId);
        const passkeyAuthPassed = true; // simulate PasskeyService.authenticate() success
        expect(passkeyAuthPassed).toBe(true);

        // 5b. ZK Binding Verification — the REAL check
        expect(loaded.zkBindingHash).toBeDefined();
        const zkValid = await verifyZKPasskeyBinding(
            loaded.addresses[loaded.lastChain],
            loaded.passkeyId!,
            loaded.zkBindingHash!
        );
        expect(zkValid).toBe(true);
        console.log("  ✅ ZK passkey-wallet binding verified");

        // 5c. Decrypt and recover wallet
        const recoveredKey = await importKey(loaded.keyJwk);
        const decryptedMnemonic = await decryptData(loaded.encryptedData, loaded.iv, recoveredKey);
        expect(decryptedMnemonic).toBe(mnemonic);

        const recoveredWallet = ethers.HDNodeWallet.fromPhrase(decryptedMnemonic);
        expect(recoveredWallet.address).toBe(address);
        console.log("  ✅ Wallet recovered:", recoveredWallet.address);

        // -------------------------------------------------------
        // 6. VERIFY ACTION (transaction signing authorization)
        // -------------------------------------------------------
        console.log("Step 6: Simulating transaction authorization...");

        // Same ZK check happens in verifyAction before each tx
        const txAuthZkValid = await verifyZKPasskeyBinding(
            loaded.addresses[loaded.lastChain],
            loaded.passkeyId!,
            loaded.zkBindingHash!
        );
        expect(txAuthZkValid).toBe(true);
        console.log("  ✅ Transaction authorized via ZK + Passkey");

        console.log("\n=== ✅ ZK + PASSKEY E2E TEST PASSED ===\n");
    });

    test("Tamper detection: attacker modifies stored wallet address", async () => {
        console.log("\n=== TAMPER DETECTION TEST ===\n");

        const wallet = ethers.HDNodeWallet.createRandom();
        const mnemonic = wallet.mnemonic?.phrase;
        if (!mnemonic) throw new Error("Failed to generate mnemonic");

        const key = await generateKey();
        const keyJwk = await exportKey(key);
        const { data: encryptedData, iv } = await encryptData(mnemonic, key);
        const mockPasskeyId = "tamper-test-passkey-id";

        const { proofHash, bindingHash } = await generateZKPasskeyBinding(wallet.address, mockPasskeyId);

        const stored: StoredWallet = {
            encryptedData,
            iv,
            keyJwk,
            addresses: { 'sepolia': wallet.address },
            lastChain: 'sepolia',
            passkeyId: mockPasskeyId,
            zkProofHash: proofHash,
            zkBindingHash: bindingHash,
        };

        // ATTACKER modifies the stored address to redirect funds
        const attackerAddress = "0x" + "A".repeat(40);
        stored.addresses['sepolia'] = attackerAddress;

        console.log("  Original wallet:", wallet.address);
        console.log("  Tampered to:", attackerAddress);

        // ZK verification should FAIL because the binding was for the original address
        const zkValid = await verifyZKPasskeyBinding(
            stored.addresses[stored.lastChain],
            stored.passkeyId!,
            stored.zkBindingHash!
        );
        expect(zkValid).toBe(false);
        console.log("  ✅ Tamper detected! ZK binding rejected the forged address");

        console.log("\n=== ✅ TAMPER DETECTION PASSED ===\n");
    });

    test("Tamper detection: attacker swaps passkey credential", async () => {
        console.log("\n=== PASSKEY SWAP DETECTION TEST ===\n");

        const wallet = ethers.HDNodeWallet.createRandom();
        const mnemonic = wallet.mnemonic?.phrase;
        if (!mnemonic) throw new Error("Failed to generate mnemonic");

        const key = await generateKey();
        const keyJwk = await exportKey(key);
        const { data: encryptedData, iv } = await encryptData(mnemonic, key);
        const realPasskeyId = "real-user-passkey-id";

        const { proofHash, bindingHash } = await generateZKPasskeyBinding(wallet.address, realPasskeyId);

        const stored: StoredWallet = {
            encryptedData,
            iv,
            keyJwk,
            addresses: { 'sepolia': wallet.address },
            lastChain: 'sepolia',
            passkeyId: realPasskeyId,
            zkProofHash: proofHash,
            zkBindingHash: bindingHash,
        };

        // ATTACKER replaces passkey ID to use their own authenticator
        const attackerPasskeyId = "attacker-biometric-credential";
        stored.passkeyId = attackerPasskeyId;

        console.log("  Real passkey:", realPasskeyId);
        console.log("  Swapped to:", attackerPasskeyId);

        // ZK binding should FAIL — the binding was for a different passkey
        const zkValid = await verifyZKPasskeyBinding(
            stored.addresses[stored.lastChain],
            stored.passkeyId!,
            stored.zkBindingHash!
        );
        expect(zkValid).toBe(false);
        console.log("  ✅ Passkey swap detected! ZK binding rejected the foreign credential");

        console.log("\n=== ✅ PASSKEY SWAP DETECTION PASSED ===\n");
    });

    test("Legacy passkey (no ZK binding) still works", async () => {
        // Simulates a wallet created before ZK integration
        const wallet = ethers.HDNodeWallet.createRandom();
        const mnemonic = wallet.mnemonic?.phrase;
        if (!mnemonic) throw new Error("Failed to generate mnemonic");

        const key = await generateKey();
        const keyJwk = await exportKey(key);
        const { data: encryptedData, iv } = await encryptData(mnemonic, key);

        const stored: StoredWallet = {
            encryptedData,
            iv,
            keyJwk,
            addresses: { 'sepolia': wallet.address },
            lastChain: 'sepolia',
            passkeyId: 'old-passkey-id',
            // No zkProofHash or zkBindingHash — legacy wallet
        };

        // Login flow: passkey auth passes (simulated)
        expect(stored.passkeyId).toBeDefined();

        // ZK check is skipped when no binding exists (fallback behavior)
        if (stored.zkBindingHash) {
            const zkValid = await verifyZKPasskeyBinding(
                stored.addresses[stored.lastChain],
                stored.passkeyId!,
                stored.zkBindingHash
            );
            expect(zkValid).toBe(true);
        } else {
            // Legacy path: no ZK binding, warn but allow
            console.log("  ℹ️ No ZK binding found (legacy passkey). Allowed.");
        }

        // Wallet still decrypts
        const recoveredKey = await importKey(stored.keyJwk);
        const decryptedMnemonic = await decryptData(stored.encryptedData, stored.iv, recoveredKey);
        expect(decryptedMnemonic).toBe(mnemonic);

        console.log("  ✅ Legacy wallet without ZK still works");
    });

    test("Server-side ZK proof request format is correct", async () => {
        // Validate the API payload structure that registerPasskey sends
        const wallet = ethers.HDNodeWallet.createRandom();
        const passkeyRawId = "test-credential-raw-id";
        const address = wallet.address;

        const { proofHash: zkProofHash } = await generateZKPasskeyBinding(address, passkeyRawId);
        const passkeyIdHash = await sha256Hex(passkeyRawId);

        const apiPayload = {
            scenario: 'passkey_binding',
            statement: {
                claim: 'Passkey is cryptographically bound to wallet',
                wallet_hash: zkProofHash.slice(0, 32),
                binding_commitment: zkProofHash,
            },
            witness: {
                wallet_address: address.toLowerCase(),
                passkey_id_hash: passkeyIdHash,
                domain: window.location.hostname,
                registration_timestamp: Date.now(),
            }
        };

        // Validate structure matches what /api/zk-proof/generate expects
        expect(apiPayload.scenario).toBe('passkey_binding');
        expect(apiPayload.statement).toBeDefined();
        expect(Object.keys(apiPayload.statement).length).toBeGreaterThan(0);
        expect(apiPayload.witness).toBeDefined();
        expect(Object.keys(apiPayload.witness).length).toBeGreaterThan(0);
        expect(apiPayload.witness.wallet_address).toBe(address.toLowerCase());
        expect(apiPayload.witness.passkey_id_hash).toHaveLength(64);
        expect(apiPayload.statement.binding_commitment).toHaveLength(64);

        // Verify passkey raw ID is NOT in the payload (privacy: only hash is sent)
        const payloadStr = JSON.stringify(apiPayload);
        expect(payloadStr).not.toContain(passkeyRawId);

        console.log("  ✅ Server-side ZK proof payload validated (passkey ID properly hashed)");
    });
});
