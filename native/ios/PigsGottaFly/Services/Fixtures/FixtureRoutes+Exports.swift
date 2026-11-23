import Foundation

/// Exports: the navlog e-mail (GET its state; POST "sends" it: the answer says it was sent now).
extension FixtureTransport {
    func exportRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        guard r.first == "flights", r.count == 5, Array(r.parts[2...]) == ["exports", "navlog", "email"] else {
            return nil
        }
        if r.method == "GET" { return (200, "pdf/navlog-mail.json", nil) }
        guard r.method == "POST" else { return nil }
        guard let body = r.body.flatMap({ try? JSON.parse($0) }), body["content"]?["sheets"]?.array != nil else {
            return (400, nil, Data(#"{"error":"content.sheets is required"}"#.utf8))
        }
        var state = fixture("pdf/navlog-mail.json").flatMap { try? JSON.parse($0) } ?? [:]
        let to = state["to"] ?? .string("")
        state["sent"] = .object(["to": to, "sentAt": .number((Date().timeIntervalSince1970 * 1000).rounded())])
        return (200, nil, Self.encoded(state))
    }
}
