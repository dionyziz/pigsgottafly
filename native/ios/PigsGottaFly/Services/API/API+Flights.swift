import Foundation

/// Flights, their briefing data and the reference data (api/_lib/routes/{flights,notams,ref,weather}.ts).
extension API {
    /// GET /flights (the pilot's and the shared ones); `trash`: the flights in the trash instead.
    func flights(trash: Bool = false) async throws -> Data { try await get(trash ? "flights?trash=1" : "flights") }

    func flight(_ id: String) async throws -> Data { try await get("flights/\(seg(id))") }

    /// POST /flights (FlightCreateRequest: a partial flight; the server fills in the profile's
    /// defaults: taxi times, wind model, PIC on the manifest) → 201 the new Flight.
    func createFlight(_ doc: JSON) async throws -> Data {
        try await request("POST", "flights", body: try doc.data())
    }

    /// PUT /flights/:id with { flight, version }; 409 → APIError.conflict(current flight).
    func updateFlight(_ id: String, doc: JSON, version: Int) async throws -> FlightUpdateResponse {
        let body = try JSON.object(["flight": doc, "version": .number(Double(version))]).data()
        return try decode(FlightUpdateResponse.self, try await request("PUT", "flights/\(seg(id))", body: body))
    }

    /// POST /flights/:id/copy. "Fly again" is title '' with a date (named after the route); no title
    /// makes "Copy of …", no date keeps the original's.
    func copyFlight(_ id: String, title: String? = "", date: String? = nil) async throws -> Data {
        var body: [String: JSON] = [:]
        if let title { body["title"] = .string(title) }
        if let date { body["date"] = .string(date) }
        return try await request("POST", "flights/\(seg(id))/copy", body: try JSON.object(body).data())
    }

    /// DELETE /flights/:id: to the trash (204).
    func trashFlight(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "flights/\(seg(id))")
    }

    /// POST /flights/:id/restore → the Flight, out of the trash.
    func restoreFlight(_ id: String) async throws -> Data {
        try await send("POST", "flights/\(seg(id))/restore")
    }

    func markOpened(_ id: String) async { _ = try? await request("POST", "flights/\(seg(id))/opened") }

    func notams(_ id: String, maxAltFt: Int?) async throws -> Data {
        try await get("flights/\(seg(id))/notams" + (maxAltFt.map { "?maxAltFt=\($0)" } ?? ""))
    }

    // MARK: reference data and weather

    func refBundle() async throws -> Data { try await get("ref/bundle") }

    func refAirac<T: Decodable>(as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "ref/airac", as: type)
    }

    /// GET /weather/metar?ids=… for chosen stations (the core's weatherRequests asks for the route's).
    func metar(_ icaos: [String]) async throws -> MetarTafResponse {
        let ids = icaos.map { $0.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? $0 }
        return try decode(MetarTafResponse.self, try await get("weather/metar?ids=\(ids.joined(separator: ","))"))
    }
}
