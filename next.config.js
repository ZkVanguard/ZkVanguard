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

  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_CRONOS_RPC_URL: process.env.NEXT_PUBLIC_CRONOS_RPC_URL,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_MOONLANDER_API: process.env.NEXT_PUBLIC_MOONLANDER_API,
    NEXT_PUBLIC_VVS_API: process.env.NEXT_PUBLIC_VVS_API,
    NEXT_PUBLIC_MCP_API: process.env.NEXT_PUBLIC_MCP_API,
    NEXT_PUBLIC_X402_API: process.env.NEXT_PUBLIC_X402_API,
    NEXT_PUBLIC_DELPHI_API: process.env.NEXT_PUBLIC_DELPHI_API,
    // Crypto.com AI API Keys (for both client and server)
    NEXT_PUBLIC_CRYPTOCOM_DEVELOPER_API_KEY: process.env.CRYPTOCOM_DEVELOPER_API_KEY || process.env.NEXT_PUBLIC_CRYPTOCOM_DEVELOPER_API_KEY,
    CRYPTOCOM_DEVELOPER_API_KEY: process.env.CRYPTOCOM_DEVELOPER_API_KEY,
    CRYPTOCOM_AI_API_KEY: process.env.CRYPTOCOM_AI_API_KEY,
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
  
  // Reduce serverless function size
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core-linux-x64-gnu',
      'node_modules/@swc/core-linux-x64-musl',
      'node_modules/@esbuild',
      'node_modules/sharp',
    ],
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

module.exports = withNextIntl(nextConfig);
