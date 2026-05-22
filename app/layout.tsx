import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { BooksProvider } from "@/context/BooksContext";

export const metadata: Metadata = {
  title: "Book Brain",
  description: "Your personal book notes library",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-parchment-50">
        <AuthProvider>
          <BooksProvider>{children}</BooksProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
