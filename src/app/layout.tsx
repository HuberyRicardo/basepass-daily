import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BasePass Daily",
  description: "Discover perks. Earn points. Unlock rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full bg-[#08090c] antialiased`}>
      <head>
        <meta name="base:app_id" content="6a605ba7078f6baf9ef30122" />
        <meta
          name="talentapp:project_verification"
          content="8f6e47432b38ff78ed53b0c1d3f2b317cb9c6f12034ea8c2db8ee9346584184f2516f8902fb72541f6ea88fbeccafed9876750ec775430d194db37d1c6b86a12"
        />
      </head>
      <body className="min-h-full bg-[#08090c] text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
