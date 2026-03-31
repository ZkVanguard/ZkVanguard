const createNextIntlPlugin = require('next-intl/plugin');
 
const withNextIntl = createNextIntlPlugin();
 
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Standalone output — smaller deployment, faster cold starts
  output: 'standalone',
  
  // Performance optimizations
  experimental: {
    optimizePackageImports: [
      'viem', 'lucide-react', '@heroicons/react', 'framer-motion',
      'chart.js', 'react-chartjs-2', '@mysten/dapp-kit', '@mysten/sui',
      'date-fns', 'ethers', 'zod', 'eventemitter3', 'uuid',
    ],
    // Reduce page data sent to browser
    optimizeCss: true,
    // Reduce serverless function size
    outputFileTracingExcludes: {
      '*': [
        'node_modules/@swc/core-linux-x64-gnu',
        'node_modules/@swc/core-linux-x64-musl',
        'node_modules/@esbuild',
        'node_modules/sharp',
      ],
    },
  },
  
  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  
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

    // Optimize chunk splitting for multi-user concurrency
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization?.splitChunks,
          cacheGroups: {
            ...((typeof config.optimization?.splitChunks === 'object' && config.optimization?.splitChunks?.cacheGroups) || {}),
            // Separate large vendor chunks for better caching
            web3: {
              test: /[\\/]node_modules[\\/](viem|ethers|@mysten|@bluefin)[\\/]/,
              name: 'vendor-web3',
              chunks: 'all',
              priority: 20,
            },
            ui: {
              test: /[\\/]node_modules[\\/](framer-motion|chart\.js|react-chartjs|lucide-react|@heroicons)[\\/]/,
              name: 'vendor-ui',
              chunks: 'all',
              priority: 15,
            },
          },
        },
      };
    }

    // Enable module concatenation for smaller bundles
    config.optimization = {
      ...config.optimization,
      concatenateModules: true,
    };

    return config;
  },

  // Environment variables exposed to the browser (NEVER expose secrets here)
  env: {
    NEXT_PUBLIC_CRONOS_RPC_URL: process.env.NEXT_PUBLIC_CRONOS_RPC_URL,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_MOONLANDER_API: process.env.NEXT_PUBLIC_MOONLANDER_API,
    NEXT_PUBLIC_VVS_API: process.env.NEXT_PUBLIC_VVS_API,
    NEXT_PUBLIC_MCP_API: process.env.NEXT_PUBLIC_MCP_API,
    NEXT_PUBLIC_X402_API: process.env.NEXT_PUBLIC_X402_API,
    NEXT_PUBLIC_DELPHI_API: process.env.NEXT_PUBLIC_DELPHI_API,
    // NOTE: API keys are server-only — accessed via process.env on server routes
    // Do NOT expose CRYPTOCOM_DEVELOPER_API_KEY or secrets to the browser
  },

  // Production optimizations
  compress: true,
  poweredByHeader: false,
  
  // ESLint configuration - warnings don't block build
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Image optimization
  images: {
    domains: ['localhost'],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400, // 24h image caching
    deviceSizes: [640, 750, 828, 1080, 1200], // Fewer sizes = fewer variants to cache
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
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.cryptocom.com https://*.crypto.com https://api.coingecko.com https://hermes.pyth.network wss: https:",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
