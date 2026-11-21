import { es, roleLabel } from "../i18n/es";
import { useOnline } from "../lib/useOnline";
import { useSession } from "../lib/session";

export function TopBar() {
  const online = useOnline();
  const { profile, signOut } = useSession();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-6 py-3">
      <span className="text-xl font-bold text-brand">{es.appName}</span>
      <div className="flex items-center gap-4">
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
            <button
              type="button"
              onClick={() => void signOut()}
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
