// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import rehypeCallouts from './plugins/rehype-callouts.mjs';

export default defineConfig({
  site: 'https://postliterate.org',

  // Posts that were published under an earlier slug.
  redirects: {
    '/blog/grab-and-hold': '/blog/catch-and-hold',
  },

  integrations: [mdx()],
  markdown: {
    rehypePlugins: [rehypeCallouts],
  },
});
