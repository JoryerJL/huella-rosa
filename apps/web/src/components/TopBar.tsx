import { es, roleLabel } from "../i18n/es";
import { useOnline } from "../lib/useOnline";
import { useSession } from "../lib/session";
import { useOutboxSummary, usePackageStatus, useSyncState } from "../data/hooks";
import { canSync, dismissSyncToast, syncNow } from "../data/sync";
import { useEffect } from "react";
import { Link } from "react-router";

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Connectivity pill plus pending-sync counter, always visible (CLAUDE.md, SPEC 6.8 item 7). */
export function TopBar() {
  const online = useOnline();
  const { profile, signOut } = useSession();
  const outbox = useOutboxSummary();
  const { sync, meta } = usePackageStatus();
  const syncState = useSyncState();

  // Block 4a: one toast line after changes were sent; it fades after a few seconds.
  useEffect(() => {
    if (!syncState.toast) return;
    const timer = window.setTimeout(dismissSyncToast, 6000);
    return () => window.clearTimeout(timer);
  }, [syncState.toast]);

  // WAITING ops stay pending: they are counted here and named below.
  const pendingLine =
    outbox.pending > 0
      ? es.sync.pending(outbox.pending)
      : sync.lastSyncAt
        ? es.sync.allSent(clock(sync.lastSyncAt))
        : es.sync.allSynced;
  const sinceLine =
    outbox.pending > 0 && outbox.oldestPendingAt
      ? es.sync.since(clock(outbox.oldestPendingAt))
      : sync.lastSyncAt
        ? null
        : es.sync.never;

  function onLogout() {
    if (outbox.pending > 0 && !window.confirm(es.sync.logoutWarning(outbox.pending))) return;
    void signOut();
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-white px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xl font-bold text-brand">{es.appName}</span>
        {/* The campaign every visit on this tablet goes to (SPEC 6.2 item 5). */}
        <span className="text-base text-muted">{meta ? meta.campaign.name : es.package.noPackageShort}</span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-base leading-tight" role="status" aria-live="polite">
          <strong className="block">{pendingLine}</strong>
          {sinceLine && <span className="text-muted">{sinceLine}</span>}
          {outbox.waitingSteps > 0 && (
            <span className="block font-semibold text-warn">{es.sync.waitingCount(outbox.waitingSteps)}</span>
          )}
          {outbox.failed.length > 0 && <span className="block font-semibold text-warn">{es.sync.failed(outbox.failed.length)}</span>}
          {syncState.toast && <span className="block font-semibold text-ok">{syncState.toast}</span>}
          {syncState.error && <span className="block max-w-xs font-semibold text-danger">{syncState.error}</span>}
        </div>
        {online && profile && canSync(profile.role) && (
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={syncState.running}
            className="min-h-12 rounded-lg border-2 border-brand px-4 font-semibold text-brand-strong hover:bg-blush disabled:opacity-50"
          >
            {syncState.running ? es.sync.syncing : es.sync.syncNow}
          </button>
        )}
        <span
          className={`rounded-full px-4 py-1 text-base font-semibold ${
            online ? "bg-green-100 text-ok" : "bg-gray-200 text-muted"
          }`}
          role="status"
        >
          {online ? `● ${es.online}` : `○ ${es.offline}`}
        </span>
        {profile && (
          <>
            <span className="text-base">
              <strong>{profile.name}</strong> · {roleLabel[profile.role]}
            </span>
            <Link to="/agents" className="flex min-h-12 items-center rounded-lg border border-line px-4 font-semibold hover:bg-surface">
              {es.agents.topBarLink}
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="min-h-12 rounded-lg border border-line px-4 font-semibold hover:bg-surface"
            >
              {es.logout}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
