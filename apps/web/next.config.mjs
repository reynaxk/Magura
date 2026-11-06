/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@magura/shared'],
  output: 'standalone',
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // magura.app/ is the static landing page (public/landing.html); the app lives at /trenches, /trending, …
  async rewrites() {
    return { beforeFiles: [{ source: '/', destination: '/landing.html' }] };
  },
  async headers() {
    return [{ source: '/(.*)', headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self)' }] }];
  },
};
export default nextConfig;
