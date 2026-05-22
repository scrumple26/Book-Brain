import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "Book Brain",
  description: "Your personal book notes library",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-parchment-50">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
