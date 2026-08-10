/**
 * Per-wallet mutex lock — prevents race conditions on concurrent
 * deposits/withdrawals for the same wallet. Shared across the
 * record-deposit / record-withdraw handlers.
 *
 * Chains new locks onto any existing lock *before* awaiting, so
 * concurrent callers queue instead of racing on the acquire.
 */
const walletLocks = new Map<string, Promise<void>>();

export async function withWalletLock<T>(wallet: string, fn: () => Promise<T>): Promise<T> {
  const key = wallet.toLowerCase();
  const existing = walletLocks.get(key) ?? Promise.resolve();
  let resolve: () => void;
  const lock = new Promise<void>((r) => { resolve = r; });
  walletLocks.set(key, lock);
  try {
    await existing;
    return await fn();
  } finally {
    resolve!();
    if (walletLocks.get(key) === lock) {
      walletLocks.delete(key);
    }
  }
}
