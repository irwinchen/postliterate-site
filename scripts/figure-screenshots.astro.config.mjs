/**
 * DEPRECATED — safe to delete this file.
 *
 * An earlier version of scripts/figure-screenshots.mjs tried to run a local
 * `astro build` from inside a sandboxed scheduled task and needed this custom
 * Astro config to relocate Vite's cache. The script now screenshots the live
 * postliterate.org site instead, so this file is unused.
 *
 * It is only still here because the sandbox the script was developed in could
 * create files but not delete them. Remove it with: rm scripts/figure-screenshots.astro.config.mjs
 */
export default {};
