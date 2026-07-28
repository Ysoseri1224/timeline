import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://luckyrong.ysoseri.us',
  base: '/timeline',
  trailingSlash: 'always',
  output: 'static',
  integrations: [react()],
});
