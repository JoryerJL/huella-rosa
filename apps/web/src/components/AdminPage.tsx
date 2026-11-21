import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { Page } from "./Page";
import { Card } from "./ui";
import { useOnline } from "../lib/useOnline";
import { useSession } from "../lib/session";
import { es } from "../i18n/es";

const NAV = [
  { to: "/admin", label: es.admin.nav.home, end: true },
  { to: "/admin/matches", label: es.admin.nav.matches, end: false },
  { to: "/admin/conflicts", label: es.admin.nav.conflicts, end: false },
  { to: "/admin/audit", label: es.admin.nav.audit, end: false },
  { to: "/admin/staff", label: es.admin.nav.staff, end: false },
  { to: "/admin/campaigns", label: es.admin.nav.campaigns, end: false },
];

/** Administration screens need signal (SPEC 6.9): offline they show one plain message instead. */
export function AdminPage({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const online = useOnline();
  const { profile } = useSession();
  const isAdmin = profile?.role === "admin";
  return (
    <Page title={title} subtitle={subtitle}>
      {isAdmin && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label={es.admin.nav.home}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `min-h-12 rounded-full px-5 py-2 text-base font-semibold ${
                  isActive ? "bg-brand text-white" : "border-2 border-line bg-white hover:bg-blush"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
      {online ? (
        children
      ) : (
        <Card>
          <p className="text-2xl font-bold">{es.admin.needsSignal}</p>
          <p className="mt-2 text-muted">{es.admin.needsSignalBody}</p>
        </Card>
      )}
    </Page>
  );
}

export function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getDate()} ${es.months[d.getMonth()]} ${time}`;
}
