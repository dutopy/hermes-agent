/**
 * Roadmaps plugin — esbuild build script.
 *
 * Bundles src/ into the single deliverable plugin.js that the desktop
 * runtime loader reads. The loader loads ONLY the text of plugin.js as a
 * blob URL (no filesystem), so every relative import must be resolved by
 * the bundle; the only imports left in the output are the loader-rewritten
 * bare specifiers @hermes/plugin-sdk, react and react/jsx-runtime (kept
 * external on purpose). src/config.json is embedded at build time.
 *
 * Run from this directory:
 *   node build.mjs
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))

const banner = `/**
 * Roadmaps — disk-mode Desktop plugin (branch feat/roadmaps).
 *
 * BUILT ARTIFACT — do not edit by hand. Source lives in src/; settings live
 * in src/config.json (embedded at build time). Rebuild with: node build.mjs
 * (esbuild bundle, format=esm, external @hermes/plugin-sdk / react /
 * react/jsx-runtime — the runtime loader rewrites those bare specifiers).
 */`

await build({
  entryPoints: [join(dir, 'src/index.js')],
  bundle: true,
  format: 'esm',
  outfile: join(dir, 'plugin.js'),
  // Pin the working dir so module-path comments in the output are stable
  // and the artifact is byte-identical regardless of where build.mjs runs.
  absWorkingDir: dir,
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  loader: { '.json': 'json' },
  banner: { js: banner },
  minify: false,
  sourcemap: false,
  logLevel: 'info'
})
