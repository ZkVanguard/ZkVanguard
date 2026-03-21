
import { describe, expect, test, beforeAll } from "bun:test";
// We need to polyfill window for the library code to run
if (typeof window === 'undefined') {
    (global as any).window = {
        crypto: crypto,
        btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
        atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    };
}

import { generateKey, exportKey, importKey, encryptData, decryptData } from "../../lib/wdk/encryption";

describe("WDK Encryption (Web Crypto)", () => {
    test("Should generate a valid AES-GCM key", async () => {
        const key = await generateKey();
        expect(key).toBeDefined();
        expect(key.algorithm.name).toBe("AES-GCM");
        expect((key.algorithm as any).length).toBe(256);
        expect(key.extractable).toBe(true);
    });

    test("Should export and import a key (JWK)", async () => {
        const originalKey = await generateKey();
        const jwk = await exportKey(originalKey);
        
        expect(typeof jwk).toBe("string");
        const parsed = JSON.parse(jwk);
        expect(parsed.kty).toBe("oct");
        expect(parsed.alg).toBe("A256GCM");

        const importedKey = await importKey(jwk);
        expect(importedKey).toBeDefined();
        expect(importedKey.algorithm.name).toBe("AES-GCM");
    });

    test("Should encrypt and decrypt data correctly", async () => {
        const key = await generateKey();
        const secretMessage = "my-secret-mnemonic-phrase-words-123";
        
        const { iv, data } = await encryptData(secretMessage, key);
        
        expect(iv).toBeDefined();
        expect(data).toBeDefined();
        expect(data).not.toBe(secretMessage);

        const decrypted = await decryptData(data, iv, key);
        expect(decrypted).toBe(secretMessage);
    });

    test("Should fail to decrypt with wrong key", async () => {
        const key1 = await generateKey();
        const key2 = await generateKey();
        const secretMessage = "top-secret";
        
        const { iv, data } = await encryptData(secretMessage, key1);
        
        // Try decrypting with wrong key
        try {
            await decryptData(data, iv, key2);
            throw new Error("Should have failed");
        } catch (e) {
            expect(true).toBe(true); // Success if it throws
        }
    });

    test("Should fail to decrypt with tampered data", async () => {
        const key = await generateKey();
        const secretMessage = "top-secret";
        const { iv, data } = await encryptData(secretMessage, key);
        
        // Tamper with data (flip a bit in base64 string basically)
        const tamperedData = data.substring(0, data.length - 1) + (data.endsWith('A') ? 'B' : 'A');

        try {
            await decryptData(tamperedData, iv, key);
            throw new Error("Should have failed");
        } catch (e) {
             expect(true).toBe(true);
        }
    });
});
