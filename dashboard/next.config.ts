import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Next 16 walks up looking for a workspace root; both the parent repo and
  // this dir have a pnpm-workspace.yaml, which triggers a "multiple lockfiles"
  // warning. Pin the dashboard's Turbopack root so the build graph stays
  // inside dashboard/ and the warning disappears.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
