import Foundation

/// Passengers, waypoints, operators, invitations and flight sharing (api/_lib/routes/{passengers,
/// waypoints,operators,invitations,flightShares}.ts). Inputs are the website's *Input types as JSON;
/// the core checks them (PGF.personIssues) before they are sent.
extension API {
    // MARK: passengers

    func passengers<T: Decodable>(as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "passengers", as: type)
    }

    func passenger<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "passengers/\(seg(id))", as: type)
    }

    /// POST /passengers (PassengerInput) → 201 the passenger.
    func createPassenger<T: Decodable>(_ input: JSON, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "passengers", body: input, as: type)
    }

    /// PUT /passengers/:id (Partial<PassengerInput>) → the passenger.
    func updatePassenger<T: Decodable>(_ id: String, patch: JSON, as type: T.Type = JSON.self) async throws -> T {
        try await call("PUT", "passengers/\(seg(id))", body: patch, as: type)
    }

    func deletePassenger(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "passengers/\(seg(id))")
    }

    // MARK: waypoints

    /// GET /waypoints: the pilot's saved points.
    func waypoints() async throws -> Data { try await get("waypoints") }

    func waypoint<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "waypoints/\(seg(id))", as: type)
    }

    /// POST /waypoints (WaypointInput) → 201 the waypoint.
    func createWaypoint<T: Decodable>(_ input: JSON, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "waypoints", body: input, as: type)
    }

    func updateWaypoint<T: Decodable>(_ id: String, patch: JSON, as type: T.Type = JSON.self) async throws -> T {
        try await call("PUT", "waypoints/\(seg(id))", body: patch, as: type)
    }

    func deleteWaypoint(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "waypoints/\(seg(id))")
    }

    // MARK: operators

    func operators<T: Decodable>(as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "operators", as: type)
    }

    func operatorItem<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "operators/\(seg(id))", as: type)
    }

    /// POST /operators (OperatorInput) → 201 OperatorItem.
    func createOperator<T: Decodable>(_ input: JSON, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "operators", body: input, as: type)
    }

    func updateOperator<T: Decodable>(_ id: String, patch: JSON, as type: T.Type = JSON.self) async throws -> T {
        try await call("PUT", "operators/\(seg(id))", body: patch, as: type)
    }

    func deleteOperator(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "operators/\(seg(id))")
    }

    /// GET /operators/:id/shares → OperatorSharing.
    func operatorShares<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "operators/\(seg(id))/shares", as: type)
    }

    func shareOperator<T: Decodable>(_ id: String, email: String, role: ShareRole, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("POST", "operators/\(seg(id))/shares", body: ShareInput(email: email, role: role), as: type)
    }

    func setOperatorShareRole<T: Decodable>(
        _ id: String, pilotId: String, role: ShareRole, as type: T.Type = JSON.self
    ) async throws -> T {
        try await call("PUT", "operators/\(seg(id))/shares/\(seg(pilotId))", body: RoleInput(role: role), as: type)
    }

    func removeOperatorShare(_ id: String, pilotId: String) async throws {
        try await sendIgnoringBody("DELETE", "operators/\(seg(id))/shares/\(seg(pilotId))")
    }

    // MARK: flight sharing

    /// GET /flights/:id/shares → FlightSharing (people and pending invites).
    func flightShares<T: Decodable>(_ flightId: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "flights/\(seg(flightId))/shares", as: type)
    }

    /// POST /flights/:id/shares → 201 FlightSharing; an address with no account gets an invite.
    func shareFlight<T: Decodable>(
        _ flightId: String, email: String, role: ShareRole, as type: T.Type = JSON.self
    ) async throws -> T {
        try await call("POST", "flights/\(seg(flightId))/shares", body: ShareInput(email: email, role: role), as: type)
    }

    /// `key`: a pilot's id, or the e-mail of a pending invite.
    func setFlightShareRole<T: Decodable>(
        _ flightId: String, key: String, role: ShareRole, as type: T.Type = JSON.self
    ) async throws -> T {
        try await call("PUT", "flights/\(seg(flightId))/shares/\(seg(key))", body: RoleInput(role: role), as: type)
    }

    /// With the pilot's own id: "Leave" a flight shared with them.
    func removeFlightShare(_ flightId: String, key: String) async throws {
        try await sendIgnoringBody("DELETE", "flights/\(seg(flightId))/shares/\(seg(key))")
    }

    // MARK: invitations

    struct InviteRequest: Encodable, Sendable {
        struct AircraftShare: Encodable, Sendable {
            var aircraftId: String
            var role: ShareRole
        }
        var email: String
        var message: String?
        var aircraft: [AircraftShare]
    }

    func invitations<T: Decodable>(as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "invitations", as: type)
    }

    /// POST /invitations → InviteResponse (an existing account gets the aircraft at once).
    func invite<T: Decodable>(_ req: InviteRequest, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "invitations", body: req, as: type)
    }

    func cancelInvitation(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "invitations/\(seg(id))")
    }

    /// DELETE /invitations/:id/aircraft/:aircraftId: one aircraft out of a pending invitation.
    func removeInvitationAircraft(_ id: String, aircraftId: String) async throws {
        try await sendIgnoringBody("DELETE", "invitations/\(seg(id))/aircraft/\(seg(aircraftId))")
    }
}
