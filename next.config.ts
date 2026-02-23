import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude native Node.js modules from bundling (Webpack supports this without junctions)
  serverExternalPackages: ['ssh2', 'better-sqlite3'],
};

export default nextConfig;

