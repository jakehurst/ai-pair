// The extension's icon: the agent's cursor and label as they look in the editor, typing inside
// a pair of parens, as shapes in a 128x128 box, y down, like the SVG.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A rounded rectangle in the box.
public struct Box: Sendable {
  /// The left edge.
  public let x: CGFloat
  /// The top edge.
  public let y: CGFloat
  /// How wide.
  public let width: CGFloat
  /// How tall.
  public let height: CGFloat
  /// The corners' radius.
  public let cornerRadius: CGFloat
  /// The fill, as `#RRGGBB`.
  public let fill: String

  /// Makes a box from its edges, size, corners, and fill.
  public init(
    x: CGFloat,
    y: CGFloat,
    width: CGFloat,
    height: CGFloat,
    cornerRadius: CGFloat,
    fill: String
  ) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
    self.cornerRadius = cornerRadius
    self.fill = fill
  }
}

/// A run of Menlo text in the same box, placed by its baseline.
public struct Text: Sendable {
  /// The characters.
  public let text: String
  /// Where it starts, or its center when `centered`.
  public let x: CGFloat
  /// The baseline's y.
  public let baseline: CGFloat
  /// The font size.
  public let size: CGFloat
  /// Menlo Bold, else Menlo Regular.
  public let bold: Bool
  /// Whether `x` is the center of the text, not its start.
  public let centered: Bool
  /// The fill, as `#RRGGBB`.
  public let fill: String

  /// Makes a run of text from its characters, place, size, weight, and fill.
  public init(
    text: String,
    x: CGFloat,
    baseline: CGFloat,
    size: CGFloat,
    bold: Bool,
    centered: Bool,
    fill: String
  ) {
    self.text = text
    self.x = x
    self.baseline = baseline
    self.size = size
    self.bold = bold
    self.centered = centered
    self.fill = fill
  }
}

/// What can go wrong drawing or writing the icon.
public enum IconError: Error {
  /// A fill that is not `#RRGGBB`.
  case color(String)
  /// No bitmap of this size could be made.
  case bitmap(Int)
  /// The bitmap could not be rendered to an image.
  case render
  /// The file at this path could not be written.
  case write(String)
}

/// The icon as shipped: its box, its shapes, and where the code goes under the label and cursor.
public enum Icon {
  /// The side of the square the shapes are placed in.
  public static let boxSize: CGFloat = 128
  /// The side of the PNG the extension ships.
  public static let pngSize = 256

  /// The dark rounded square behind everything.
  public static let tile = Box(
    x: 0,
    y: 0,
    width: boxSize,
    height: boxSize,
    cornerRadius: 28,
    fill: "#1F1F1F"
  )
  /// The agent's label, as the editor shows it over the cursor.
  public static let label = Box(
    x: 38,
    y: 20,
    width: 76,
    height: 31,
    cornerRadius: 7,
    fill: "#E8875B"
  )
  /// The agent's cursor.
  public static let cursor = Box(
    x: 38,
    y: 60,
    width: 8,
    height: 45,
    cornerRadius: 2,
    fill: "#E8875B"
  )
  /// The label's text, and the code being typed.
  public static let texts = [
    Text(
      text: "Agent",
      x: 76,
      baseline: 42.5,
      size: 20,
      bold: true,
      centered: true,
      fill: "#1B1B1B"
    ),
    Text(text: "(", x: 10, baseline: 98, size: 46, bold: false, centered: false, fill: "#FFD700"),
    Text(text: ")", x: 42, baseline: 98, size: 46, bold: false, centered: false, fill: "#FFD700"),
    Text(text: ";", x: 69, baseline: 98, size: 46, bold: false, centered: false, fill: "#CCCCCC"),
  ]
  /// The boxes drawn first.
  public static let boxesUnder = [tile]
  /// The boxes drawn over the code.
  public static let boxesOver = [label, cursor]
  /// The code, drawn under the label and cursor.
  public static var textsUnder: [Text] { texts.filter { !$0.centered } }
  /// The label's text, drawn last.
  public static var textsOver: [Text] { texts.filter { $0.centered } }
}

let channelMax = 0xFF

/// Returns the color of a `#RRGGBB` string.
public func color(_ hex: String) throws -> CGColor {
  guard hex.hasPrefix("#"), hex.count == 7, let value = Int(hex.dropFirst(), radix: 16) else {
    throw IconError.color(hex)
  }
  return CGColor(
    srgbRed: CGFloat((value >> 16) & channelMax) / CGFloat(channelMax),
    green: CGFloat((value >> 8) & channelMax) / CGFloat(channelMax),
    blue: CGFloat(value & channelMax) / CGFloat(channelMax),
    alpha: 1
  )
}

func line(_ text: Text) throws -> CTLine {
  let fontName = text.bold ? "Menlo-Bold" : "Menlo-Regular"
  let font = CTFontCreateWithName(fontName as CFString, text.size, nil)
  let attributes: [NSAttributedString.Key: Any] = [
    .init(kCTFontAttributeName as String): font,
    .init(kCTForegroundColorAttributeName as String): try color(text.fill),
  ]
  let string = NSAttributedString(string: text.text, attributes: attributes)
  return CTLineCreateWithAttributedString(string)
}

/// Returns where the text starts: at `x`, or centered on it.
public func startX(_ text: Text) throws -> CGFloat {
  guard text.centered else { return text.x }
  let width = CGFloat(CTLineGetTypographicBounds(try line(text), nil, nil, nil))
  return text.x - width / 2
}

func draw(_ box: Box, in context: CGContext) throws {
  let rect = CGRect(x: box.x, y: box.y, width: box.width, height: box.height)
  let radius = box.cornerRadius
  let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  context.addPath(path)
  context.setFillColor(try color(box.fill))
  context.fillPath()
}

func draw(_ text: Text, in context: CGContext) throws {
  context.textPosition = CGPoint(x: try startX(text), y: text.baseline)
  CTLineDraw(try line(text), context)
}

/// Returns a number as SVG writes it: at most two decimals, no trailing zeros.
public func svgNumber(_ value: CGFloat) -> String {
  String(format: "%g", (value * 100).rounded() / 100)
}

func attribute(_ name: String, _ value: String) -> String {
  #"\#(name)="\#(value)""#
}

/// Returns the box as an SVG `rect`.
public func svg(_ box: Box) -> String {
  let attributes = [
    attribute("x", svgNumber(box.x)),
    attribute("y", svgNumber(box.y)),
    attribute("width", svgNumber(box.width)),
    attribute("height", svgNumber(box.height)),
    attribute("rx", svgNumber(box.cornerRadius)),
    attribute("fill", box.fill),
  ]
  return "  <rect \(attributes.joined(separator: " "))/>"
}

/// Returns the text as an SVG `text`, live for editing.
public func svg(_ text: Text) throws -> String {
  var attributes = [
    attribute("x", svgNumber(try startX(text))),
    attribute("y", svgNumber(text.baseline)),
    attribute("font-family", "Menlo, 'DejaVu Sans Mono', monospace"),
    attribute("font-size", svgNumber(text.size)),
  ]
  if text.bold {
    attributes.append(attribute("font-weight", "bold"))
  }
  attributes.append(attribute("fill", text.fill))
  return "  <text \(attributes.joined(separator: " "))>\(text.text)</text>"
}

/// Returns the whole icon as an SVG document, with live text, for editing.
public func svgDocument() throws -> String {
  let body =
    Icon.boxesUnder.map(svg) + (try Icon.textsUnder.map(svg)) + Icon.boxesOver.map(svg)
    + (try Icon.textsOver.map(svg))
  let viewBox = "0 0 \(svgNumber(Icon.boxSize)) \(svgNumber(Icon.boxSize))"
  let svgOpen = #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="\#(viewBox)">"#
  return ([svgOpen] + body + ["</svg>", ""]).joined(separator: "\n")
}

/// Returns the icon rendered as a `size` by `size` bitmap.
public func render(size: Int) throws -> CGImage {
  guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB) else { throw IconError.render }
  guard
    let context = CGContext(
      data: nil,
      width: size,
      height: size,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: sRGB,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    throw IconError.bitmap(size)
  }
  let scale = CGFloat(size) / Icon.boxSize
  context.translateBy(x: 0, y: CGFloat(size))
  context.scaleBy(x: scale, y: -scale)
  for box in Icon.boxesUnder {
    try draw(box, in: context)
  }
  context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
  for text in Icon.textsUnder {
    try draw(text, in: context)
  }
  for box in Icon.boxesOver {
    try draw(box, in: context)
  }
  for text in Icon.textsOver {
    try draw(text, in: context)
  }
  guard let image = context.makeImage() else { throw IconError.render }
  return image
}

/// Writes the icon as a PNG at `path`.
public func writePNG(to path: String, size: Int) throws {
  let image = try render(size: size)
  let url = URL(fileURLWithPath: path) as CFURL
  let type = UTType.png.identifier as CFString
  guard let destination = CGImageDestinationCreateWithURL(url, type, 1, nil) else {
    throw IconError.write(path)
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { throw IconError.write(path) }
}

/// Writes the icon as an SVG at `path`.
public func writeSVG(to path: String) throws {
  try svgDocument().write(toFile: path, atomically: true, encoding: .utf8)
}
