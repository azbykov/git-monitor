import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Включает директиву "use cache" — ею кэшируются запросы к GitHub (src/lib/cache-tags.ts)
  cacheComponents: true,
};

export default nextConfig;
