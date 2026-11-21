import { getDeviceId } from "./device";
import { es } from "../i18n/es";

/** Error carrying a plain Spanish message that can be shown as is. Status 0 means no connection. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** JSON request to our API with the session cookie and the device id. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}
