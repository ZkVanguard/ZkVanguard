# Chronos Vanguard WDK

This folder contains the self-custodial wallet implementation for Tether WDK (Wallet Development Kit) on Cronos/Ethereum chains.

## Security Model

The wallet implements a **client-side only** security model where private keys never leave the user's device.

### 1. Key Generation
- Uses `ethers.js` (BIP-39) to generate a 12-word mnemonic phrase.
- This mnemonic is the root of trust.

### 2. Encryption (AES-GCM)
- Upon creation/import, a **cryptographically strong random key (256-bit)** is generated using the Web Crypto API (`window.crypto.subtle`).
- The mnemonic is encrypted using **AES-GCM** with this random key.
- This ensures even if the browser `localStorage` is dumped, the mnemonic is unreadable without the key.

### 3. Key Storage & Passkeys
- The random encryption key is stored alongside the encrypted data as a JWK (JSON Web Key).
- **Access Control:** The application logic prevents access to the decryption function unless `PasskeyService.authenticate()` returns success.
- This gates the wallet behind the device's hardware security (FaceID/TouchID/YubiKey).

### 4. Recovery
- If the device is lost, the user MUST have their 12-word mnemonic backed up physically.
- Passkeys are device-bound; you cannot recover a wallet on a new device using just a passkey. You must re-import the mnemonic.

## Testing Security

To verify the encryption implementation:

```bash
bun test test/wdk/encryption.test.ts
bun test test/wdk/wallet-recipe.test.ts
```

These tests verify:
1.  AES-GCM keys are generated correctly.
2.  Encryption/Decryption round-trip is lossless.
3.  Tampered data is rejected (integrity check).
