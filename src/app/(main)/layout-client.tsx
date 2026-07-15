"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useAuthStore } from "@/store/auth-store";

export default function MainLayoutClient({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { login } = useAuthStore();

  useEffect(() => {
    login(username);
  }, [username, login]);

  return (
    <div className="flex h-screen">
      <Sidebar mobileOpen={mobileMenuOpen} />
      <div className="flex flex-1 flex-col">
        <Header mobileMenuOpen={mobileMenuOpen} onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${
          mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />
    </div>
  );
}
