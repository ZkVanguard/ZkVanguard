// API Interceptor to block WalletConnect Cloud 403 errors
// This must run before any wallet initialization code

if (typeof window !== 'undefined') {
  const blockedDomains = [
    'api.web3modal.org',
    'pulse.walletconnect.org',
    'explorer-api.walletconnect.com',
  ];

  const mockResponses: Record<string, unknown> = {
    'api.web3modal.org/appkit/v1/config': {
      success: true,
      data: {
        enableAnalytics: false,
        enableOnramp: false,
        features: {},
      },
    },
    'api.web3modal.org/getWallets': {
      success: true,
      data: {
        wallets: [],
        total: 0,
      },
    },
    'pulse.walletconnect.org': {
      success: true,
    },
  };

  // Intercept fetch API
  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Check if URL contains any blocked domains
    const isBlocked = blockedDomains.some((domain) => url.includes(domain));

    if (isBlocked) {
      console.log('[API Interceptor] Blocked request to:', url);

      // Find appropriate mock response
      const mockKey = Object.keys(mockResponses).find((key) => url.includes(key));
      const mockData = mockKey ? mockResponses[mockKey] : { success: true };

      return Promise.resolve(
        new Response(JSON.stringify(mockData), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    return originalFetch.call(this, input, init);
  };

  // Also intercept XMLHttpRequest for legacy code
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null
  ) {
    const urlString = typeof url === 'string' ? url : url.toString();
    const isBlocked = blockedDomains.some((domain) => urlString.includes(domain));

    if (isBlocked) {
      console.log('[API Interceptor] Blocked XHR request to:', urlString);
      // Override send to return mock data
      this.send = function () {
        Object.defineProperty(this, 'status', { value: 200 });
        Object.defineProperty(this, 'readyState', { value: 4 });
        Object.defineProperty(this, 'responseText', {
          value: JSON.stringify({ success: true }),
        });
        if (this.onreadystatechange) {
          this.onreadystatechange(new Event('readystatechange'));
        }
      };
    }

    return originalXHROpen.call(this, method, url, async, username, password);
  };

  console.log('[API Interceptor] WalletConnect Cloud API blocker initialized');
}

export {};
