import Foundation

/// Passengers and waypoints: the lists only, for now (operators: FixtureRoutes+Operators.swift;
/// invitations: FixtureRoutes+Sharing.swift).
extension FixtureTransport {
    func peopleRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "waypoints", 1):
            (200, emptyAccount ? nil : "waypoints.json", emptyAccount ? Data("[]".utf8) : nil)
        case ("GET", "passengers", 1): (200, nil, Data("[]".utf8))
        default: nil
        }
    }
}
