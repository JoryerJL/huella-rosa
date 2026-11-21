import { es } from "../i18n/es";

/** Co-brand: Huella Rosa stays the app name; EIRA is who it is made for. */
export function EiraCoBrand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src={`${import.meta.env.BASE_URL}brand/eira-logo.jpeg`}
        alt={es.brand.eiraAlt}
        width={60}
        height={60}
        className="h-[60px] w-[60px] shrink-0 rounded-xl"
      />
      <p className="text-lg text-muted">{es.brand.madeFor}</p>
    </div>
  );
}
