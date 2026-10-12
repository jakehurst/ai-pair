// Bundles the extension and the relay it ships. `--production` minifies and drops source maps.

import * as fs from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
if (production) {
  fs.rmSync('dist', { recursive: true, force: true });
  // The package needs its license next to it; the source of truth is the repository's.
  fs.copyFileSync('../../LICENSE', 'LICENSE');
}

const common: esbuild.BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // The oldest VS Code the extension supports, 1.106, runs Node 22.20 (measured).
  target: 'node22',
  minify: production,
  sourcemap: !production,
  logLevel: 'warning',
  // jsonc-parser's `main` is a UMD build whose requires esbuild can't follow; its ES module build bundles.
  mainFields: ['module', 'main'],
};

await esbuild.build({ ...common, entryPoints: ['src/extension.ts'], external: ['vscode'], outfile: 'dist/extension.js' });
// The narration panel's page script, for the webview.
await esbuild.build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2025',
  minify: production,
  sourcemap: !production,
  logLevel: 'warning',
  entryPoints: ['src/webview/panel.ts'],
  outfile: 'dist/panel.js',
});
// The narration panel's page styles.
await esbuild.build({ minify: production, logLevel: 'warning', entryPoints: ['src/webview/panel.css'], outfile: 'dist/panel.css' });
// The relay tells agents the extension's version.
const manifest: unknown = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
  throw new Error('package.json has no version.');
}
await esbuild.build({
  ...common,
  entryPoints: ['../relay/src/main.ts'],
  loader: { '.md': 'text' },
  define: { AI_PAIR_VERSION: JSON.stringify(manifest.version) },
  outfile: 'dist/relay.js',
});
