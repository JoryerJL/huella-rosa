import { z } from "zod";

export const loginSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
});
export type LoginInput = z.infer<typeof loginSchema>;
