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
        <meta name="base:app_id" content={process.env.NEXT_PUBLIC_BASE_APP_ID ?? "[base.dev Verify token]"} />
      </head>
      <body className="min-h-full bg-[#08090c] text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
