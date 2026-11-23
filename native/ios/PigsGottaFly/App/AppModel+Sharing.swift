import Foundation

/// Sharing an aircraft and inviting pilots, as the website's ShareDialog and InviteDialog call the
/// API. The answers stay JSON text: the core turns them into what the sheets show.
extension AppModel {
    func aircraftSharing(_ id: String) async throws -> String {
        text(try await api.aircraftShares(id, as: JSON.self))
    }

    /// POST /aircraft/:id/shares: an address with an account gets access, any other an invitation.
    func shareAircraft(_ id: String, _ body: ShareInput) async throws -> String {
        try await serverMessage { text(try await api.shareAircraft(id, email: body.email, role: body.role)) }
    }

    func setAircraftShareRole(_ id: String, key: String, role: ShareRole) async throws -> String {
        try await serverMessage { text(try await api.setAircraftShareRole(id, pilotId: key, role: role)) }
    }

    /// Removes a person or an invited address; with the pilot's own id the aircraft leaves their
    /// hangar (then nil: there is no sharing left to show).
    func removeAircraftShare(_ id: String, key: String) async throws -> String? {
        try await serverMessage { try await api.removeAircraftShare(id, pilotId: key) }
        guard key == pilot?.id else { return try await aircraftSharing(id) }
        if pilot?.defaultAircraftId == id { await loadPilot() }
        hangarChanged += 1
        return nil
    }

    func invitations() async throws -> String {
        text(try await api.invitations(as: JSON.self))
    }

    /// POST /api/invitations → InviteResponse (JSON text).
    func invite(_ body: API.InviteRequest) async throws -> String {
        try await serverMessage { text(try await api.invite(body, as: JSON.self)) }
    }

    func cancelInvitation(_ id: String) async throws {
        try await serverMessage { try await api.cancelInvitation(id) }
    }

    private func text(_ j: JSON) -> String { j.text }

    /// A 409 here is "already has access" or "already invited", not an edit conflict: show the
    /// server's own words.
    private func serverMessage<T>(_ call: () async throws -> T) async throws -> T {
        do {
            return try await call()
        } catch APIError.conflict(let data) {
            throw APIError.http(409, (try? JSON.parse(data))?["error"]?.string ?? "")
        }
    }
}
