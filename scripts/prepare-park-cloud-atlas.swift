import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: swift prepare-park-cloud-atlas.swift input.png output.png\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard
  let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  fputs("Unable to decode input PNG.\n", stderr)
  exit(3)
}

let width = image.width
let height = image.height
let bytesPerRow = width * 4
var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

guard let context = CGContext(
  data: &pixels,
  width: width,
  height: height,
  bitsPerComponent: 8,
  bytesPerRow: bytesPerRow,
  space: colorSpace,
  bitmapInfo: bitmapInfo
) else {
  fputs("Unable to create pixel buffer.\n", stderr)
  exit(4)
}

context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

func colorKey(_ offset: Int) -> UInt32 {
  (UInt32(pixels[offset]) << 16)
    | (UInt32(pixels[offset + 1]) << 8)
    | UInt32(pixels[offset + 2])
}

let borderDepth = min(80, min(width, height) / 8)
var histogram: [UInt32: Int] = [:]
for y in 0..<height {
  for x in 0..<width where x < borderDepth || x >= width - borderDepth || y < borderDepth || y >= height - borderDepth {
    histogram[colorKey(y * bytesPerRow + x * 4), default: 0] += 1
  }
}

func repairEnclosedCloudHoles(
  regionX: Int,
  regionY: Int,
  regionWidth: Int,
  regionHeight: Int,
  closingRadius: Int = 3
) -> Int {
  let localCount = regionWidth * regionHeight
  var solid = [Bool](repeating: false, count: localCount)
  for y in 0..<regionHeight {
    for x in 0..<regionWidth {
      let globalOffset = (regionY + y) * bytesPerRow + (regionX + x) * 4
      solid[y * regionWidth + x] = pixels[globalOffset + 3] > 24
    }
  }

  var dilated = [Bool](repeating: false, count: localCount)
  for y in 0..<regionHeight {
    for x in 0..<regionWidth where solid[y * regionWidth + x] {
      for dy in -closingRadius...closingRadius {
        for dx in -closingRadius...closingRadius {
          let nx = x + dx
          let ny = y + dy
          if nx >= 0, nx < regionWidth, ny >= 0, ny < regionHeight {
            dilated[ny * regionWidth + nx] = true
          }
        }
      }
    }
  }

  var closed = [Bool](repeating: false, count: localCount)
  for y in closingRadius..<(regionHeight - closingRadius) {
    for x in closingRadius..<(regionWidth - closingRadius) {
      var survivesErosion = true
      for dy in -closingRadius...closingRadius where survivesErosion {
        for dx in -closingRadius...closingRadius where !dilated[(y + dy) * regionWidth + x + dx] {
          survivesErosion = false
          break
        }
      }
      closed[y * regionWidth + x] = survivesErosion
    }
  }

  var outside = [Bool](repeating: false, count: localCount)
  var outsideQueue = [Int]()
  outsideQueue.reserveCapacity(localCount / 2)
  func enqueueOutside(_ x: Int, _ y: Int) {
    guard x >= 0, x < regionWidth, y >= 0, y < regionHeight else { return }
    let index = y * regionWidth + x
    guard !outside[index], !closed[index] else { return }
    outside[index] = true
    outsideQueue.append(index)
  }
  for x in 0..<regionWidth {
    enqueueOutside(x, 0)
    enqueueOutside(x, regionHeight - 1)
  }
  for y in 0..<regionHeight {
    enqueueOutside(0, y)
    enqueueOutside(regionWidth - 1, y)
  }
  var outsideCursor = 0
  while outsideCursor < outsideQueue.count {
    let index = outsideQueue[outsideCursor]
    outsideCursor += 1
    let x = index % regionWidth
    let y = index / regionWidth
    enqueueOutside(x - 1, y)
    enqueueOutside(x + 1, y)
    enqueueOutside(x, y - 1)
    enqueueOutside(x, y + 1)
  }

  var nearestSource = [Int](repeating: -1, count: localCount)
  var nearestQueue = [Int]()
  nearestQueue.reserveCapacity(localCount)
  for y in 0..<regionHeight {
    for x in 0..<regionWidth {
      let index = y * regionWidth + x
      let globalOffset = (regionY + y) * bytesPerRow + (regionX + x) * 4
      if pixels[globalOffset + 3] >= 96 {
        nearestSource[index] = index
        nearestQueue.append(index)
      }
    }
  }
  var nearestCursor = 0
  while nearestCursor < nearestQueue.count {
    let index = nearestQueue[nearestCursor]
    nearestCursor += 1
    let x = index % regionWidth
    let y = index / regionWidth
    for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
      guard nx >= 0, nx < regionWidth, ny >= 0, ny < regionHeight else { continue }
      let neighbor = ny * regionWidth + nx
      guard nearestSource[neighbor] < 0 else { continue }
      nearestSource[neighbor] = nearestSource[index]
      nearestQueue.append(neighbor)
    }
  }

  var repaired = 0
  for y in 0..<regionHeight {
    for x in 0..<regionWidth {
      let index = y * regionWidth + x
      let globalOffset = (regionY + y) * bytesPerRow + (regionX + x) * 4
      guard pixels[globalOffset + 3] <= 24, !outside[index], nearestSource[index] >= 0 else { continue }
      let sourceIndex = nearestSource[index]
      let sourceX = sourceIndex % regionWidth
      let sourceY = sourceIndex / regionWidth
      let sourceOffset = (regionY + sourceY) * bytesPerRow + (regionX + sourceX) * 4
      let sourceAlpha = max(1, Int(pixels[sourceOffset + 3]))
      pixels[globalOffset] = UInt8(min(255, Int(pixels[sourceOffset]) * 255 / sourceAlpha))
      pixels[globalOffset + 1] = UInt8(min(255, Int(pixels[sourceOffset + 1]) * 255 / sourceAlpha))
      pixels[globalOffset + 2] = UInt8(min(255, Int(pixels[sourceOffset + 2]) * 255 / sourceAlpha))
      pixels[globalOffset + 3] = 255
      repaired += 1
    }
  }
  return repaired
}

func repairNarrowCloudCavities(
  regionX: Int,
  regionY: Int,
  regionWidth: Int,
  regionHeight: Int,
  enclosureDistance: Int = 28
) -> Int {
  let localCount = regionWidth * regionHeight
  var solid = [Bool](repeating: false, count: localCount)
  for y in 0..<regionHeight {
    for x in 0..<regionWidth {
      let globalOffset = (regionY + y) * bytesPerRow + (regionX + x) * 4
      solid[y * regionWidth + x] = pixels[globalOffset + 3] > 24
    }
  }
  var left = [Int](repeating: Int.max, count: localCount)
  var right = [Int](repeating: Int.max, count: localCount)
  var up = [Int](repeating: Int.max, count: localCount)
  var down = [Int](repeating: Int.max, count: localCount)

  for y in 0..<regionHeight {
    var last = -1
    for x in 0..<regionWidth {
      let index = y * regionWidth + x
      if solid[index] { last = x }
      else if last >= 0 { left[index] = x - last }
    }
    last = -1
    for x in stride(from: regionWidth - 1, through: 0, by: -1) {
      let index = y * regionWidth + x
      if solid[index] { last = x }
      else if last >= 0 { right[index] = last - x }
    }
  }
  for x in 0..<regionWidth {
    var last = -1
    for y in 0..<regionHeight {
      let index = y * regionWidth + x
      if solid[index] { last = y }
      else if last >= 0 { up[index] = y - last }
    }
    last = -1
    for y in stride(from: regionHeight - 1, through: 0, by: -1) {
      let index = y * regionWidth + x
      if solid[index] { last = y }
      else if last >= 0 { down[index] = last - y }
    }
  }

  var repairs: [(offset: Int, sourceOffset: Int)] = []
  for y in 0..<regionHeight {
    for x in 0..<regionWidth {
      let index = y * regionWidth + x
      guard !solid[index] else { continue }
      let distances = [left[index], right[index], up[index], down[index]]
      guard distances.filter({ $0 <= enclosureDistance }).count >= 3 else { continue }
      let nearest = distances.enumerated().min { $0.element < $1.element }!
      let sourceX: Int
      let sourceY: Int
      switch nearest.offset {
      case 0: sourceX = x - nearest.element; sourceY = y
      case 1: sourceX = x + nearest.element; sourceY = y
      case 2: sourceX = x; sourceY = y - nearest.element
      default: sourceX = x; sourceY = y + nearest.element
      }
      let globalOffset = (regionY + y) * bytesPerRow + (regionX + x) * 4
      let sourceOffset = (regionY + sourceY) * bytesPerRow + (regionX + sourceX) * 4
      repairs.append((globalOffset, sourceOffset))
    }
  }
  for repair in repairs {
    let sourceAlpha = max(1, Int(pixels[repair.sourceOffset + 3]))
    pixels[repair.offset] = UInt8(min(255, Int(pixels[repair.sourceOffset]) * 255 / sourceAlpha))
    pixels[repair.offset + 1] = UInt8(min(255, Int(pixels[repair.sourceOffset + 1]) * 255 / sourceAlpha))
    pixels[repair.offset + 2] = UInt8(min(255, Int(pixels[repair.sourceOffset + 2]) * 255 / sourceAlpha))
    pixels[repair.offset + 3] = 255
  }
  return repairs.count
}

func repairShortTransparentRuns(
  regionX: Int,
  regionY: Int,
  regionWidth: Int,
  regionHeight: Int,
  maxRunLength: Int = 42
) -> Int {
  func opaque(_ x: Int, _ y: Int) -> Bool {
    let offset = (regionY + y) * bytesPerRow + (regionX + x) * 4
    return pixels[offset + 3] > 24
  }
  func restoreRun(_ offsets: [Int], from firstOffset: Int, to secondOffset: Int) {
    let firstAlpha = max(1, Int(pixels[firstOffset + 3]))
    let secondAlpha = max(1, Int(pixels[secondOffset + 3]))
    let firstColor = (
      min(255, Int(pixels[firstOffset]) * 255 / firstAlpha),
      min(255, Int(pixels[firstOffset + 1]) * 255 / firstAlpha),
      min(255, Int(pixels[firstOffset + 2]) * 255 / firstAlpha)
    )
    let secondColor = (
      min(255, Int(pixels[secondOffset]) * 255 / secondAlpha),
      min(255, Int(pixels[secondOffset + 1]) * 255 / secondAlpha),
      min(255, Int(pixels[secondOffset + 2]) * 255 / secondAlpha)
    )
    for (index, offset) in offsets.enumerated() {
      let amount = Double(index + 1) / Double(offsets.count + 1)
      pixels[offset] = UInt8(Double(firstColor.0) + Double(secondColor.0 - firstColor.0) * amount)
      pixels[offset + 1] = UInt8(Double(firstColor.1) + Double(secondColor.1 - firstColor.1) * amount)
      pixels[offset + 2] = UInt8(Double(firstColor.2) + Double(secondColor.2 - firstColor.2) * amount)
      pixels[offset + 3] = 255
    }
  }

  var repaired = 0
  for y in 0..<regionHeight {
    var x = 0
    while x < regionWidth {
      if opaque(x, y) { x += 1; continue }
      let start = x
      while x < regionWidth, !opaque(x, y) { x += 1 }
      let length = x - start
      if start > 0, x < regionWidth, length <= maxRunLength {
        let offsets = (start..<x).map { (regionY + y) * bytesPerRow + (regionX + $0) * 4 }
        restoreRun(
          offsets,
          from: (regionY + y) * bytesPerRow + (regionX + start - 1) * 4,
          to: (regionY + y) * bytesPerRow + (regionX + x) * 4
        )
        repaired += length
      }
    }
  }
  for x in 0..<regionWidth {
    var y = 0
    while y < regionHeight {
      if opaque(x, y) { y += 1; continue }
      let start = y
      while y < regionHeight, !opaque(x, y) { y += 1 }
      let length = y - start
      if start > 0, y < regionHeight, length <= maxRunLength {
        let offsets = (start..<y).map { (regionY + $0) * bytesPerRow + (regionX + x) * 4 }
        restoreRun(
          offsets,
          from: (regionY + start - 1) * bytesPerRow + (regionX + x) * 4,
          to: (regionY + y) * bytesPerRow + (regionX + x) * 4
        )
        repaired += length
      }
    }
  }
  return repaired
}

let backgroundColors = histogram
  .sorted { $0.value > $1.value }
  .prefix(6)
  .map { color -> (Int, Int, Int) in
    (Int((color.key >> 16) & 255), Int((color.key >> 8) & 255), Int(color.key & 255))
  }

func backgroundDistance(_ offset: Int) -> Double {
  let red = Int(pixels[offset])
  let green = Int(pixels[offset + 1])
  let blue = Int(pixels[offset + 2])
  return backgroundColors.map { color in
    let dr = red - color.0
    let dg = green - color.1
    let db = blue - color.2
    return sqrt(Double(dr * dr + dg * dg + db * db))
  }.min() ?? 999
}

var isBackground = [Bool](repeating: false, count: width * height)
var queue = [Int]()
queue.reserveCapacity(width * height / 2)

func enqueueIfBackground(_ x: Int, _ y: Int) {
  guard x >= 0, x < width, y >= 0, y < height else { return }
  let index = y * width + x
  guard !isBackground[index] else { return }
  let offset = y * bytesPerRow + x * 4
  guard backgroundDistance(offset) <= 19 else { return }
  isBackground[index] = true
  queue.append(index)
}

for x in 0..<width {
  enqueueIfBackground(x, 0)
  enqueueIfBackground(x, height - 1)
}
for y in 0..<height {
  enqueueIfBackground(0, y)
  enqueueIfBackground(width - 1, y)
}

var cursor = 0
while cursor < queue.count {
  let index = queue[cursor]
  cursor += 1
  let x = index % width
  let y = index / width
  enqueueIfBackground(x - 1, y)
  enqueueIfBackground(x + 1, y)
  enqueueIfBackground(x, y - 1)
  enqueueIfBackground(x, y + 1)
}

for y in 0..<height {
  for x in 0..<width {
    let index = y * width + x
    let offset = y * bytesPerRow + x * 4
    if isBackground[index] {
      pixels[offset] = 0
      pixels[offset + 1] = 0
      pixels[offset + 2] = 0
      pixels[offset + 3] = 0
      continue
    }
    var touchesBackground = false
    for dy in -2...2 where !touchesBackground {
      for dx in -2...2 {
        let nx = x + dx
        let ny = y + dy
        if nx >= 0, nx < width, ny >= 0, ny < height, isBackground[ny * width + nx] {
          touchesBackground = true
          break
        }
      }
    }
    let distance = backgroundDistance(offset)
    let alpha = touchesBackground
      ? UInt8(max(0, min(255, Int((distance - 3) / 25 * 255))))
      : 255
    pixels[offset] = UInt8(Int(pixels[offset]) * Int(alpha) / 255)
    pixels[offset + 1] = UInt8(Int(pixels[offset + 1]) * Int(alpha) / 255)
    pixels[offset + 2] = UInt8(Int(pixels[offset + 2]) * Int(alpha) / 255)
    pixels[offset + 3] = alpha
  }
}

let halfWidth = width / 2
let halfHeight = height / 2
var repairedHolePixels = [
  repairEnclosedCloudHoles(regionX: 0, regionY: 0, regionWidth: halfWidth, regionHeight: halfHeight),
  repairEnclosedCloudHoles(regionX: halfWidth, regionY: 0, regionWidth: width - halfWidth, regionHeight: halfHeight),
  repairEnclosedCloudHoles(regionX: 0, regionY: halfHeight, regionWidth: halfWidth, regionHeight: height - halfHeight),
  repairEnclosedCloudHoles(regionX: halfWidth, regionY: halfHeight, regionWidth: width - halfWidth, regionHeight: height - halfHeight),
].reduce(0, +)
for _ in 0..<2 {
  repairedHolePixels += [
    repairShortTransparentRuns(regionX: 0, regionY: 0, regionWidth: halfWidth, regionHeight: halfHeight),
    repairShortTransparentRuns(regionX: halfWidth, regionY: 0, regionWidth: width - halfWidth, regionHeight: halfHeight),
    repairShortTransparentRuns(regionX: 0, regionY: halfHeight, regionWidth: halfWidth, regionHeight: height - halfHeight),
    repairShortTransparentRuns(regionX: halfWidth, regionY: halfHeight, regionWidth: width - halfWidth, regionHeight: height - halfHeight),
  ].reduce(0, +)
}

guard
  let outputContext = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: bitmapInfo
  ),
  let outputImage = outputContext.makeImage(),
  let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  )
else {
  fputs("Unable to create output PNG.\n", stderr)
  exit(5)
}

CGImageDestinationAddImage(destination, outputImage, nil)
guard CGImageDestinationFinalize(destination) else {
  fputs("Unable to write output PNG.\n", stderr)
  exit(6)
}

print("Wrote transparent cloud atlas: \(width)x\(height), background pixels: \(queue.count), repaired cloud-hole pixels: \(repairedHolePixels)")
