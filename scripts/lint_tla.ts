// Checks the TLA+ specs and their TLC configs in specs/ against the layout rules of specs/tlaplus-style-guide.md
// that a script can check (#148). TLC, in specs/check.sh, parses every module.
//
//   npm run lint:tla

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPECS = path.join(ROOT, 'specs');

/** The column limit (4.2). */
const COLUMN_LIMIT = 80;
const MODULE_EXTENSION = '.tla';
/** The module footer (3.10). */
const FOOTER = '='.repeat(COLUMN_LIMIT);
/** A separator line (4.6). */
const SEPARATOR = '-'.repeat(COLUMN_LIMIT);
/** A line of dashes, a separator meant to be SEPARATOR. */
const DASHES = /^-{4,}$/;
/** The start of a line comment. */
const LINE_COMMENT = '\\*';
/** The `VARIABLES` keyword, which starts a block of declarations (3.6). */
const VARIABLES_KEYWORD = /^VARIABLES?\b/;
const IDENTIFIER = /\w+/g;

/** A URL, which a comment may carry past the column limit (4.2). */
const URL = /https?:\/\//;
/** A line comment's start, `\*`, not followed by a space or the line's end (7.1). */
const CRAMPED_COMMENT = /\\\*(?! |$)/;
/** A declaration keyword in the singular (3.4, 3.6). */
const SINGULAR_KEYWORD = /^(CONSTANT|VARIABLE)(?!S)\b/;
/** `==` without exactly one space on each side (4.4). */
const CRAMPED_DEFINITION = /[^ =]==|==[^ =]|  ==|==  /;
/** The start of the variables tuple's definition (3.6). */
const VARS_DEFINITION = 'vars ==';
/** The type invariant's name (6.1). */
const TYPE_OK = 'TypeOK';
/** The start of the type invariant's definition (6.1). */
const TYPE_OK_DEFINITION = `${TYPE_OK} ==`;

const CONFIG_EXTENSION = '.cfg';
/** What separates the module's name from the model's in `Foo_<Model>.cfg` (2.1). */
const MODEL_SEPARATOR = '_';
/** A config line's keyword. */
const CONFIG_KEYWORD = /^[A-Z_]+/;
/** Each config keyword's place in a config (8.1); the four state-space controls share one. */
const CONFIG_ORDER: ReadonlyMap<string, number> = new Map([
  ['SPECIFICATION', 0],
  ['CONSTANTS', 1],
  ['INVARIANTS', 2],
  ['PROPERTIES', 3],
  ['SYMMETRY', 4],
  ['CONSTRAINT', 4],
  ['ACTION_CONSTRAINT', 4],
  ['VIEW', 4],
  ['CHECK_DEADLOCK', 5],
]);
/** The keywords TLC accepts that the guide replaces, with what replaces them (8.3, 8.4, 8.5). */
const REPLACED: ReadonlyMap<string, string> = new Map([
  ['CONSTANT', 'CONSTANTS'],
  ['INVARIANT', 'INVARIANTS'],
  ['PROPERTY', 'PROPERTIES'],
  ['INIT', 'SPECIFICATION'],
  ['NEXT', 'SPECIFICATION'],
]);
/** The keywords whose entries go below them, one per line (8.4, 8.5). */
const BLOCK_KEYWORDS: readonly string[] = ['CONSTANTS', 'INVARIANTS', 'PROPERTIES'];
/** The block keywords whose entries are names, one per line (8.5). */
const NAME_BLOCKS: readonly string[] = ['INVARIANTS', 'PROPERTIES'];
/** A block's entry: indented 4 spaces (8.4). */
const ENTRY = /^ {4}\S/;
/** The keywords a comment has to justify (7.2, 8.6). */
const JUSTIFIED: readonly string[] = ['SYMMETRY', 'CONSTRAINT', 'ACTION_CONSTRAINT', 'VIEW'];
/** The deadlock check turned off, which a comment has to justify (6.13, 7.2). */
const DEADLOCK_OFF = 'CHECK_DEADLOCK FALSE';

/** A problem found in a spec or a config: its line, the guide's section, and what is wrong. */
export interface Problem {
  line: number;
  rule: string;
  message: string;
}

/** Returns the header line of module `name` (3.2): four dashes, `MODULE`, the name, and dashes to the column limit. */
function header(name: string): string {
  return `---- MODULE ${name} `.padEnd(COLUMN_LIMIT, '-');
}

/** Returns the code of `line`: the part before its line comment, if it has one. */
function codeOf(line: string): string {
  const start = line.indexOf(LINE_COMMENT);
  return start < 0 ? line : line.slice(0, start);
}

/** Finds where each `VARIABLES` block starts, and the variables the blocks declare, in order (3.6). */
function variables(lines: string[]): { blocks: number[]; names: string[] } {
  const blocks: number[] = [];
  const names: string[] = [];
  let inBlock = false;
  lines.forEach((line, i) => {
    let code = codeOf(line);
    const keyword = VARIABLES_KEYWORD.exec(code);
    if (keyword) {
      blocks.push(i);
      code = code.slice(keyword[0].length);
    }
    inBlock = keyword !== null || (inBlock && line.startsWith(' '));
    if (inBlock) names.push(...(code.match(IDENTIFIER) ?? []));
  });
  return { blocks, names };
}

/** Finds the line of the `vars` definition and the names its tuple lists, or undefined if there is none (3.6). */
function varsTuple(lines: string[]): { line: number; names: string[] } | undefined {
  const start = lines.findIndex((line) => line.startsWith(VARS_DEFINITION));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i >= start && line.includes('>>'));
  const tuple = lines
    .slice(start, end + 1)
    .map((line) => codeOf(line))
    .join(' ')
    .slice(VARS_DEFINITION.length);
  return { line: start, names: tuple.match(IDENTIFIER) ?? [] };
}

/** Returns the problems in module `name`, whose text is `text`: each with its line, the guide's section, and what is wrong. */
export function checkModule(name: string, text: string): Problem[] {
  const lines = text.split('\n');
  const problems: Problem[] = [];
  if (lines[0] !== header(name)) problems.push({ line: 1, rule: '3.2', message: `the header is not "${header(name)}"` });
  lines.forEach((line, i) => {
    function report(rule: string, message: string): void {
      problems.push({ line: i + 1, rule, message });
    }
    const code = codeOf(line);
    const comment = line.slice(code.length);
    if (line.includes('\t')) report('4.1', 'a tab');
    if (line.length > COLUMN_LIMIT && !URL.test(comment)) report('4.2', `${line.length} columns, over ${COLUMN_LIMIT}`);
    if (CRAMPED_COMMENT.test(line)) report('7.1', 'no space after \\*');
    if (SINGULAR_KEYWORD.test(line)) report('3.4, 3.6', 'CONSTANTS and VARIABLES are plural');
    if (CRAMPED_DEFINITION.test(code)) report('4.4', '== needs one space on each side');
    if (DASHES.test(line) && line !== SEPARATOR) report('4.6', `a separator is ${COLUMN_LIMIT} dashes`);
    if (line === '' && lines[i - 1] === '') report('4.6', 'two blank lines in a row');
  });
  const last = lines.length - 1;
  if (lines[last] !== '') {
    problems.push({ line: last + 1, rule: '2.2', message: 'no newline at the end' });
  } else if (lines[last - 1] !== FOOTER) {
    problems.push({ line: last, rule: '3.10', message: `the footer is not ${COLUMN_LIMIT} "="` });
  }
  const { blocks, names } = variables(lines);
  for (const block of blocks.slice(1)) {
    problems.push({ line: block + 1, rule: '3.6', message: 'a second VARIABLES block' });
  }
  const [firstBlock] = blocks;
  if (firstBlock !== undefined && names.length > 0) {
    const tuple = varsTuple(lines);
    if (!tuple) {
      problems.push({ line: firstBlock + 1, rule: '3.6', message: 'no vars tuple' });
    } else if (tuple.names.join() !== names.join()) {
      problems.push({ line: tuple.line + 1, rule: '3.6', message: `vars is not <<${names.join(', ')}>>` });
    }
    if (!lines.some((line) => line.startsWith(TYPE_OK_DEFINITION))) {
      problems.push({ line: firstBlock + 1, rule: '6.1', message: 'no TypeOK' });
    }
  }
  return problems;
}

/** Returns the problems in a config, whose text is `text`, for a module that declares variables or not (`hasVariables`). */
export function checkConfig(text: string, hasVariables: boolean): Problem[] {
  const lines = text.split('\n');
  const problems: Problem[] = [];
  function report(i: number, rule: string, message: string): void {
    problems.push({ line: i + 1, rule, message });
  }
  if (!lines[0]?.startsWith(LINE_COMMENT)) report(0, '8.2', 'no leading comment saying what the model is for');
  const invariants: string[] = [];
  let place = 0;
  let block: string | undefined;
  lines.forEach((line, i) => {
    if (line.length > COLUMN_LIMIT) report(i, '4.2', `${line.length} columns, over ${COLUMN_LIMIT}`);
    const code = codeOf(line).trimEnd();
    const [keyword] = code.match(CONFIG_KEYWORD) ?? [];
    if (keyword === undefined) {
      if (code !== '' && !ENTRY.test(code)) report(i, '8.4, 8.5', 'an entry is indented 4 spaces');
      const names = code.match(IDENTIFIER) ?? [];
      if (block !== undefined && NAME_BLOCKS.includes(block) && names.length > 1) report(i, '8.5', 'one name per line');
      if (block === 'INVARIANTS') invariants.push(...names);
      return;
    }
    block = REPLACED.get(keyword) ?? keyword;
    if (REPLACED.has(keyword)) report(i, '8.3, 8.4, 8.5', `${block}, not ${keyword}`);
    const order = CONFIG_ORDER.get(block) ?? place;
    if (order < place) report(i, '8.1', `${block} is out of order`);
    place = Math.max(place, order);
    const above = lines.findLastIndex((other, j) => j < i && !other.startsWith(LINE_COMMENT));
    if (lines[above] !== '') report(i, '8.1', 'a blank line before each keyword');
    const justified = above < i - 1 || codeOf(line) !== line;
    if ((JUSTIFIED.includes(block) || code === DEADLOCK_OFF) && !justified) report(i, '7.2, 8.6', `${code} needs a comment saying why`);
    const entries = code.slice(keyword.length).match(IDENTIFIER) ?? [];
    if (BLOCK_KEYWORDS.includes(block) && entries.length > 0) report(i, '8.4, 8.5', 'entries go below the keyword, one per line');
    if (block === 'INVARIANTS') invariants.push(...entries);
  });
  if (hasVariables && invariants[0] !== TYPE_OK) report(0, '6.1, 8.5', 'TypeOK is not the first invariant');
  return problems;
}

/** Returns the text of `file` in specs/. */
function readSpec(file: string): string {
  return fs.readFileSync(path.join(SPECS, file), 'utf8');
}

/** Returns the problems in `file`, a module or a config in specs/; none for another file. */
function problemsIn(file: string): Problem[] {
  const extension = path.extname(file);
  const name = path.basename(file, extension);
  if (extension === MODULE_EXTENSION) return checkModule(name, readSpec(file));
  if (extension !== CONFIG_EXTENSION) return [];
  const [moduleName = name] = name.split(MODEL_SEPARATOR);
  const module = readSpec(`${moduleName}${MODULE_EXTENSION}`);
  return checkConfig(readSpec(file), variables(module.split('\n')).names.length > 0);
}

/** Checks every module and config in specs/, prints each problem, and fails if there is one. */
function main() {
  let found = 0;
  for (const file of fs.readdirSync(SPECS).toSorted()) {
    for (const { line, rule, message } of problemsIn(file)) {
      console.error(`specs/${file}:${line}: ${message} (${rule})`);
      found++;
    }
  }
  if (found > 0) {
    console.error(`\n${found} problems: see specs/tlaplus-style-guide.md.`);
    process.exit(1);
  }
  console.log('specs/: no problems the script checks.');
}

if (process.argv[1] === import.meta.filename) main();
