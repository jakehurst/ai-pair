// Releases the version on main: checks the repository, then tags the commit and pushes the tag.
// The tag starts .github/workflows/publish.yml, which builds both extensions, publishes them to
// the Marketplace, and makes the GitHub release with them (#68).
//
//   npm run release [-- --yes]
//
// The version is the one in packages/vscode/package.json, which the pull request that made the
// change bumped, with its section in packages/vscode/CHANGELOG.md. Nothing is built or published
// from this machine, and main is not pushed: only the tag is.

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXTENSION = 'packages/vscode';
const COMPANION = 'packages/audio-ui';
const CHANGELOG = `${EXTENSION}/CHANGELOG.md`;
const VERSION = /^\d+\.\d+\.\d+$/;
/** Where the publishing run that the tag starts is shown. */
const WORKFLOW = 'https://github.com/mattyv/ai-pair/actions/workflows/publish.yml';

interface Manifest {
  publisher: string;
  name: string;
  version: string;
}

/** Runs `cmd` with `args` in the repository, its output shown. */
function run(cmd: string, args: string[], opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
}

/** Runs `cmd` with `args` in the repository and returns its output, trimmed. */
function read(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Prints why the release stopped, and exits. */
function fail(message: string): never {
  console.error(`\nFailed: ${message}`);
  process.exit(1);
}

/** Prints `message` as the heading of the next step. */
function step(message: string) {
  console.log(`\n> ${message}`);
}

/** Checks that `value` has the manifest fields the release reads, each a string. */
function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'publisher' in value &&
    typeof value.publisher === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'version' in value &&
    typeof value.version === 'string'
  );
}

/** Reads the manifest of the extension in `folder`, failing if it lacks a field the release reads. */
function manifest(folder: string): Manifest {
  const file = `${folder}/package.json`;
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  if (!isManifest(parsed)) return fail(`${file} needs a publisher, a name, and a version.`);
  return parsed;
}

/** Returns the body of the changelog's section for `version`, without its heading. */
function notes(version: string): string | undefined {
  const text = fs.readFileSync(path.join(ROOT, CHANGELOG), 'utf8');
  const sections = text.split(/^## /m).slice(1);
  const section = sections.find((s) => s.split('\n', 1)[0]?.trim() === version);
  return section?.slice(section.indexOf('\n') + 1).trim();
}

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const unknown = args.filter((arg) => arg !== '--yes');
if (unknown.length) fail('Usage: npm run release [-- --yes]');

const { publisher, name, version } = manifest(EXTENSION);
const companion = manifest(COMPANION);
if (!VERSION.test(version)) fail(`${version} is not an x.y.z version.`);
if (companion.version !== version) fail(`${companion.name} is at ${companion.version}, and ${name} at ${version}: they release together.`);
const tag = `v${version}`;

step('Checking the repository');
if (read('git', ['branch', '--show-current']) !== 'main') fail('Release from main.');
// Not `read`: trimming would take the first line's leading status column.
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trimEnd();
if (dirty !== '') fail(`Commit or stash these first:\n${dirty}`);
run('git', ['fetch', '--quiet', '--tags', 'origin', 'main']);
if (read('git', ['rev-parse', 'HEAD']) !== read('git', ['rev-parse', 'origin/main'])) {
  fail("main isn't the same as origin/main: pull first.");
}
if (read('git', ['tag', '--list', tag])) fail(`${tag} is already tagged: a change that ships bumps the version in its pull request.`);
const changes = notes(version);
if (changes === undefined || changes === '') fail(`${CHANGELOG} has no section for ${version}: add "## ${version}" with what changed.`);

if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nTag ${tag} and push it? That publishes ${publisher}.${name} and ${publisher}.${companion.name} ${version} to the Marketplace; a version can't be published twice. [y/N] `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') fail('Not tagged.');
}

step(`Tagging ${tag}`);
run('git', ['tag', '-a', tag, '-m', `Release ${version}`]);

step('Pushing the tag');
try {
  run('git', ['push', '--quiet', 'origin', tag]);
} catch {
  // Nothing has left this machine: take the tag back.
  run('git', ['tag', '-d', tag], { stdio: 'ignore' });
  fail(`Pushing ${tag} failed; the tag is undone. Fix it, then: npm run release`);
}

console.log(`\nTagged ${version}. Publishing runs at ${WORKFLOW}`);
console.log(`When it finishes: https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}`);
