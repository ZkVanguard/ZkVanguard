PR: wdk-wallet-evm: Use JS memzero fallback to avoid sodium-native bundling

Summary
-------
This patch removes the direct dependency on `sodium-universal` in
`src/memory-safe/signing-key.js` and replaces the `sodium_memzero` call
with a tiny `memzeroSync` helper that uses `Buffer.fill(0)`/`Uint8Array.fill(0)`.

Why
---
Importing `sodium-universal` / `sodium-native` causes bundlers (Next.js,
Webpack) to include native bindings that fail during browser builds (or
on environments where native prebuilds aren't available). This leads to
errors such as "Can't resolve 'sodium-native'" or mismatched exports
(e.g., `sodium_memzero` not exported by sodium-universal when bundling).

The goal here is a minimal safe fix to restore browser bundling and keep
sensitive buffers zeroed. This fallback does not provide OS-level
secure memory locking (mlock) but keeps the zeroing behaviour and
prevents the bundling crash. We can follow up with an enhanced approach
that attempts to require the native `sodium-native` in Node.js and uses
it there while using the JS fallback in browser bundles.

Changes
-------
- `src/memory-safe/signing-key.js`
  - Remove `import { sodium_memzero } from 'sodium-universal'`.
  - Add `memzeroSync(buf)` helper that zeroes a Buffer/Uint8Array.
  - Replace `sodium_memzero(this._privateKeyBuffer)` with
    `memzeroSync(this._privateKeyBuffer)`.

Testing
-------
- Existing unit/integration tests should still pass; behaviour is
  identical from the library consumer perspective (the private key
  buffer is cleared).
- Run tests locally:

```bash
npm install
npm test
```

Applying the patch locally
-------------------------
From the `@tetherto/wdk-wallet-evm` repository root:

```bash
# copy the patch into the repo root (or apply from workspace)
git apply /path/to/wdk-wallet-evm-memzero-fix.patch
# run tests
npm install
npm test
# commit and push
git add src/memory-safe/signing-key.js
git commit -m "fix: memzero fallback to avoid sodium-native bundling"
git push origin main
```

Follow-ups
---------
1. Add an optional Node-optimized path that `require()`s `sodium-native`
   at runtime when available (use `createRequire` and guard by
   `typeof window === 'undefined'`) to gain OS-level secure zeroing on
   server-side environments.
2. Consider updating docs/release notes to explain the security
   trade-offs and the server-optimized option.

If you want, I can prepare a second patch implementing the Node-optimized
`require()` fallback (attempt to use `sodium-native` on server, fall back
to `memzeroSync` when unavailable).