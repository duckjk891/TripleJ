/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile Phaser for client-side usage
  transpilePackages: ['phaser'],

  // Webpack configuration for Phaser
  webpack: (config, { isServer }) => {
    // Phaser needs to run only on client-side
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('phaser');
    }

    return config;
  },

  // Enable React strict mode
  reactStrictMode: true,

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/**',
      },
    ],
  },

  // Experimental features
  experimental: {
    // Enable server actions if needed
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
