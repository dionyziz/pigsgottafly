import Foundation

/// The offline cache in Application Support (NATIVE.md "Offline"): the flight list, each opened flight
/// with its aircraft, weather answers, NOTAM briefing and paperwork, the pilot and the reference data.
/// Plain JSON files, written atomically, as the API answered them.
final class Store: @unchecked Sendable {
    enum Key: Hashable {
        case flights
        case pilot
        case ref
        /// OpenFreeMap's style JSON (the base of the chart).
        case vectorStyle
        /// The chart style built by the core (a file: MapLibre and the offline packs load it by URL).
        case chartStyle(String)
        case flight(String)
        /// An edit not yet on the server: { doc, version }.
        case pendingEdit(String)
        case aircraft(String)
        case weather(String)
        case notams(String)
        case filing(String)
        case forms(String)
        case declarations(String)
        /// The relevant NOTAMs marked read: their keys, sorted, comma-separated (as the website keeps it).
        case notamsRead(String)
        /// The terrain grid (greece.bin, as fetched).
        case terrain

        var path: String {
            switch self {
            case .flights: "flights.json"
            case .pilot: "pilot.json"
            case .ref: "ref.json"
            case .vectorStyle: "map/vector-style.json"
            case .chartStyle(let base): "map/chart-\(Store.safe(base)).json"
            case .flight(let id): "flights/\(Store.safe(id))/flight.json"
            case .pendingEdit(let id): "flights/\(Store.safe(id))/pending.json"
            case .aircraft(let id): "aircraft/\(Store.safe(id)).json"
            case .weather(let id): "flights/\(Store.safe(id))/weather.json"
            case .notams(let id): "flights/\(Store.safe(id))/notams.json"
            case .filing(let id): "flights/\(Store.safe(id))/filing.json"
            case .forms(let id): "flights/\(Store.safe(id))/forms.json"
            case .declarations(let id): "flights/\(Store.safe(id))/declarations.json"
            case .notamsRead(let id): "flights/\(Store.safe(id))/notams-read.txt"
            case .terrain: "terrain/greece.bin"
            }
        }
    }

    let root: URL
    private let fm = FileManager.default

    init(root: URL) {
        self.root = root
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    }

    /// Application Support/PigsGottaFly.
    static func standard() -> Store {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return Store(root: base.appendingPathComponent("PigsGottaFly", isDirectory: true))
    }

    static func safe(_ s: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        let cleaned = String(s.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
        return cleaned.isEmpty || cleaned.hasPrefix(".") ? "_\(cleaned)" : cleaned
    }

    func url(_ key: Key) -> URL { root.appendingPathComponent(key.path) }

    func write(_ data: Data, _ key: Key) throws {
        let u = url(key)
        try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: u, options: [.atomic])
    }

    func read(_ key: Key) -> Data? { try? Data(contentsOf: url(key)) }

    func text(_ key: Key) -> String? { read(key).flatMap { String(data: $0, encoding: .utf8) } }

    func exists(_ key: Key) -> Bool { fm.fileExists(atPath: url(key).path) }

    /// When the file was written (nil: absent).
    func modified(_ key: Key) -> Date? {
        (try? fm.attributesOfItem(atPath: url(key).path))?[.modificationDate] as? Date
    }

    func remove(_ key: Key) { try? fm.removeItem(at: url(key)) }

    func decode<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        read(key).flatMap { try? JSONDecoder().decode(type, from: $0) }
    }

    /// Everything (sign-out).
    func clear() {
        try? fm.removeItem(at: root)
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    }
}
