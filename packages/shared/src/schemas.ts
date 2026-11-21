import { z } from "zod";

export const loginSchema = z.object({
  /** Staff username (never a list on screen). Case-insensitive. */
  username: z.string().trim().toLowerCase().min(3).max(40),
  pin: z.string().regex(/^\d{4,6}$/),
});
export type LoginInput = z.infer<typeof loginSchema>;
