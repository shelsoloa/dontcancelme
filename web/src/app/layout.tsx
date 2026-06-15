import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Space Mono is a static font — weight is required (no variable axis).
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "dontcancel.me",
  description:
    "dontcancel.me scans your X timeline and flags risky posts before they come back to haunt you.",
  openGraph: {
    title: "dontcancel.me",
    description:
      "Scan your X timeline for risky posts before they come back to haunt you.",
    url: "https://dontcancel.me",
    siteName: "dontcancel.me",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "dontcancel.me",
    description:
      "Scan your X timeline for risky posts before they come back to haunt you.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${spaceMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Anti-FOUC: apply the correct theme class before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');if(s==='dark'||(!s&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}<Analytics /></body>
    </html>
  );
}
