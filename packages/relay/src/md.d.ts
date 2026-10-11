declare module '*.md' {
  const text: string;
  // esbuild's text loader (packages/vscode/scripts/build.mts) gives a .md file's text as its default export.
  export default text;
}
