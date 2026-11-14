import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";

// Inter: tall x-height and open shapes read well at 13–16px on dense finance
// screens; tabular figures keep ₹ columns aligned. Geist Mono is used only
// for document numbers and IDs.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Satya · Accounts payable checks for Indian businesses", template: "%s · Satya" },
  description:
    "Satya checks every purchase order, delivery, invoice, payment and GST record before you pay — so finance teams at Indian manufacturers and distributors catch errors, meet MSME and GST deadlines, and can prove every number.",
  icons: { icon: "/satya.svg", shortcut: "/satya.svg", apple: "/satya.svg" },
  applicationName: "Satya",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c100f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={`h-full ${inter.variable} ${geistMono.variable}`}>
      <body className="h-full antialiased" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            {children}
            <Toaster position="top-center" richColors closeButton />
            {process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "1" && <Analytics />}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
