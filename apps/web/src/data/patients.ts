import type {
  CampaignView,
  PatientRecord,
  SearchQuery,
  SearchResponse,
  SyncOp,
  SyncPushResponse,
} from "@er/shared";
import { getDeviceId } from "../lib/device";
import { es } from "../i18n/es";

// The only module that talks to the API for patients, visits and campaigns.
// Block 2 swaps these functions to read and write IndexedDB first.

/** Error carrying a plain Spanish message that can be shown as is. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        "x-device-id": getDeviceId(),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(es.errors.network, 0);
  }

  if (!res.ok) {
    let message: string = res.status === 401 ? es.errors.sessionExpired : es.errors.generic;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Body was not JSON: keep the generic message.
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export function searchPatients(query: SearchQuery): Promise<SearchResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  return request<SearchResponse>(`/api/patients/search?${params.toString()}`);
}

export function getPatientRecord(id: string): Promise<PatientRecord> {
  return request<PatientRecord>(`/api/patients/${encodeURIComponent(id)}`);
}

export function listCampaigns(): Promise<CampaignView[]> {
  return request<CampaignView[] | { campaigns: CampaignView[] }>("/api/campaigns").then((data) =>
    Array.isArray(data) ? data : data.campaigns,
  );
}

export function pushOps(ops: SyncOp[]): Promise<SyncPushResponse> {
  return request<SyncPushResponse>("/api/sync/push", {
    method: "POST",
    body: JSON.stringify({ ops }),
  });
}

/** Common fields every op needs (CLAUDE.md: ids from the device, informative timestamp). */
export function opMeta() {
  return { opId: crypto.randomUUID(), deviceId: getDeviceId(), at: new Date().toISOString() };
}
