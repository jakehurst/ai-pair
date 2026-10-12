// @vitest-environment happy-dom
// Every rule in panel.css matches the page in some state it reaches, and every class the page
// script toggles has a rule: the stylesheet's coverage, written to coverage/css/summary.json for
// COVERAGE.md. A rule nothing matches is dead or misspelled.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import type { Window } from 'happy-dom';
import { loadPage, ui } from './page';

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window['document'] };

const STYLESHEET = path.join(import.meta.dirname, '../src/webview/panel.css');
const SUMMARY = path.join(import.meta.dirname, '../../../coverage/css/summary.json');
/** Pseudo-classes and pseudo-elements of interaction and rendering, which no state of the document shows. */
const UNMATCHABLE = /:(hover|focus-visible|focus-within|focus|active)\b|::?(before|after|placeholder)\b/g;
/** A selector that is only such a pseudo, like `:root`, after the strip. */
const EMPTY_COMPOUND = /^\s*$|^\s*>/;

/** Returns a selector list's selectors: split at the commas outside parentheses. */
function splitSelectors(list: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      found.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  found.push(list.slice(start).trim());
  return found;
}

/** Returns the stylesheet's rule selectors, each split at the commas, with keyframe selectors left out. */
function selectors(css: string): string[] {
  const plain = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  let depth = 0;
  let inKeyframes = false;
  let start = 0;
  for (let i = 0; i < plain.length; i++) {
    const char = plain[i];
    if (char === '{') {
      const head = plain.slice(start, i).trim();
      if (depth === 0 && head.startsWith('@keyframes')) inKeyframes = true;
      if (!head.startsWith('@') && !inKeyframes) found.push(...splitSelectors(head));
      depth++;
      start = i + 1;
    } else if (char === '}') {
      depth--;
      if (depth === 0) inKeyframes = false;
      start = i + 1;
    } else if (char === ';') {
      start = i + 1;
    }
  }
  return found;
}

/** Returns a selector as the document can match it: without the pseudo-classes of interaction. */
function matchable(selector: string): string {
  return selector
    .split(/(?=[\s>+~])/)
    .map((part) => {
      const stripped = part.replaceAll(UNMATCHABLE, '');
      return EMPTY_COMPOUND.test(stripped) ? part.replace(/[^\s>+~].*/, '*') : stripped;
    })
    .join('');
}

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent('message', { data: event }));
}

/** The page's states, one message at a time; the selectors are checked after each. */
const SCENARIO: object[] = [
  { type: 'canStart', value: true },
  { type: 'session', active: false, reason: 'agent', summary: 'Done: the API has its tests.' },
  { type: 'session', active: true, task: 'Add tests', rules: ['.ai-pair/GUIDE.md'] },
  { type: 'state', state: 'typing', turn: 'agent', paused: false },
  { type: 'say', text: 'Typing the test for `createTodo` in `src/todos.ts`, then a link: https://example.com.' },
  { type: 'reading', ms: 4000 },
  { type: 'state', state: 'read', turn: 'agent', paused: false },
  { type: 'state', state: 'thinking', turn: 'agent', paused: false },
  { type: 'state', state: 'running', turn: 'agent', paused: false },
  { type: 'state', state: 'absent', turn: 'agent', paused: false },
  { type: 'state', state: 'listening', turn: 'agent', paused: false },
  { type: 'state', state: 'typing', turn: 'agent', paused: true },
  { type: 'state', state: 'navigator', turn: 'user', paused: false },
  { type: 'turn', to: 'user', message: 'Your turn: fix the import.', ref: { file: 'src/todos.ts', line: 3, endLine: 5 } },
  { type: 'user', text: 'Looks good.', ref: { file: 'src/todos.ts', line: 1, endLine: 2 } },
  { type: 'turn', to: 'agent' },
  { type: 'interrupt' },
  { type: 'point', file: 'src/server.ts', line: 12 },
  { type: 'outside', files: ['package.json', 'src/other.ts'] },
  { type: 'run', id: 1, command: 'npm test', phase: 'confirm' },
  { type: 'run', id: 1, command: 'npm test', phase: 'running' },
  { type: 'run', id: 1, command: 'npm test', phase: 'done', exitCode: 0 },
  { type: 'run', id: 2, command: 'npm run lint', phase: 'confirm' },
  { type: 'run', id: 2, command: 'npm run lint', phase: 'declined' },
  { type: 'run', id: 3, command: 'npm start', phase: 'running' },
  { type: 'run', id: 3, command: 'npm start', phase: 'background' },
  { type: 'run', id: 3, command: 'npm start', phase: 'exited', exitCode: 1 },
  { type: 'selection', ref: { file: 'src/todos.ts', line: 7, endLine: 9 } },
  { type: 'speed', value: 1.5 },
  { type: 'readingSpeed', value: 2 },
  { type: 'calibration', view: { phase: 'armed', title: 'Comma Gets a Cure' } },
  { type: 'calibration', view: { phase: 'reading', title: 'Comma Gets a Cure', text: 'Well, here is a story.', notice: 'Public domain.' } },
  { type: 'calibration', view: { phase: 'done', msPerChar: 60, wordsPerMinute: 230 } },
  { type: 'calibration', view: { phase: 'idle' } },
  { type: 'session', active: false, reason: 'user' },
  { type: 'startEnded' },
];

it('every rule in panel.css matches the page in some state', async () => {
  await loadPage();
  const rules = selectors(fs.readFileSync(STYLESHEET, 'utf8'));
  const matched = new Set<string>();
  const invalid: string[] = [];
  function check(): void {
    for (const rule of rules) {
      if (matched.has(rule)) continue;
      try {
        if (document.querySelector(matchable(rule)) !== null) matched.add(rule);
      } catch {
        if (!invalid.includes(rule)) invalid.push(rule);
      }
    }
  }
  check();
  for (const event of SCENARIO) {
    send(event);
    check();
  }
  // VS Code's high contrast themes put their class on the body.
  document.body.classList.add('vscode-high-contrast-light');
  check();
  document.body.classList.replace('vscode-high-contrast-light', 'vscode-high-contrast');
  check();
  // The speed menus open on a click.
  ui('speed')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check();
  ui('reading-speed')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check();
  const unmatched = rules.filter((rule) => !matched.has(rule));
  fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
  fs.writeFileSync(
    SUMMARY,
    `${JSON.stringify({ file: 'packages/vscode/src/webview/panel.css', rules: rules.length, matched: rules.length - unmatched.length, unmatched }, undefined, 2)}\n`,
  );
  expect(invalid.map((rule) => `${rule} -> ${matchable(rule)}`)).toEqual([]);
  expect(unmatched).toEqual([]);
});

it('every class the page script toggles has a rule', () => {
  const css = fs.readFileSync(STYLESHEET, 'utf8');
  const script = fs.readFileSync(path.join(import.meta.dirname, '../src/webview/panel.ts'), 'utf8');
  const toggled = [...script.matchAll(/classList\.(?:toggle|add|remove)\('([a-z-]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(toggled)].filter((name) => !new RegExp(`\\.${name}\\b`).test(css));
  expect(missing).toEqual([]);
});
