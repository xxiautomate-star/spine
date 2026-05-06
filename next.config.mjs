/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'standalone' was for Docker/Coolify self-hosting. Vercel uses
  // its own output format — leaving this set causes 404 NOT_FOUND on every
  // route because Vercel doesn't read .next/standalone/.
  reactStrictMode: true,
  // better-sqlite3 is a native node module used by /api/dogfood/diary.
  // Without this, Next's webpack bundler tries to inline it and the
  // .node binding fails to load at runtime. Marking it as an external
  // server package makes Next leave the require as-is.
  serverExternalPackages: ['better-sqlite3'],
  async redirects() {
    return [
      // /benchmarks was an early proposed name for the harness page. The
      // page lives at /proof — keep both URLs from going dark when
      // someone shares the older link.
      { source: '/benchmarks', destination: '/proof', permanent: true },
    ];
  },
};

export default nextConfig;
