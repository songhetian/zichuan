import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

interface AuthState {
  isLoggedIn: boolean
  username: string | null
  login: (username: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      username: null,
      login: (username) => set({ isLoggedIn: true, username }),
      logout: () => set({ isLoggedIn: false, username: null }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
)