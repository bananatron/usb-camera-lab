import AVFoundation
import Foundation

struct Mode: Codable {
    let width: Int32
    let height: Int32
    let maxFps: Double
    let format: String
}

struct Camera: Codable {
    let name: String
    let uniqueId: String
    let modes: [Mode]
}

let session = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.external, .builtInWideAngleCamera],
    mediaType: .video,
    position: .unspecified
)

let cameras = session.devices.map { device in
    let modes = device.formats.flatMap { format -> [Mode] in
        let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        let subtype = CMFormatDescriptionGetMediaSubType(format.formatDescription)
        let fourCC = String(bytes: [
            UInt8((subtype >> 24) & 0xff), UInt8((subtype >> 16) & 0xff),
            UInt8((subtype >> 8) & 0xff), UInt8(subtype & 0xff)
        ], encoding: .ascii) ?? String(subtype)
        return format.videoSupportedFrameRateRanges.map { range in
            Mode(width: dimensions.width, height: dimensions.height,
                 maxFps: range.maxFrameRate, format: fourCC)
        }
    }
    return Camera(name: device.localizedName, uniqueId: device.uniqueID, modes: modes)
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let data = try encoder.encode(cameras)
FileHandle.standardOutput.write(data)
