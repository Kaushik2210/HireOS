import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { CspNonce } from "@/components/shell/csp-nonce";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "HireOS", template: "%s · HireOS" },
  description:
    "Find roles, see why they fit, tailor materials truthfully, and keep every application in one place. Nothing is sent without you.",
  applicationName: "HireOS",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#090b10",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content Security Policy nonce is minted per request in proxy.ts, so every page is
  // rendered per request: a statically built page could not carry it. Reading the header
  // makes this layout dynamic.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh antialiased">
        <CspNonce nonce={nonce} />
        {children}
      </body>
    </html>
  );
}
