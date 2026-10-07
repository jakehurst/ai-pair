// Downloads VS Code (stable) for the integration test where none is installed, as on CI, and
// prints its executable's path, for `VSCODE_BIN`.

import { downloadAndUnzipVSCode } from "@vscode/test-electron"

console.log(await downloadAndUnzipVSCode("stable"))
