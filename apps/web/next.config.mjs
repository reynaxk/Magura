/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@magura/shared'],
  output: 'standalone',
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  async headers() {
    return [{ source: '/(.*)', headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self)' }] }];
  },
};
export default nextConfig;
