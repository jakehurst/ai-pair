// samePath and withinFolder in packages/protocol/src/paths.ts, for Windows, macOS, and Linux paths. paths.ts uses
// only node:path, which is pure, so the tests need no mocks.

import { describe, expect, it } from 'vitest';
import { samePath, withinFolder, type PathStyle } from '../src/paths';

/** A Linux path: case matters, and `/` separates. */
const LINUX: PathStyle = { ignoreCase: false, sep: '/' };

/** A Windows path: case is ignored, and a backslash separates. */
const WINDOWS: PathStyle = { ignoreCase: true, sep: '\\' };

/** A macOS path: case is ignored, and `/` separates. */
const MAC: PathStyle = { ignoreCase: true, sep: '/' };

describe('samePath', () => {
  it('ignores case on Windows and macOS, not on Linux', () => {
    expect(samePath('C:\\Users\\me\\a.ts', 'c:\\users\\me\\a.ts', WINDOWS)).toBe(true);
    expect(samePath('/Users/me/A.ts', '/users/me/a.ts', MAC)).toBe(true);
    expect(samePath('/home/me/A.ts', '/home/me/a.ts', LINUX)).toBe(false);
  });
});

describe('withinFolder', () => {
  it('finds a file in a folder whose name starts with two dots, which is not the folder above (#5)', () => {
    expect(withinFolder('/work', '/work/..cache/a.ts', LINUX)).toBe('/work/..cache/a.ts');
    expect(withinFolder('/work', '/work/..cache', LINUX)).toBe('/work/..cache');
    expect(withinFolder('/work/sub', '/work/../a.ts', LINUX)).toBeUndefined();
  });

  it('spells a file inside a folder the way the folder is spelled', () => {
    const folder = 'c:\\Users\\me\\Desktop\\proj';
    expect(withinFolder(folder, 'C:\\users\\me\\desktop\\proj\\src\\A.ts', WINDOWS)).toBe('c:\\Users\\me\\Desktop\\proj\\src\\A.ts');
    expect(withinFolder(folder, 'C:\\USERS\\ME\\DESKTOP\\PROJ', WINDOWS)).toBe(folder);
    expect(withinFolder('/Users/me/Proj', '/users/me/proj/a.ts', MAC)).toBe('/Users/me/Proj/a.ts');
    expect(withinFolder('/home/me/proj', '/home/me/proj/a.ts', LINUX)).toBe('/home/me/proj/a.ts');
  });

  it('leaves files outside the folder alone', () => {
    expect(withinFolder('c:\\proj', 'c:\\project\\a.ts', WINDOWS)).toBeUndefined();
    expect(withinFolder('c:\\proj', 'd:\\proj\\a.ts', WINDOWS)).toBeUndefined();
    expect(withinFolder('/home/me/Proj', '/home/me/proj/a.ts', LINUX)).toBeUndefined();
  });

  it('handles a folder that is a drive root', () => {
    expect(withinFolder('c:\\', 'C:\\proj\\a.ts', WINDOWS)).toBe('c:\\proj\\a.ts');
    expect(withinFolder('/', '/home/me/a.ts', LINUX)).toBe('/home/me/a.ts');
  });
});
