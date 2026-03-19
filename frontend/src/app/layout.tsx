import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { Providers } from "@/components/providers"

export const metadata: Metadata = {
  title: 'CodeForge — Code Together, Ship Faster',
  description: 'Real-time collaborative IDE. Every keystroke shared instantly across your team. Build and ship from anywhere.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%2306090F'/><path d='M8 16 L14 10 L14 22 Z' fill='%234169E1'/><path d='M16 10 L28 16 L16 22 L16 16 L22 16' fill='%235B8AFF' stroke='%235B8AFF' strokeWidth='1'/></svg>" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#06090F" />
        <meta name="msapplication-navbutton-color" content="#06090F" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="antialiased" style={{ colorScheme: 'dark', overflow: 'hidden' }}>
        <Providers>
          {children}
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
