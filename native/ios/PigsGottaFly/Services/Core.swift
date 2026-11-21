import Foundation
import JavaScriptCore

enum CoreError: Error, Equatable, LocalizedError {
    case notFound
    case load(String)
    case js(String)
    case badResult(String)

    var errorDescription: String? {
        switch self {
        case .notFound: "core.js is missing from the app."
        case .load(let m): "core.js did not load: \(m)"
        case .js(let m): "The core failed: \(m)"
        case .badResult(let m): "The core answered something unexpected: \(m)"
        }
    }
}

/// The shared TypeScript logic (core.js, global `PGF`; NATIVE.md "core.js API") in JavaScriptCore.
/// One JSContext, used only on its serial queue. Arguments go in as JSON text and are parsed into
/// objects for PGF; results come back as JSON text. JS exceptions become CoreError.js.
final class Core: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.pigsgottafly.core")
    private var context: JSContext!
    private var pending: String?

    /// Called with a JSON argument (or none) and answering JSON text: a result that is already a string
    /// is taken as JSON text, so a core that speaks strings works too.
    private static let bridge = """
        globalThis.__pgfCall = function (name, json) {
          if (typeof PGF === 'undefined') throw new Error('PGF is not defined');
          var f = PGF[name];
          if (typeof f !== 'function') throw new Error('PGF.' + name + ' is not a function');
          var r = json === undefined || json === null ? f() : f(JSON.parse(json));
          if (typeof r === 'string') return r;
          return JSON.stringify(r === undefined ? null : r);
        };
        globalThis.__pgfGet = function (name) {
          var v = typeof PGF === 'undefined' ? undefined : PGF[name];
          return JSON.stringify(v === undefined ? null : v);
        };
        """

    init(script: String, sourceURL: URL? = nil) throws {
        var failure: String?
        queue.sync {
            let ctx = JSContext()!
            ctx.name = "PGF core"
            ctx.exceptionHandler = { [weak self] _, exception in
                self?.pending = Core.describe(exception)
            }
            context = ctx
            ctx.evaluateScript(script, withSourceURL: sourceURL)
            if let p = pending {
                failure = p
                return
            }
            ctx.evaluateScript(Core.bridge)
            if let p = pending {
                failure = p
                return
            }
            if ctx.evaluateScript("typeof PGF")?.toString() != "object" { failure = "it defines no PGF object" }
        }
        if let failure { throw CoreError.load(failure) }
    }

    /// The core.js bundled with the app.
    static func bundled(_ bundle: Bundle = .main) throws -> Core {
        guard let url = bundle.url(forResource: "core", withExtension: "js") else { throw CoreError.notFound }
        return try Core(script: try String(contentsOf: url, encoding: .utf8), sourceURL: url)
    }

    private static func describe(_ e: JSValue?) -> String {
        guard let e else { return "unknown error" }
        let message = e.toString() ?? "unknown error"
        if let stack = e.objectForKeyedSubscript("stack"), !stack.isUndefined, let s = stack.toString(), !s.isEmpty {
            return "\(message)\n\(s)"
        }
        return message
    }

    /// Calls PGF[name] with the JSON text `argument` (nil: no argument); returns its JSON text.
    func call(_ name: String, json argument: String?) throws -> String {
        try queue.sync {
            pending = nil
            let fn = context.objectForKeyedSubscript("__pgfCall")!
            let result = fn.call(withArguments: [name, argument.map { $0 as Any } ?? NSNull()])
            if let p = pending {
                pending = nil
                throw CoreError.js(p)
            }
            guard let result, result.isString, let text = result.toString() else {
                throw CoreError.badResult("PGF.\(name) returned no JSON")
            }
            return text
        }
    }

    /// Calls PGF[name] with `argument` (a JSON object whose values are JSON texts, assembled without
    /// re-encoding the large ones).
    func call(_ name: String, fields: [String: String]) throws -> String {
        try call(name, json: Core.object(fields))
    }

    func callJSON(_ name: String, fields: [String: String]) throws -> JSON {
        let text = try call(name, fields: fields)
        do { return try JSON.parse(text) } catch { throw CoreError.badResult("PGF.\(name): \(error)") }
    }

    /// '{"a":<text>,"b":<text>}' from JSON texts.
    static func object(_ fields: [String: String]) -> String {
        let body = fields.sorted { $0.key < $1.key }.map { k, v in
            "\(JSON.string(k).text):\(v.isEmpty ? "null" : v)"
        }
        return "{" + body.joined(separator: ",") + "}"
    }

    /// Runs `body` off the main thread (the core can take a while on a long route).
    func run<T: Sendable>(_ body: @escaping @Sendable (Core) throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                cont.resume(with: Result { try body(self) })
            }
        }
    }

    // MARK: the contract

    var version: String {
        (try? queue.sync { () throws -> String in
            let v = context.evaluateScript("__pgfGet('version')")?.toString() ?? "null"
            return (try? JSON.parse(v))?.string ?? "unknown"
        }) ?? "unknown"
    }

    /// The core is the hand-written stub (until the real core.js lands).
    var isStub: Bool {
        queue.sync { context.evaluateScript("__pgfGet('stub')")?.toString() == "true" }
    }

    /// The names of PGF.symbolNames() ([{ name, size, colors, … }]).
    func symbolNames() throws -> [String] {
        let j = try JSON.parse(try call("symbolNames", json: nil))
        return (j.array ?? []).compactMap { $0["name"]?.string ?? $0.string }
    }

    /// The MapLibre style JSON (text). `vector`: OpenFreeMap's style JSON text, or nil.
    func chartStyle(base: String, vector: String?) throws -> String {
        try call("chartStyle", fields: ["base": JSON.string(base).text, "vector": vector ?? "null"])
    }

    /// { sourceId: FeatureCollection }. `waypoints`: GET /api/waypoints (the pilot's saved points).
    func chartData(ref: String, flight: String, notams: String?, layers: String?, waypoints: String? = nil) throws
        -> JSON
    {
        try callJSON(
            "chartData",
            fields: [
                "ref": ref, "flight": flight, "notams": notams ?? "null", "layers": layers ?? "null",
                "waypoints": waypoints ?? "null",
            ])
    }

    /// The hangar's type templates (offered when the pilot has no aircraft).
    func aircraftTemplates() throws -> [AircraftTemplate] {
        (try JSON.parse(try call("aircraftTemplates", json: nil)).array ?? []).compactMap { t in
            guard let id = t["id"]?.string, let label = t["label"]?.string else { return nil }
            return AircraftTemplate(id: id, label: label, description: t["description"]?.string ?? "")
        }
    }

    /// The body of POST /api/aircraft for a template and a registration (JSON text).
    func aircraftFromTemplate(id: String, registration: String) throws -> String {
        try call(
            "aircraftFromTemplate",
            fields: ["id": JSON.string(id).text, "registration": JSON.string(registration).text])
    }

    /// `ref`: GET /api/ref/bundle (nil: the last one given).
    func weatherRequests(flight: String, ref: String? = nil) throws -> [String] {
        (try callJSON("weatherRequests", fields: ["flight": flight, "ref": ref ?? "null"]).array ?? []).compactMap(
            \.string)
    }

    /// `notams`: the NOTAM briefing (GET /api/flights/:id/notams), for the aerodrome hours and the NOTAMs row.
    func computeFlight(
        flight: String, aircraft: String?, pilot: String?, ref: String, weather: String, notams: String? = nil
    ) throws -> JSON {
        try callJSON(
            "computeFlight",
            fields: [
                "flight": flight, "aircraft": aircraft ?? "null", "pilot": pilot ?? "null", "ref": ref,
                "weather": weather, "notams": notams ?? "null",
            ])
    }

    func paperwork(filing: String?, forms: String?, declarations: String?) throws -> JSON {
        try callJSON(
            "paperwork",
            fields: ["filing": filing ?? "null", "forms": forms ?? "null", "declarations": declarations ?? "null"])
    }

    func progress(flight: String, computed: String, position: Position) throws -> JSON {
        try callJSON("progress", fields: ["flight": flight, "computed": computed, "position": position.json.text])
    }
}

/// A GPS fix as PGF.progress takes it.
struct Position: Equatable, Sendable {
    var lat: Double
    var lon: Double
    var altFt: Double?
    var trackDeg: Double?
    var gsKt: Double?
    var time: Date

    var json: JSON {
        var o: [String: JSON] = [
            "lat": .number(lat), "lon": .number(lon), "time": .number((time.timeIntervalSince1970 * 1000).rounded()),
        ]
        if let altFt { o["altFt"] = .number(altFt) }
        if let trackDeg { o["trackDeg"] = .number(trackDeg) }
        if let gsKt { o["gsKt"] = .number(gsKt) }
        return .object(o)
    }
}
