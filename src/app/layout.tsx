import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Muse AI Webapp",
  description:
    "Meta's Muse agent, driven through a Firefox/Gecko browser backend you can watch and take over.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased flex flex-col min-h-screen bg-black text-white">
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
