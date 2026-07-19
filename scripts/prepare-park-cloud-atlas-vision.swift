import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: swift prepare-park-cloud-atlas-vision.swift input.png output.png\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard
  let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
  let sourceImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  fputs("Unable to decode input PNG.\n", stderr)
  exit(3)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: sourceImage)
do {
  try handler.perform([request])
} catch {
  fputs("Vision foreground request failed: \(error)\n", stderr)
  exit(4)
}

guard let observation = request.results?.first as? VNInstanceMaskObservation else {
  fputs("Vision did not find a foreground instance.\n", stderr)
  exit(5)
}

let maskBuffer: CVPixelBuffer
do {
  maskBuffer = try observation.generateScaledMaskForImage(
    forInstances: observation.allInstances,
    from: handler
  )
} catch {
  fputs("Unable to generate scaled foreground mask: \(error)\n", stderr)
  exit(6)
}

let sourceCI = CIImage(cgImage: sourceImage)
let maskCI = CIImage(cvPixelBuffer: maskBuffer)
  .transformed(by: CGAffineTransform(
    scaleX: sourceCI.extent.width / CGFloat(CVPixelBufferGetWidth(maskBuffer)),
    y: sourceCI.extent.height / CGFloat(CVPixelBufferGetHeight(maskBuffer))
  ))
  .cropped(to: sourceCI.extent)
let clearCI = CIImage(color: CIColor.clear).cropped(to: sourceCI.extent)
guard let blend = CIFilter(
  name: "CIBlendWithMask",
  parameters: [
    kCIInputImageKey: sourceCI,
    kCIInputBackgroundImageKey: clearCI,
    kCIInputMaskImageKey: maskCI,
  ]
)?.outputImage?.cropped(to: sourceCI.extent) else {
  fputs("Unable to compose transparent foreground.\n", stderr)
  exit(7)
}

let context = CIContext(options: [.cacheIntermediates: false])
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
guard let png = context.pngRepresentation(
  of: blend,
  format: .RGBA8,
  colorSpace: colorSpace,
  options: [:]
) else {
  fputs("Unable to encode transparent PNG.\n", stderr)
  exit(8)
}

do {
  try png.write(to: outputURL, options: .atomic)
} catch {
  fputs("Unable to write output PNG: \(error)\n", stderr)
  exit(9)
}

print(
  "Wrote Vision cloud atlas: \(sourceImage.width)x\(sourceImage.height), instances: \(observation.allInstances.count)"
)
