import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

interface AuthState {
  isLoggedIn: boolean
  username: string | null
  role: string | null
  permissions: string[] | null
  login: (username: string) => void
  setPermissions: (role: string | null, permissions: string[]) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      username: null,
      role: null,
      permissions: null,
      login: (username) => set({ isLoggedIn: true, username }),
      setPermissions: (role, permissions) => set({ role, permissions }),
      logout: () =>
        set({ isLoggedIn: false, username: null, role: null, permissions: null }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
)