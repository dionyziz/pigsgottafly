import Foundation

/// The hangar list's actions, as the website's HangarPage does them.
extension AppModel {
    /// GET /api/aircraft: the rows, and the list as JSON text for the core's Add aircraft.
    func hangar() async throws -> (items: [AircraftItem], json: String) {
        let data = try await api.aircraftList()
        return (try api.decode([AircraftItem].self, data), String(decoding: data, as: UTF8.self))
    }

    /// Add aircraft: POST /api/aircraft with the core's body. Returns the new aircraft's id and the
    /// toast; throws the core's or the server's reason it was not added.
    func addAircraft(hangar: String, registration: String, source: CoreNewAircraft.Source) async throws
        -> (id: String, toast: String)
    {
        guard let core else { throw APIError.http(0, coreError ?? "The core did not load.") }
        var made = try core.newAircraft(hangar: hangar, registration: registration, source: source)
        if let error = made.error { throw APIError.http(0, error) }
        if let opId = made.input?["operatorId"]?.string, !opId.isEmpty {
            let op = (try? await api.operatorItem(opId, as: JSON.self)) ?? .null
            made = try core.newAircraft(hangar: hangar, registration: registration, source: source, operator: op)
        }
        guard let input = made.input else { throw APIError.http(0, made.error ?? "") }
        let data: Data
        do {
            data = try await api.createAircraft(try input.data())
        } catch APIError.conflict {
            throw APIError.http(409, made.conflict)
        }
        guard let id = try JSON.parse(data)["id"]?.string else {
            throw APIError.http(0, "The server sent no aircraft.")
        }
        // the server makes it the default only when the pilot had none
        var becameDefault = false
        if pilot?.defaultAircraftId == nil {
            await loadPilot()
            becameDefault = pilot?.defaultAircraftId == id
        }
        return (id, becameDefault ? made.addedDefault : made.added)
    }

    /// DELETE /api/aircraft/:id (the owner). The server drops it as the default aircraft.
    func deleteAircraft(_ a: AircraftItem) async throws {
        try await api.deleteAircraft(a.id)
        if pilot?.defaultAircraftId == a.id { await loadPilot() }
    }

    /// "Remove from my hangar": the pilot's own share of an aircraft they do not own.
    func leaveAircraft(_ a: AircraftItem) async throws {
        guard let me = pilot?.id else { throw APIError.http(0, "The profile has not loaded yet.") }
        try await api.removeAircraftShare(a.id, pilotId: me)
        if pilot?.defaultAircraftId == a.id { await loadPilot() }
    }
}
