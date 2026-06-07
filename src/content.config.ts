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
    bsky_post: z.string().optional(),
    // POSSE syndication targets. Optional; default none. See scripts/syndicate.mjs.
    syndicate: z.array(z.enum(['mastodon', 'bluesky'])).optional(),
    // Syndication blurb. Falls back to `description`, then the first paragraph.
    excerpt: z.string().optional(),
  }),
});

export const collections = { blog };
