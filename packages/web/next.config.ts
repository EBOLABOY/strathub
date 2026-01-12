
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@crypto-strategy-hub/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: (process.env.API_URL || 'http://localhost:3000') + '/api/:path*',
      },
    ];
  },
};

export default nextConfig;
