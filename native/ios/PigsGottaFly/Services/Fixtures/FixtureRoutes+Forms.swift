import Foundation

/// File & forms: the filing, forms and declarations states from the fixtures.
extension FixtureTransport {
    func formRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        guard r.method == "GET", r.first == "flights", r.count == 3 else { return nil }
        switch r.parts[2] {
        case "filing": return (200, "filing.json", nil)
        case "forms": return (200, "forms.json", nil)
        case "declarations": return (200, "declarations.json", nil)
        default: return nil
        }
    }
}
