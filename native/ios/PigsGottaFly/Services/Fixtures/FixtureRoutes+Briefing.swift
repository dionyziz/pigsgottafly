import Foundation

/// The reference data, METAR/TAF and the terrain grid (the forecast grids: FixtureTransport.grid).
extension FixtureTransport {
    func briefingRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "ref", _): (200, "ref.json", nil)
        case ("GET", "weather", 2) where r.parts[1] == "metar": (200, "metar.json", nil)
        case ("GET", "terrain", 2): (200, nil, AppModel.bundledTerrain())
        case ("GET", "flights", 3) where r.parts[2] == "notams": (200, "notams.json", nil)
        default: nil
        }
    }
}
