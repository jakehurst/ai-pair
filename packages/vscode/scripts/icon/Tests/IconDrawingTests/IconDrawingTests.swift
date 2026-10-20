// The icon's drawing, and that what the package writes is what media/ holds.

import CoreGraphics
import Foundation
import IconDrawing
import XCTest

/// The extension's folder, which holds media/, from the package's.
let extensionDirectory = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()  // the file
  .deletingLastPathComponent()  // IconDrawingTests
  .deletingLastPathComponent()  // Tests
  .deletingLastPathComponent()  // icon
  .deletingLastPathComponent()  // scripts

final class ColorTests: XCTestCase {
  func testParsesEachChannel() throws {
    let components = try XCTUnwrap(try color("#FF8000").components)
    XCTAssertEqual(components[0], 1, accuracy: 0.001)
    XCTAssertEqual(components[1], 128.0 / 255.0, accuracy: 0.001)
    XCTAssertEqual(components[2], 0, accuracy: 0.001)
    XCTAssertEqual(components[3], 1)
  }

  func testRejectsWhatIsNotRRGGBB() {
    XCTAssertThrowsError(try color("FF8000"))
    XCTAssertThrowsError(try color("#FF80"))
    XCTAssertThrowsError(try color("#GGGGGG"))
  }
}

final class SVGTests: XCTestCase {
  func testNumbersHaveAtMostTwoDecimalsAndNoTrailingZeros() {
    XCTAssertEqual(svgNumber(42.5), "42.5")
    XCTAssertEqual(svgNumber(28), "28")
    XCTAssertEqual(svgNumber(1.0 / 3.0), "0.33")
  }

  func testBoxIsARect() {
    let box = Box(x: 1, y: 2, width: 3, height: 4, cornerRadius: 5, fill: "#ABCDEF")
    XCTAssertEqual(svg(box), ##"  <rect x="1" y="2" width="3" height="4" rx="5" fill="#ABCDEF"/>"##)
  }

  func testTextStartsWhereItIsPlaced() throws {
    let text = Text(
      text: "(",
      x: 10,
      baseline: 98,
      size: 46,
      bold: false,
      centered: false,
      fill: "#FFD700"
    )
    XCTAssertEqual(try startX(text), 10)
    XCTAssertEqual(
      try svg(text),
      ##"  <text x="10" y="98" font-family="Menlo, 'DejaVu Sans Mono', monospace" font-size="46" fill="#FFD700">(</text>"##
    )
  }

  func testCenteredBoldTextIsCenteredAndBold() throws {
    let text = Text(
      text: "Agent",
      x: 76,
      baseline: 42.5,
      size: 20,
      bold: true,
      centered: true,
      fill: "#1B1B1B"
    )
    XCTAssertLessThan(try startX(text), 76)
    XCTAssertTrue(try svg(text).contains(##"font-weight="bold""##))
  }
}

final class ShippedIconTests: XCTestCase {
  func testSVGIsTheOneShipped() throws {
    let shipped = try String(
      contentsOf: extensionDirectory.appendingPathComponent("media/icon.svg"),
      encoding: .utf8
    )
    XCTAssertEqual(
      try svgDocument(),
      shipped,
      "media/icon.svg is stale: swift run --package-path scripts/icon icon"
    )
  }

  func testPNGRendersAtTheShippedSize() throws {
    let image = try render(size: Icon.pngSize)
    XCTAssertEqual(image.width, Icon.pngSize)
    XCTAssertEqual(image.height, Icon.pngSize)
  }

  func testWritesBothFiles() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock {
      try FileManager.default.removeItem(at: directory)
    }
    let png = directory.appendingPathComponent("icon.png").path
    let svg = directory.appendingPathComponent("icon.svg").path
    try writePNG(to: png, size: 64)
    try writeSVG(to: svg)
    XCTAssertTrue(FileManager.default.fileExists(atPath: png))
    XCTAssertEqual(try String(contentsOfFile: svg, encoding: .utf8), try svgDocument())
  }

  func testWritingWhereItCannotFails() {
    XCTAssertThrowsError(try writePNG(to: "/nonexistent/folder/icon.png", size: 8))
  }
}
