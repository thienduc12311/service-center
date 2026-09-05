import { z } from 'zod';

export const uuid = z.string().uuid();
export const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());
export const nonEmpty = z.string().trim().min(1);
export const musicalKey = z.string().trim().max(8);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

export const dateRangeSchema = z
  .object({ from: isoDateTime, to: isoDateTime })
  .refine((v) => new Date(v.from) < new Date(v.to), {
    message: '`from` must be before `to`',
    path: ['to'],
  });

export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
