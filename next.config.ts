import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the isolated auth integration server separate from an active dev server.
  typescript: { tsconfigPath: process.env.AUTH_TEST_TSCONFIG ?? "tsconfig.json" },
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    return ["/confirm", "/restore", "/reset-password"].map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] }));
  },
};

export default nextConfig;
