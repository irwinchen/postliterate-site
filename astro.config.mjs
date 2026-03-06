// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import rehypeCallouts from './plugins/rehype-callouts.mjs';

export default defineConfig({
  site: 'https://postliterate.org',
  integrations: [mdx()],
  markdown: {
    rehypePlugins: [rehypeCallouts],
  },
});
