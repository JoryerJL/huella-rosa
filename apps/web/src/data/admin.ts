import type {
  AdminConflict,
  AdminMatch,
  CampaignListItem,
  CreateCampaignInput,
  CreateStaffInput,
  DashboardResponse,
  LocalityView,
  PatientAuditEntry,
  StaffView,
  UpdateCampaignInput,
} from "@er/shared";
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

// ---------- Staff and campaigns (SPEC 6.0) ----------

export async function fetchStaff(): Promise<StaffView[]> {
  return (await request<{ staff: StaffView[] }>("/api/staff")).staff;
}

/** The PIN goes to the server once and is never stored or shown again by the app. */
export async function createStaff(input: CreateStaffInput): Promise<StaffView> {
  return (await request<{ staff: StaffView }>("/api/staff", { method: "POST", body: JSON.stringify(input) })).staff;
}

export async function setStaffActive(id: string, active: boolean): Promise<StaffView> {
  const action = active ? "reactivate" : "deactivate";
  return (await request<{ staff: StaffView }>(`/api/staff/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" })).staff;
}

export function fetchAdminCampaigns(): Promise<CampaignListItem[]> {
  return request<CampaignListItem[]>("/api/campaigns");
}

export async function fetchLocalities(): Promise<LocalityView[]> {
  return (await request<{ localities: LocalityView[] }>("/api/localities")).localities;
}

export async function createCampaign(input: Partial<CreateCampaignInput>): Promise<CampaignListItem> {
  return (await request<{ campaign: CampaignListItem }>("/api/campaigns", { method: "POST", body: JSON.stringify(input) })).campaign;
}

export async function updateCampaign(id: string, input: UpdateCampaignInput): Promise<CampaignListItem> {
  return (
    await request<{ campaign: CampaignListItem }>(`/api/campaigns/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  ).campaign;
}
