import { createContext, useContext, useState } from 'react';
import { getToken, getStoredUser, saveAuth, clearAuth } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());

  const signIn = (token, userInfo) => {
    saveAuth(token, userInfo);
    setUser(userInfo);
  };

  const signOut = () => {
    clearAuth();
    setUser(null);
  };

  const isAuthed = Boolean(getToken() && user && user.role === 'admin');

  return (
    <AuthContext.Provider value={{ user, isAuthed, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
