import { z } from 'zod'

export const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n, 'Invalid cursor')
