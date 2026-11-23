import Foundation

/// File & forms: the filing state from the fixtures (the forms and declarations: FixtureRoutes+Paperwork).
extension FixtureTransport {
    func formRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        guard r.method == "GET", r.first == "flights", r.count == 3 else { return nil }
        switch r.parts[2] {
        case "filing": return (200, "filing.json", nil)
        default: return nil
        }
    }
}
