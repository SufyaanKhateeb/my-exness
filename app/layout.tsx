import { Inter } from "next/font/google";
import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Auth0 Next.js App",
  description: "Next.js app with Auth0 authentication",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Auth0Provider audience={process.env.NEXT_PUBLIC_AUTH0_AUDIENCE}>
          <Providers>
            {children}
          </Providers>
        </Auth0Provider>
      </body>
    </html>
  );
}