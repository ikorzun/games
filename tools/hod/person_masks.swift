// person_masks.swift: маски людей на кадре (Apple Vision, локально) → PNG по человеку.
//
//   swift tools/hod/person_masks.swift <кадр.webp|png> <папка-вывода>
//
// Пишет <папка>/person_<i>.png — белый человек на чёрном, размер кадра — и печатает «i путь». Какой персонаж за какой
// маской — решает tools/hod/masks.py по положению маски.
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3, let src = NSImage(contentsOfFile: args[1]),
      let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("usage: person_masks <image> <outdir>\n".data(using: .utf8)!)
    exit(2)
}
let outDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let request = VNGeneratePersonInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg)
try handler.perform([request])
guard let obs = request.results?.first else { print("people 0"); exit(0) }

let ctx = CIContext()
let W = cg.width, H = cg.height
for i in obs.allInstances {
    let buf = try obs.generateScaledMaskForImage(forInstances: IndexSet(integer: i), from: handler)
    var img = CIImage(cvPixelBuffer: buf)
    // маска может быть меньше кадра — растянуть до размера кадра
    img = img.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / img.extent.width, y: CGFloat(H) / img.extent.height))
    guard let out = ctx.createCGImage(img, from: CGRect(x: 0, y: 0, width: W, height: H)) else { continue }
    let rep = NSBitmapImageRep(cgImage: out)
    let url = outDir.appendingPathComponent("person_\(i).png")
    try rep.representation(using: .png, properties: [:])!.write(to: url)
    print(i, url.path)
}
