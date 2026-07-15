"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/auth-store";

interface AuthInitializerProps {
  user: { username: string };
}

export function AuthInitializer({ user }: AuthInitializerProps) {
  const { login } = useAuthStore();

  useEffect(() => {
    login(user.username);
  }, [user.username, login]);

  return null;
}
