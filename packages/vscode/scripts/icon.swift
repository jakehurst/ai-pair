// Draws the extension's icon, the agent's cursor and label as they look in the editor, typing
// inside a pair of parens, and writes it as media/icon.svg and a 256x256 media/icon.png.
//
// Run from packages/vscode: swift scripts/icon.swift

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A rounded rectangle in a 128x128 box, y down, like the SVG.
struct Box {
  let x: CGFloat
  let y: CGFloat
  let width: CGFloat
  let height: CGFloat
  let cornerRadius: CGFloat
  let fill: String
}

/// A run of Menlo text in the same box, placed by its baseline.
struct Text {
  let text: String
  let x: CGFloat
  let baseline: CGFloat
  let size: CGFloat
  let bold: Bool
  let centered: Bool
  let fill: String
}

let boxSize: CGFloat = 128
let channelMax = 0xFF
let pngSize = 256
let pngPath = "media/icon.png"
let svgPath = "media/icon.svg"

let tile = Box(x: 0, y: 0, width: boxSize, height: boxSize, cornerRadius: 28, fill: "#1F1F1F")
let label = Box(x: 38, y: 20, width: 76, height: 31, cornerRadius: 7, fill: "#E8875B")
let cursor = Box(x: 38, y: 60, width: 8, height: 45, cornerRadius: 2, fill: "#E8875B")
let texts = [
  Text(text: "Agent", x: 76, baseline: 42.5, size: 20, bold: true, centered: true, fill: "#1B1B1B"),
  Text(text: "(", x: 10, baseline: 98, size: 46, bold: false, centered: false, fill: "#FFD700"),
  Text(text: ")", x: 42, baseline: 98, size: 46, bold: false, centered: false, fill: "#FFD700"),
  Text(text: ";", x: 69, baseline: 98, size: 46, bold: false, centered: false, fill: "#CCCCCC"),
]
// The code goes under the label and cursor.
let boxesUnder = [tile]
let boxesOver = [label, cursor]
let textsUnder = texts.filter { !$0.centered }
let textsOver = texts.filter { $0.centered }

func color(_ hex: String) -> CGColor {
  guard let value = Int(hex.dropFirst(), radix: 16) else {
    fatalError("Not a #RRGGBB color: \(hex)")
  }
  return CGColor(
    srgbRed: CGFloat((value >> 16) & channelMax) / CGFloat(channelMax),
    green: CGFloat((value >> 8) & channelMax) / CGFloat(channelMax),
    blue: CGFloat(value & channelMax) / CGFloat(channelMax),
    alpha: 1
  )
}

func line(_ text: Text) -> CTLine {
  let fontName = text.bold ? "Menlo-Bold" : "Menlo-Regular"
  let font = CTFontCreateWithName(fontName as CFString, text.size, nil)
  let attributes: [NSAttributedString.Key: Any] = [
    .init(kCTFontAttributeName as String): font,
    .init(kCTForegroundColorAttributeName as String): color(text.fill),
  ]
  let string = NSAttributedString(string: text.text, attributes: attributes)
  return CTLineCreateWithAttributedString(string)
}

func startX(_ text: Text) -> CGFloat {
  guard text.centered else { return text.x }
  let width = CGFloat(CTLineGetTypographicBounds(line(text), nil, nil, nil))
  return text.x - width / 2
}

func draw(_ box: Box, in context: CGContext) {
  let rect = CGRect(x: box.x, y: box.y, width: box.width, height: box.height)
  let radius = box.cornerRadius
  let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  context.addPath(path)
  context.setFillColor(color(box.fill))
  context.fillPath()
}

func draw(_ text: Text, in context: CGContext) {
  context.textPosition = CGPoint(x: startX(text), y: text.baseline)
  CTLineDraw(line(text), context)
}

func svgNumber(_ value: CGFloat) -> String {
  String(format: "%g", (value * 100).rounded() / 100)
}

func attribute(_ name: String, _ value: String) -> String {
  #"\#(name)="\#(value)""#
}

func svg(_ box: Box) -> String {
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

func svg(_ text: Text) -> String {
  var attributes = [
    attribute("x", svgNumber(startX(text))),
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

// PNG
guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB) else {
  fatalError("No sRGB color space")
}
guard
  let context = CGContext(
    data: nil,
    width: pngSize,
    height: pngSize,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: sRGB,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  )
else {
  fatalError("Couldn't make the \(pngSize)x\(pngSize) bitmap")
}
let scale = CGFloat(pngSize) / boxSize
context.translateBy(x: 0, y: CGFloat(pngSize))
context.scaleBy(x: scale, y: -scale)
for box in boxesUnder {
  draw(box, in: context)
}
context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
for text in textsUnder {
  draw(text, in: context)
}
for box in boxesOver {
  draw(box, in: context)
}
for text in textsOver {
  draw(text, in: context)
}
guard let image = context.makeImage() else {
  fatalError("Couldn't render the icon")
}
let pngURL = URL(fileURLWithPath: pngPath) as CFURL
let pngType = UTType.png.identifier as CFString
guard let png = CGImageDestinationCreateWithURL(pngURL, pngType, 1, nil) else {
  fatalError("Couldn't create \(pngPath)")
}
CGImageDestinationAddImage(png, image, nil)
precondition(CGImageDestinationFinalize(png), "Couldn't write \(pngPath)")

// SVG, with live text, for editing
let body = boxesUnder.map(svg) + textsUnder.map(svg) + boxesOver.map(svg) + textsOver.map(svg)
let viewBox = "0 0 \(svgNumber(boxSize)) \(svgNumber(boxSize))"
let svgOpen = #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="\#(viewBox)">"#
let document = ([svgOpen] + body + ["</svg>", ""]).joined(separator: "\n")
try document.write(toFile: svgPath, atomically: true, encoding: .utf8)
print("Wrote \(pngPath) and \(svgPath)")
