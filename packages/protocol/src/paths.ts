// Comparing file paths the way the editor does. Editors name one file in one canonical form, but
// paths from elsewhere (the agent's working directory) may differ in case where the file system
// doesn't care: the Windows drive letter, or a folder typed differently.

import * as nodePath from "node:path"

export type PathStyle = { ignoreCase: boolean; sep: string }

/** Like VS Code: paths that differ only in case name the same file, except on Linux. */
export const hostPathStyle: PathStyle = { ignoreCase: process.platform !== "linux", sep: nodePath.sep }

export function samePath(a: string, b: string, style = hostPathStyle): boolean {
  return style.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** `file` spelled the way `folder` is, if it's inside `folder` (or is it). */
export function withinFolder(folder: string, file: string, style = hostPathStyle): string | undefined {
  if (samePath(file, folder, style)) return folder
  const prefix = folder.endsWith(style.sep) ? folder : folder + style.sep
  if (file.length > prefix.length && samePath(file.slice(0, prefix.length), prefix, style)) {
    return prefix + file.slice(prefix.length)
  }
  return undefined
}
