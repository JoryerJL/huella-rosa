import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Role, ServiceType } from "@er/shared";

// Form templates (plantillas/*.json), read once. Each clinical field declares `filledBy`:
// the only specialist role allowed to write it (SPEC 6.3.1, item 3). Enforced on the server.

interface TemplateField {
  clave: string;
  filledBy?: string;
}

interface Template {
  id: string;
  servicio?: string;
  campos: TemplateField[];
}

const TEMPLATES_DIR = fileURLToPath(new URL("../../../plantillas/", import.meta.url));

const TEMPLATE_BY_SERVICE: Record<ServiceType, string> = {
  BREAST_REVIEW: "revision-mamaria-eira",
  ULTRASOUND: "revision-mamaria-eira",
  MAMMOGRAPHY: "revision-mamaria-eira",
  PAP: "citologia-cervical-eira",
};

let cache: Map<string, Template> | null = null;

function loadTemplates(): Map<string, Template> {
  if (cache) return cache;
  const templates = new Map<string, Template>();
  for (const file of readdirSync(TEMPLATES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const value = JSON.parse(readFileSync(`${TEMPLATES_DIR}${file}`, "utf8")) as Partial<Template>;
    // mensajes.json and other non-template files have no `campos`.
    if (typeof value.id === "string" && Array.isArray(value.campos)) {
      templates.set(value.id, value as Template);
    }
  }
  cache = templates;
  return templates;
}

export function templateIdForService(type: ServiceType): string {
  return TEMPLATE_BY_SERVICE[type];
}

/** Keys of the template fields this role fills. Empty for unknown templates or non-clinical roles. */
export function fieldsFor(templateId: string, role: Role): string[] {
  const template = loadTemplates().get(templateId);
  if (!template) return [];
  return template.campos.filter((f) => f.filledBy === role).map((f) => f.clave);
}
