// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';

import vercel from '@astrojs/vercel';

import tailwindcss from "@tailwindcss/vite";
import mdx from '@astrojs/mdx';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.habtronics.com',

  devToolbar: {
      enabled: false
    },

  integrations: [mdx()],

  adapter: vercel(),

  markdown: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeRaw],
  },

  vite: {
    plugins: [tailwindcss()],
  },
});