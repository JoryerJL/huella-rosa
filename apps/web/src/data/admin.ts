import type { AdminConflict, AdminMatch, DashboardResponse, PatientAuditEntry } from "@er/shared";
import { request } from "../lib/http";

// Administration reads and decisions go straight to the server: these screens are online-only (SPEC 6.9).

export async function fetchMatches(): Promise<AdminMatch[]> {
  return (await request<{ matches: AdminMatch[] }>("/api/matches?status=OPEN")).matches;
}

export function linkMatch(id: string, mainId: string) {
  return request<{ mainId: string; linkedId: string }>(`/api/matches/${encodeURIComponent(id)}/link`, {
    method: "POST",
    body: JSON.stringify({ mainId }),
  });
}

export function dismissMatch(id: string) {
  return request<{ ok: true }>(`/api/matches/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: "{}" });
}

export async function fetchConflicts(): Promise<AdminConflict[]> {
  return (await request<{ conflicts: AdminConflict[] }>("/api/conflicts?status=OPEN")).conflicts;
}

export function resolveConflict(id: string, choice: "server" | "device") {
  return request<{ ok: true }>(`/api/conflicts/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
}

export async function fetchPatientAudit(patientId: string): Promise<PatientAuditEntry[]> {
  return (await request<{ entries: PatientAuditEntry[] }>(`/api/audit?patientId=${encodeURIComponent(patientId)}`)).entries;
}

export function fetchDashboard(campaignId: string) {
  return request<DashboardResponse>(`/api/dashboard?campaignId=${encodeURIComponent(campaignId)}`);
}
