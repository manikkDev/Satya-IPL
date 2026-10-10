import type { CSSProperties } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";

const fontVariables = {
  "--font-epilogue": "Inter, ui-sans-serif, system-ui, sans-serif",
  "--font-geist-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "--font-playfair": "Georgia, Cambria, Times New Roman, serif",
  "--font-silkscreen": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
} as CSSProperties;

export const metadata: Metadata = {
  title: "Satya · Evidence-led Business Operations",
  description: "Reconstruct orders, receipts, invoices and payments with traceable evidence. Built for Indian business operations.",
  icons: {
    icon: "/satya.svg",
    shortcut: "/satya.svg",
    apple: "/satya.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body
        className="antialiased h-full"
        style={fontVariables}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
        >
          <div className="relative min-h-full">
            <AuthProvider>
              {children}
              <Toaster position="top-center" richColors />
              {process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === '1' && <Analytics />}
            </AuthProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
