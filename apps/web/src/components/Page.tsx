import type { ReactNode } from "react";
import { TopBar } from "./TopBar";

export function Page({
  title,
  subtitle,
  leading,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Left of the title, e.g. a "Regresar" button. */
  leading?: ReactNode;
  /** Right of the title, e.g. the screen's main action. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-5">
            {leading}
            <div>
              <h1 className="text-3xl font-bold">{title}</h1>
              {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </div>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
