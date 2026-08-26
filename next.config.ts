import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['sharp'],
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
};

export default nextConfig;
