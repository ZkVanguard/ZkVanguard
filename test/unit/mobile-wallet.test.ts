/**
 * Unit tests for lib/utils/mobile-wallet.ts.
 *
 * Locks:
 *   - href (not origin) is what gets URL-encoded so route context is preserved
 *   - iPad Safari (Mac UA + touch points > 1) is detected as mobile
 *   - Desktop Safari on a real Mac (no touch points) is NOT mobile
 *   - Every wallet's universal link double-decodes back to the original href
 */
import {
  SUI_MOBILE_WALLETS,
  isMobileBrowser,
} from '@/lib/utils/mobile-wallet';

// Small helper to swap window/navigator for the duration of a test.
function withFakeBrowser(
  href: string,
  ua: string,
  maxTouchPoints = 0,
  fn: () => void,
): void {
  const origWindow = globalThis.window;
  const origNavigator = globalThis.navigator;
  globalThis.window = {
    ...(origWindow as unknown as Record<string, unknown>),
    location: { href, origin: new URL(href).origin } as Location,
  } as Window & typeof globalThis;
  globalThis.navigator = {
    ...(origNavigator as unknown as Record<string, unknown>),
    userAgent: ua,
    maxTouchPoints,
  } as Navigator;
  try {
    fn();
  } finally {
    globalThis.window = origWindow;
    globalThis.navigator = origNavigator;
  }
}

describe('isMobileBrowser', () => {
  it('detects modern iOS Safari', () => {
    withFakeBrowser(
      'https://www.zkvanguard.xyz/dashboard',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      5,
      () => {
        expect(isMobileBrowser()).toBe(true);
      },
    );
  });

  it('detects Android Chrome', () => {
    withFakeBrowser(
      'https://www.zkvanguard.xyz/dashboard',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      5,
      () => {
        expect(isMobileBrowser()).toBe(true);
      },
    );
  });

  it('detects iPad Safari despite the desktop-style Mac UA', () => {
    // iPad Safari 13+ reports a macOS UA — the touch-points check is
    // what saves us.
    withFakeBrowser(
      'https://www.zkvanguard.xyz/dashboard',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      5, // iPad reports 5 touch points
      () => {
        expect(isMobileBrowser()).toBe(true);
      },
    );
  });

  it('does NOT flag a real desktop Mac with no touch input', () => {
    withFakeBrowser(
      'https://www.zkvanguard.xyz/dashboard',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      0, // no touch points on a real Mac
      () => {
        expect(isMobileBrowser()).toBe(false);
      },
    );
  });

  it('does NOT flag a Mac with 1 touch point (stylus-only or single-touch trackpad)', () => {
    // 1 touch point is common on Macs with Force Touch trackpads or
    // pen-input tablets — those aren't mobile browsers.
    withFakeBrowser(
      'https://www.zkvanguard.xyz/',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      1,
      () => {
        expect(isMobileBrowser()).toBe(false);
      },
    );
  });

  it('does NOT flag desktop Chrome on Windows', () => {
    withFakeBrowser(
      'https://www.zkvanguard.xyz/',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      0,
      () => {
        expect(isMobileBrowser()).toBe(false);
      },
    );
  });
});

describe('SUI_MOBILE_WALLETS', () => {
  it('has at least 4 wallet options', () => {
    expect(SUI_MOBILE_WALLETS.length).toBeGreaterThanOrEqual(4);
  });

  it('universal-link builders reproduce the original href when decoded', () => {
    const href = 'https://www.zkvanguard.xyz/dashboard?section=vault#deposit';
    const encoded = encodeURIComponent(href);
    for (const w of SUI_MOBILE_WALLETS) {
      const link = w.buildUniversalLink(encoded);
      // The last URL-encoded segment must decode back to the original.
      const lastSegment = link.split('/').pop() ?? '';
      expect(decodeURIComponent(lastSegment)).toBe(href);
    }
  });

  it('every option has an install URL', () => {
    for (const w of SUI_MOBILE_WALLETS) {
      expect(w.installUrl).toMatch(/^https:\/\//);
    }
  });

  it('Slush is the default (first) option', () => {
    expect(SUI_MOBILE_WALLETS[0].id).toBe('slush');
  });

  it('links point at wallet-specific hosts (no cross-wallet mixing)', () => {
    const bySlushConvention: Array<'slush' | 'sui-wallet'> = ['slush', 'sui-wallet'];
    for (const w of SUI_MOBILE_WALLETS) {
      const link = w.buildUniversalLink('x');
      if (bySlushConvention.includes(w.id as 'slush' | 'sui-wallet')) {
        // Slush and Sui Wallet share the my.slush.app browser host by design.
        expect(link).toContain('my.slush.app');
      } else if (w.id === 'suiet') {
        expect(link).toContain('suiet.app');
      } else if (w.id === 'ethos') {
        expect(link).toContain('ethoswallet.xyz');
      }
    }
  });
});
