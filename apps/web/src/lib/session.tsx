import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isRole, type StaffProfile } from "@er/shared";
import { api } from "./api";

// The profile is cached on the device so the app keeps working without internet.
// The server stays the authority: every API call re-checks the role (SPEC 6.8).

const PROFILE_KEY = "er.profile";

function loadProfile(): StaffProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw) as StaffProfile;
    return isRole(profile.role) ? profile : null;
  } catch {
    return null;
  }
}

function saveProfile(profile: StaffProfile | null) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Storage unavailable: the session still works for this tab.
  }
}

interface SessionValue {
  profile: StaffProfile | null;
  signIn: (profile: StaffProfile) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<StaffProfile | null>(loadProfile);

  // With signal, confirm the server session is still valid.
  useEffect(() => {
    if (!profile || !navigator.onLine) return;
    api.api.auth.me
      .$get()
      .then((res) => {
        if (res.status === 401) {
          saveProfile(null);
          setProfile(null);
        }
      })
      .catch(() => {
        // Network error: keep working with the cached profile.
      });
  }, [profile]);

  const signIn = useCallback((next: StaffProfile) => {
    saveProfile(next);
    setProfile(next);
  }, []);

  const signOut = useCallback(async () => {
    await api.api.auth.logout.$post().catch(() => undefined);
    saveProfile(null);
    setProfile(null);
  }, []);

  return (
    <SessionContext.Provider value={{ profile, signIn, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
