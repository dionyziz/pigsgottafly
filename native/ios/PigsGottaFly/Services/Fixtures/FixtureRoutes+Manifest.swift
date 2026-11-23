import Foundation

/// The passenger list the manifest adds from (Fixtures/manifest/passengers.json, then what POST and PUT
/// change). A flight's sharing: FixtureRoutes+Sharing.swift.
extension FixtureTransport {
    func manifestRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "passengers", 1):
            return (200, nil, Self.encoded(.array(passengerList())))
        case ("POST", "passengers", 1):
            guard let input = r.body.flatMap({ try? JSON.parse($0) }), var p = input.object else {
                return bad("Bad request")
            }
            let id = "pax-\(UUID().uuidString.prefix(8).lowercased())"
            p["id"] = .string(id)
            p["created"] = 1_763_000_000_000
            p["updated"] = 1_763_000_000_000
            ManifestFixtures.shared.change(self) { $0.passengers.append(.object(p)) }
            return (201, nil, Self.encoded(.object(p)))
        case ("PUT", "passengers", 2):
            let id = r.parts[1]
            guard let patch = r.body.flatMap({ try? JSON.parse($0) })?.object,
                var p = passengerList().first(where: { $0["id"]?.string == id })
            else { return (404, nil, nil) }
            for (k, v) in patch { p[k] = v }
            let saved = p
            ManifestFixtures.shared.change(self) { s in
                s.passengers = s.passengers.map { $0["id"]?.string == id ? saved : $0 }
            }
            return (200, nil, Self.encoded(saved))
        default:
            return nil
        }
    }

    private func passengerList() -> [JSON] {
        ManifestFixtures.shared.state(self).passengers
    }
}

/// What the fixture server changed, per transport (an extension cannot add stored properties).
final class ManifestFixtures: @unchecked Sendable {
    struct State {
        var passengers: [JSON]
        /// Held so that its identifier is not reused by another transport (the unit tests make many).
        var owner: AnyObject
    }

    static let shared = ManifestFixtures()
    private let lock = NSLock()
    private var states: [ObjectIdentifier: State] = [:]

    func state(_ t: FixtureTransport) -> State {
        var out: State?
        change(t) { out = $0 }
        return out!
    }

    func change(_ t: FixtureTransport, _ body: (inout State) -> Void) {
        let k = ObjectIdentifier(t)
        let seeded = lock.withLock { states[k] != nil }
        let seed = seeded || t.emptyAccount ? [] : Self.seed(t)
        lock.withLock {
            var s = states[k] ?? State(passengers: seed, owner: t)
            body(&s)
            states[k] = s
        }
    }

    private static func seed(_ t: FixtureTransport) -> [JSON] {
        t.fixture("manifest/passengers.json").flatMap { try? JSON.parse($0) }?.array ?? []
    }
}
