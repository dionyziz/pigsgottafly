import CoreLocation
import Foundation
import MapLibre

/// The map tiles for a flight's route, kept for Fly with no connection (NATIVE.md "Offline"): an
/// MLNOfflineStorage pack of the route's bounding box plus 15 NM, zooms 6–11, for the chart's style.
/// One pack per flight; a new one replaces it when the flight's version changes.
@MainActor
enum OfflineMaps {
    static let minZoom = 6.0
    static let maxZoom = 11.0

    struct Context: Codable, Equatable {
        var flight: String
        var version: Int
    }

    static func context(of pack: MLNOfflinePack) -> Context? {
        try? JSONDecoder().decode(Context.self, from: pack.context)
    }

    static func ensurePack(
        flightId: String, version: Int, styleURL: URL,
        bounds b: (minLat: Double, minLon: Double, maxLat: Double, maxLon: Double)
    ) {
        let storage = MLNOfflineStorage.shared
        guard let packs = storage.packs else {
            // the packs are still loading: try again in a moment
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                ensurePack(flightId: flightId, version: version, styleURL: styleURL, bounds: b)
            }
            return
        }
        var have = false
        for p in packs {
            guard let c = context(of: p), c.flight == flightId else { continue }
            if c.version == version {
                have = true
                if p.state == .inactive || p.state == .unknown { p.resume() }
            } else {
                storage.removePack(p, withCompletionHandler: nil)
            }
        }
        guard !have else { return }
        let region = MLNTilePyramidOfflineRegion(
            styleURL: styleURL,
            bounds: MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: b.minLat, longitude: b.minLon),
                ne: CLLocationCoordinate2D(latitude: b.maxLat, longitude: b.maxLon)),
            fromZoomLevel: minZoom, toZoomLevel: maxZoom)
        guard let ctx = try? JSONEncoder().encode(Context(flight: flightId, version: version)) else { return }
        storage.addPack(for: region, withContext: ctx) { pack, error in
            if let pack, error == nil { pack.resume() }
        }
    }
}
