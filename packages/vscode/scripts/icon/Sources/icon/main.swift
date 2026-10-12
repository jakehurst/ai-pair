// Writes the extension's icon as media/icon.svg and a 256x256 media/icon.png.
// Run from packages/vscode: swift run --package-path scripts/icon icon

import Foundation
import IconDrawing

let pngPath = "media/icon.png"
let svgPath = "media/icon.svg"

do {
  try writePNG(to: pngPath, size: Icon.pngSize)
  try writeSVG(to: svgPath)
  print("Wrote \(pngPath) and \(svgPath)")
} catch {
  FileHandle.standardError.write(Data("icon: \(error)\n".utf8))
  exit(1)
}
