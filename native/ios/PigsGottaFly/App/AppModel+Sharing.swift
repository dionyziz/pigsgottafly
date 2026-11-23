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

    // MARK: any shared record (ShareSheet)

    /// GET …/:id/shares of the record.
    func sharingOf(_ t: ShareTarget) async throws -> String {
        switch t.kind {
        case .aircraft: try await aircraftSharing(t.id)
        case .flight: text(try await api.flightShares(t.id, as: JSON.self))
        case .operator: text(try await api.operatorShares(t.id, as: JSON.self))
        }
    }

    /// POST …/:id/shares. A flight's address with no account gets an invite to the flight; an
    /// aircraft's, an invitation to the app; an operator's must have an account.
    func addShare(_ t: ShareTarget, _ body: ShareInput) async throws -> String {
        try await serverMessage {
            switch t.kind {
            case .aircraft: return try await shareAircraft(t.id, body)
            case .flight: return text(try await api.shareFlight(t.id, email: body.email, role: body.role))
            case .operator: return text(try await api.shareOperator(t.id, email: body.email, role: body.role))
            }
        }
    }

    func setShareRole(_ t: ShareTarget, key: String, role: ShareRole) async throws -> String {
        try await serverMessage {
            switch t.kind {
            case .aircraft: return try await setAircraftShareRole(t.id, key: key, role: role)
            case .flight: return text(try await api.setFlightShareRole(t.id, key: key, role: role))
            case .operator: return text(try await api.setOperatorShareRole(t.id, pilotId: key, role: role))
            }
        }
    }

    /// Removes a person or an invited address and answers the sharing after it; with the pilot's own
    /// id they leave the record (nil: nothing left to show), and the lists that held it follow.
    func removeShare(_ t: ShareTarget, key: String) async throws -> String? {
        if t.kind == .aircraft { return try await removeAircraftShare(t.id, key: key) }
        try await serverMessage {
            if t.kind == .flight {
                try await api.removeFlightShare(t.id, key: key)
            } else {
                try await api.removeOperatorShare(t.id, pilotId: key)
            }
        }
        guard key == pilot?.id else { return try await sharingOf(t) }
        if t.kind == .flight { await loadFlights() }
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
