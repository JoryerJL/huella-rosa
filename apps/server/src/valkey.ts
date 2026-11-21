import Valkey from "iovalkey";
import { env } from "./env";

export const valkey = new Valkey(env.valkeyUrl, {
  // Fail fast when Valkey is down instead of hanging the request.
  maxRetriesPerRequest: 2,
});
