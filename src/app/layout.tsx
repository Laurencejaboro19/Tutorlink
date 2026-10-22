import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "TutorLink — Find trusted tutors near you", template: "%s · TutorLink" },
  description: "TutorLink connects students with verified tutors in their area and online. Book, pay securely, learn, and grow.",
  icons: { icon: "/favicon.ico", apple: "/brand/icon-192.png" },
  openGraph: { images: ["/brand/og.png"], siteName: "TutorLink", type: "website" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#024ea2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-white text-ink-900">{children}</body>
    </html>
  );
}
