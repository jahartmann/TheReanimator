import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude native Node.js modules from bundling
  serverExternalPackages: ['ssh2', 'better-sqlite3'],
};

export default nextConfig;

