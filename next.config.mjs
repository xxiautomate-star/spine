/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // better-sqlite3 is a native node module used by /api/dogfood/diary.
  // Without this, Next's webpack bundler tries to inline it and the
  // .node binding fails to load at runtime. Marking it as an external
  // server package makes Next leave the require as-is.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
