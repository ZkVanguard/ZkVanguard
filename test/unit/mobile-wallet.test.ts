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
  buildMobileWalletLink,
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
  it('ships exactly one canonical SUI wallet (Slush)', () => {
    expect(SUI_MOBILE_WALLETS.length).toBe(1);
    expect(SUI_MOBILE_WALLETS[0].id).toBe('slush');
  });

  it('universal-link builder reproduces the original href when decoded', () => {
    // Includes query + hash to catch the two most common ways route
    // context gets clobbered.
    const href = 'https://www.zkvanguard.xyz/dashboard?section=vault#deposit';
    const encoded = encodeURIComponent(href);
    const link = SUI_MOBILE_WALLETS[0].buildUniversalLink(encoded);
    const lastSegment = link.split('/').pop() ?? '';
    expect(decodeURIComponent(lastSegment)).toBe(href);
  });

  it('has a real install URL', () => {
    expect(SUI_MOBILE_WALLETS[0].installUrl).toMatch(/^https:\/\//);
  });

  it('universal link points at my.slush.app', () => {
    const link = SUI_MOBILE_WALLETS[0].buildUniversalLink('x');
    expect(link).toContain('my.slush.app');
  });
});

describe('buildMobileWalletLink', () => {
  it('returns an empty string on the server (no window)', () => {
    // In this test env `window` is defined by jsdom. Simulate SSR by
    // temporarily deleting it.
    const originalWindow = globalThis.window;
    try {
      // @ts-expect-error - deliberately clobbering for SSR simulation
      delete (globalThis as { window?: unknown }).window;
      const link = buildMobileWalletLink(SUI_MOBILE_WALLETS[0]);
      expect(link).toBe('');
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('produces a full universal link when window.location.href is set', () => {
    withFakeBrowser(
      'https://www.zkvanguard.xyz/dashboard?section=vault#deposit',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      5,
      () => {
        const link = buildMobileWalletLink(SUI_MOBILE_WALLETS[0]);
        expect(link).toMatch(/^https:\/\/my\.slush\.app\/browse\//);
        // The encoded segment MUST decode back to the current href so
        // route context (path + query + hash) is preserved.
        const encoded = link.split('/browse/')[1];
        expect(decodeURIComponent(encoded)).toBe(
          'https://www.zkvanguard.xyz/dashboard?section=vault#deposit',
        );
      },
    );
  });
});
