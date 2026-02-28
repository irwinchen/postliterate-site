import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    status: z.enum(['draft', 'published']),
    tags: z.array(z.string()).optional(),
    social: z.string().optional(),
  }),
});

export const collections = { blog };
