// Checks the Pair panel against Google's HTML/CSS Style Guide (#132): the page, rendered from
// panelHtml.ts, with html-validate (.htmlvalidate.json) and the W3C's Nu Html Checker (vnu), and the
// stylesheet with Stylelint (stylelint.config.ts) and vnu. `npm run lint:web` runs it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { FileSystemConfigLoader, formatterFactory, HtmlValidate } from 'html-validate/node';
import stylelint from 'stylelint';
import { config } from './stylelint.config.ts';
import type * as panelHtml from '../packages/vscode/src/panelHtml.ts';

const TEMPLATE = 'packages/vscode/src/panelHtml.ts';
const STYLESHEET = 'packages/vscode/src/webview/panel.css';
const VNU_JAR = 'node_modules/vnu-jar/build/dist/vnu.jar';
const PRETTIER_CONFIG = '.prettierrc.json';
/** The webview's `cspSource`, as VS Code gives it. */
const CSP_SOURCE = 'https://*.vscode-cdn.net';
/** The origin the webview's resources load from, as VS Code gives it. */
const RESOURCE_ORIGIN = 'https://file.vscode-resource.vscode-cdn.net';
/** vnu's CSS check rejects a gradient as a `mask`, which CSS Masking allows: a validator bug. */
const VNU_CSS_BUG = '.*mask.*radial-gradient.*';

/** Checks that `value` is a module with a `panelHtml` function, as the bundle of TEMPLATE is. */
function isPanelHtmlModule(value: unknown): value is typeof panelHtml {
  return typeof value === 'object' && value !== null && 'panelHtml' in value && typeof value.panelHtml === 'function';
}

/** Renders the page as `panelHtml` does, from the TypeScript source, bundled to a temporary module. */
async function renderPage(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'lint_web-'));
  try {
    const outfile = join(dir, 'panelHtml.mjs');
    await build({ entryPoints: [TEMPLATE], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
    const bundle: unknown = await import(pathToFileURL(outfile).href);
    if (!isPanelHtmlModule(bundle)) throw new Error(`${TEMPLATE} bundled with no panelHtml export.`);
    return bundle.panelHtml(CSP_SOURCE, `${RESOURCE_ORIGIN}/dist/panel.css`, `${RESOURCE_ORIGIN}/dist/panel.js`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs vnu on `args`, warnings counted as errors, and prints what it reports; returns whether it passed. */
function vnu(args: string[], input?: string): boolean {
  const result = spawnSync('java', ['-jar', VNU_JAR, '--Werror', '--format', 'gnu', ...args], { input, encoding: 'utf8' });
  if (result.error) throw result.error;
  process.stderr.write(result.stderr);
  return result.status === 0;
}

/** Returns the lines of `file` past Prettier's print width, which Prettier can't wrap inside a template literal. */
function longLines(file: string): string[] {
  const prettierConfig: unknown = JSON.parse(readFileSync(PRETTIER_CONFIG, 'utf8'));
  if (
    typeof prettierConfig !== 'object' ||
    prettierConfig === null ||
    !('printWidth' in prettierConfig) ||
    typeof prettierConfig.printWidth !== 'number'
  ) {
    throw new Error(`${PRETTIER_CONFIG} has no printWidth.`);
  }
  const printWidth = prettierConfig.printWidth;
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.flatMap((line, i) => (line.length > printWidth ? [`${file}:${i + 1}: over ${printWidth} columns`] : []));
}

const stylelintResult = await stylelint.lint({ config, files: STYLESHEET, formatter: 'string' });
process.stderr.write(stylelintResult.report);
const page = await renderPage();
const report = await new HtmlValidate(new FileSystemConfigLoader()).validateString(page, 'panel.html');
if (!report.valid) process.stderr.write(formatterFactory('text')(report.results));
const pageValid = vnu(['-'], page);
const stylesheetValid = vnu(['--css', '--filterpattern', VNU_CSS_BUG, STYLESHEET]);
const long = longLines(TEMPLATE);
for (const line of long) {
  console.error(line);
}
if (stylelintResult.errored || !report.valid || !pageValid || !stylesheetValid || long.length > 0) process.exitCode = 1;
