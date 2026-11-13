/** @type {import('next').NextConfig} */
const nextConfig = {
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
