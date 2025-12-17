/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Webpack configuration for web3 libraries
  webpack: (config, { isServer }) => {
    // Handle node modules for browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        path: false,
        os: false,
        '@react-native-async-storage/async-storage': false,
        'pino-pretty': false,
      };
      
      // Mark x402 client as server-only (uses node:crypto)
      config.resolve.alias = {
        ...config.resolve.alias,
        '@crypto.com/facilitator-client': false,
      };
    }

    // Suppress specific module warnings
    config.ignoreWarnings = [
      { module: /node_modules\/@metamask\/sdk/ },
      { module: /node_modules\/pino/ },
      { module: /node_modules\/@crypto\.com/ },
    ];

    // Handle .node files
    config.module.rules.push({
      test: /\.node$/,
      use: 'node-loader',
    });

    return config;
  },

  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_CRONOS_RPC_URL: process.env.NEXT_PUBLIC_CRONOS_RPC_URL,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_MOONLANDER_API: process.env.NEXT_PUBLIC_MOONLANDER_API,
    NEXT_PUBLIC_VVS_API: process.env.NEXT_PUBLIC_VVS_API,
    NEXT_PUBLIC_MCP_API: process.env.NEXT_PUBLIC_MCP_API,
    NEXT_PUBLIC_X402_API: process.env.NEXT_PUBLIC_X402_API,
    NEXT_PUBLIC_DELPHI_API: process.env.NEXT_PUBLIC_DELPHI_API,
  },

  // Production optimizations
  compress: true,
  poweredByHeader: false,
  
  // ESLint configuration - warnings don't block build
  eslint: {
    ignoreDuringBuilds: true, // Temporarily ignore to verify cleanup worked
  },

  // Image optimization
  images: {
    domains: ['localhost'],
    formats: ['image/avif', 'image/webp'],
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
