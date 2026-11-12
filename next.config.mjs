/** @type {import('next').NextConfig} */
const nextConfig = {
  // v24.7: the share image route reads its font files from disk, so tell the build to ship them with that route.
  experimental: { outputFileTracingIncludes: { "/api/meter-card": ["./lib/fonts/**/*"] } },
};

export default nextConfig;
