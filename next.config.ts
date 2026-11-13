/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles the server and its traced dependencies so the
  // package can run without shipping the full source tree/node_modules.
  output: "standalone",
  // The browser session is a long-lived process. Next's dev server must not
  // cache the API routes that talk to it.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
