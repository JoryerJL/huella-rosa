import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isRole, type StaffProfile } from "@er/shared";
import { api } from "./api";

// The profile is cached on the device so the app keeps working without internet, for up to
// 4 days (SPEC 6.8). The server stays the authority: every API call and sync re-checks the role.

const PROFILE_KEY = "er.profile";
const SESSION_MAX_MS = 4 * 24 * 60 * 60 * 1000;

function loadProfile(): StaffProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { profile?: StaffProfile; savedAt?: string };
    const profile = saved.profile;
    if (!profile || !isRole(profile.role) || !saved.savedAt) return null;
    if (Date.now() - new Date(saved.savedAt).getTime() > SESSION_MAX_MS) return null;
    return profile;
  } catch {
    return null;
  }
}

function saveProfile(profile: StaffProfile | null, savedAt = new Date().toISOString()) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify({ profile, savedAt }));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Storage unavailable: the session still works for this tab.
  }
}

interface SessionValue {
  profile: StaffProfile | null;
  /** `savedAt`: when the server last validated this person (offline unlock keeps the online time). */
  signIn: (profile: StaffProfile, savedAt?: string) => void;
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

  const signIn = useCallback((next: StaffProfile, savedAt?: string) => {
    saveProfile(next, savedAt);
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
