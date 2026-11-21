const DEVICE_KEY = "er.deviceId";

/** Stable id of this device, sent with every request and stored in the audit log. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}
