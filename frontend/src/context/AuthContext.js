import { createContext, useContext, useEffect, useState } from "react";
import api, {
  clearAccessToken,
  formatApiError,
  refreshAccessToken,
  setAccessToken,
} from "@/lib/api";
import { syncLanguage } from "@/i18n";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clearAccessToken();
    refreshAccessToken()
      .then((data) => {
        const changed = syncLanguage(data.user?.language);
        setUser(data.user);
        if (changed) window.location.reload();
      })
      .catch(() => clearAccessToken())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setAccessToken(data.token);
    syncLanguage(data.user?.language);
    setUser(data.user);
    return data.user;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    return data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Local cleanup must still happen if the session already expired.
    }
    clearAccessToken();
    setUser(null);
  };

  const refreshMe = async () => {
    const { data } = await api.get("/auth/me");
    setUser(data);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout, refreshMe, formatApiError }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
