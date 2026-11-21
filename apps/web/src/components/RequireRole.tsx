import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { ROLE_HOME, type Role } from "@er/shared";
import { useSession } from "../lib/session";

/** UI guard only. The server enforces roles on every API route. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useSession();
  if (!profile) return <Navigate to="/login" replace />;
  if (!roles.includes(profile.role)) return <Navigate to={ROLE_HOME[profile.role]} replace />;
  return <>{children}</>;
}
