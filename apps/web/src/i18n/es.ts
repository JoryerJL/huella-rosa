import type { Role } from "@er/shared";

// All visible UI text lives here (language rule in CLAUDE.md).

export const roleLabel: Record<Role, string> = {
  intake: "Captura",
  clinician: "Consulta clínica",
  admin: "Administración",
};

export const es = {
  appName: "Expediente Rosa",
  online: "Con señal",
  offline: "Sin señal",
  logout: "Salir",
  login: {
    title: "¿Quién va a trabajar?",
    subtitle: "Elige tu usuario y escribe tu PIN.",
    pinLabel: "PIN",
    submit: "Entrar",
    loading: "Entrando…",
    demoHint: "Usuarios de demostración. PIN: 1234",
    offlineHint: "Para entrar por primera vez necesitas señal.",
    genericError: "No pudimos entrar. Revisa tu señal e intenta de nuevo.",
  },
  intake: {
    title: "Identificar paciente",
    subtitle: "Primero busca a la paciente. El registro nuevo aparece solo si no la encuentras.",
    comingSoon: "La búsqueda llega en el siguiente bloque.",
  },
  patients: {
    title: "Buscar expediente",
    subtitle: "Consulta el historial completo de una paciente.",
    comingSoon: "La búsqueda de expedientes llega en el siguiente bloque.",
  },
  audit: {
    title: "Bitácora",
    subtitle: "Quién hizo qué, cuándo y desde qué dispositivo.",
    empty: "Todavía no hay movimientos.",
    when: "Cuándo",
    who: "Quién",
    action: "Acción",
    device: "Dispositivo",
    detail: "Detalle",
    loadError: "No pudimos cargar la bitácora. Revisa tu señal.",
  },
};
