// swift-tools-version: 6.0
// The extension's icon: a library that draws it, the command that writes it, and the tests.
// Run from packages/vscode: swift run --package-path scripts/icon icon
// Test with coverage: swift test --package-path scripts/icon --enable-code-coverage

import PackageDescription

let package = Package(
  name: "icon",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "IconDrawing"),
    .executableTarget(name: "icon", dependencies: ["IconDrawing"]),
    .testTarget(name: "IconDrawingTests", dependencies: ["IconDrawing"]),
  ]
)
