import Foundation

// Sharing and inviting (src/native/core/share.ts; NATIVE.md "core.js API", Sharing): the website's
// share and invite dialogs' rows, bodies and messages.

/// PGF.sharing: the share sheet.
struct CoreSharing: Decodable, Equatable, Sendable {
    struct Row: Decodable, Equatable, Identifiable, Sendable {
        /// The person's pilot id, or the invited address.
        var key: String
        var role: String
        var name: String
        var email: String
        var initial: String
        var isSelf: Bool
        var pending: Bool
        var note: String
        var via: String
        /// owner, aircraft, manage or readOnly (src/features/hangar/shareModel.ts ShareControl).
        var control: String
        var roleLabel: String
        var removeLabel: String
        var canRemove: Bool
        var id: String { key }

        enum CodingKeys: String, CodingKey {
            case key, role, name, email, initial, pending, note, via, control, roleLabel, removeLabel, canRemove
            case isSelf = "self"
        }
    }
    struct RoleOption: Decodable, Equatable, Sendable {
        var role: ShareRole
        var label: String
    }
    var canManage: Bool
    var rows: [Row]
    var roles: [RoleOption]
    /// Why the add form's address cannot be sent yet.
    var error: String?
    /// The body of POST …/shares.
    var body: ShareInput?
}

/// PGF.invite: Invite pilots.
struct CoreInvite: Decodable, Equatable, Sendable {
    struct Aircraft: Decodable, Equatable, Identifiable, Sendable {
        var id: String
        var registration: String
        var makeModel: String
    }
    struct Invitation: Decodable, Equatable, Identifiable, Sendable {
        var id: String
        var email: String
        var initial: String
        /// "SX-ASV (Viewer), SX-ASG (Editor)"
        var aircraft: String
    }
    var shareable: [Aircraft]
    var invitations: [Invitation]
    var error: String?
    /// The body of POST /api/invitations.
    var body: API.InviteRequest?
    /// The line after inviting.
    var done: String?
}

extension Core {
    /// `sharing`: GET …/:id/shares (JSON text); `email` and `role`: the add form.
    func sharing(
        _ sharing: String, myId: String, kind: String = "aircraft", email: String = "", role: ShareRole = .view
    ) throws -> CoreSharing {
        try callDecoding(
            "sharing",
            fields: [
                "sharing": sharing, "myId": JSON.string(myId).text, "kind": JSON.string(kind).text,
                "email": JSON.string(email).text, "role": JSON.string(role.rawValue).text,
            ])
    }

    /// "Shared by Alice · Viewer" (nil for the pilot's own); `access`: the record's access (JSON text).
    func sharedChip(access: String) throws -> String? {
        try callJSON("sharedChip", fields: ["access": access])["chip"]?["text"]?.string
    }

    /// `hangar`: GET /api/aircraft, `invitations`: GET /api/invitations (JSON texts); `picked`:
    /// the aircraft to share and their roles; `response`: POST /api/invitations's answer.
    func invite(
        hangar: String = "[]", invitations: String = "[]", email: String = "", note: String = "",
        picked: [(String, ShareRole)] = [], response: String? = nil
    ) throws -> CoreInvite {
        let pairs = JSON.array(picked.map { [.string($0.0), .string($0.1.rawValue)] })
        return try callDecoding(
            "invite",
            fields: [
                "hangar": hangar, "invitations": invitations, "email": JSON.string(email).text,
                "note": JSON.string(note).text, "picked": pairs.text, "response": response ?? "null",
            ])
    }
}
