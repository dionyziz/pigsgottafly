import XCTest

@testable import PigsGottaFly

/// Sharing an aircraft and inviting pilots, through the core and against the fixture server (which
/// knows one other account, copilot@example.com, and sends nothing).
@MainActor
final class SharingTests: XCTestCase {
    private let asv = "fixture-sx-asv"

    private func makeApp() async -> (AppModel, Core) {
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: FixtureTransport.bundled()!),
            store: temporaryStore())
        await app.loadPilot()
        return (app, try! Core.bundled())
    }

    func testTheOwnerSharesWithAnAccountAndInvitesAnAddress() async throws {
        let (app, core) = await makeApp()
        let me = try XCTUnwrap(app.pilot?.id)
        var v = try core.sharing(try await app.aircraftSharing(asv), myId: me)
        XCTAssertTrue(v.canManage)
        XCTAssertEqual(v.rows.map(\.control), ["owner"])
        XCTAssertTrue(v.rows[0].isSelf)
        XCTAssertEqual(v.error, "Enter an e-mail address.")

        v = try core.sharing(try await app.aircraftSharing(asv), myId: me, email: " copilot@example.com ", role: .edit)
        let body = try XCTUnwrap(v.body)
        XCTAssertEqual(body, ShareInput(email: "copilot@example.com", role: .edit))
        v = try core.sharing(try await app.shareAircraft(asv, body), myId: me)
        XCTAssertEqual(v.rows.map(\.name), ["FIXTURE PILOT", "Chris Copilot"])
        XCTAssertEqual(v.rows[1].roleLabel, "Editor")

        v = try core.sharing(
            try await app.shareAircraft(asv, ShareInput(email: "new@example.com", role: .view)), myId: me)
        let pending = try XCTUnwrap(v.rows.last)
        XCTAssertTrue(pending.pending)
        XCTAssertEqual(pending.note, "Invited · has access once they sign in with this address")
        let invites = try core.invite(invitations: try await app.invitations())
        XCTAssertEqual(invites.invitations.map(\.email), ["new@example.com"])
        XCTAssertEqual(invites.invitations.first?.aircraft, "SX-ASV (Viewer)")

        v = try core.sharing(try await app.setAircraftShareRole(asv, key: pending.key, role: .edit), myId: me)
        XCTAssertEqual(v.rows.last?.roleLabel, "Editor")

        do {
            _ = try await app.shareAircraft(asv, ShareInput(email: "copilot@example.com", role: .view))
            XCTFail("already has access")
        } catch {
            XCTAssertEqual(error.localizedDescription, "copilot@example.com already has access")
        }

        // removing the pending address takes this aircraft out of the invitation; the invitation stays
        let after = try await app.removeAircraftShare(asv, key: pending.key)
        XCTAssertEqual(try core.sharing(try XCTUnwrap(after), myId: me).rows.count, 2)
        let left = try core.invite(invitations: try await app.invitations()).invitations
        XCTAssertEqual(left.map(\.email), ["new@example.com"])
        XCTAssertEqual(left.first?.aircraft, "")
    }

    func testInvitePilots() async throws {
        let (app, core) = await makeApp()
        let h = try await app.hangar()
        var v = try core.invite(hangar: h.json, invitations: try await app.invitations())
        XCTAssertEqual(v.shareable.map(\.id), [asv])
        XCTAssertTrue(v.invitations.isEmpty)

        v = try core.invite(hangar: h.json, email: " bob@example.com ", note: " Fly with us ", picked: [(asv, .edit)])
        let body = try XCTUnwrap(v.body)
        XCTAssertEqual(
            body,
            API.InviteRequest(
                email: "bob@example.com", message: "Fly with us", aircraft: [.init(aircraftId: asv, role: .edit)]))
        let r = try await app.invite(body)
        XCTAssertEqual(try core.invite(email: "bob@example.com", response: r).done, "Invited bob@example.com.")
        let listed = try core.invite(invitations: try await app.invitations()).invitations
        XCTAssertEqual(listed.map(\.aircraft), ["SX-ASV (Editor)"])

        let existing = try await app.invite(
            API.InviteRequest(
                email: "copilot@example.com", message: "", aircraft: [.init(aircraftId: asv, role: .view)]))
        XCTAssertEqual(
            try core.invite(email: "copilot@example.com", response: existing).done,
            "copilot@example.com already uses Pig’s Gotta Fly: shared SX-ASV with them.")

        try await app.cancelInvitation(try XCTUnwrap(listed.first?.id))
        let none = try await app.invitations()
        XCTAssertTrue(try core.invite(invitations: none).invitations.isEmpty)
    }

    func testAViewerLeavesFromTheShareSheet() async throws {
        let t = FixtureTransport.bundled()!
        var shared = t.aircraft[0]
        shared["id"] = "shared-1"
        shared["access"] = ["role": "view", "owner": ["pilotId": "o", "name": "Olga", "email": "olga@example.com"]]
        t.aircraft.append(shared)
        let app = AppModel(arguments: ["-fixtures", "-noNetwork"], api: API(transport: t), store: temporaryStore())
        await app.loadPilot()
        let core = try Core.bundled()
        let me = try XCTUnwrap(app.pilot?.id)

        let hangar = try await app.hangar().items
        let item = try XCTUnwrap(hangar.first { $0.id == "shared-1" })
        XCTAssertEqual(try core.sharedChip(access: Core.text(item.access)), "Shared by Olga · Viewer")
        let v = try core.sharing(try await app.aircraftSharing("shared-1"), myId: me)
        XCTAssertFalse(v.canManage)
        XCTAssertEqual(v.rows.map(\.control), ["owner", "readOnly"])
        let mine = try XCTUnwrap(v.rows.first { $0.isSelf })
        XCTAssertTrue(mine.canRemove)
        XCTAssertEqual(mine.removeLabel, "Remove my access")
        XCTAssertFalse(v.rows[0].canRemove)

        let before = app.hangarChanged
        let gone = try await app.removeAircraftShare("shared-1", key: me)
        XCTAssertNil(gone)
        XCTAssertEqual(app.hangarChanged, before + 1)
        let items = try await app.hangar().items
        XCTAssertNil(items.first { $0.id == "shared-1" })
    }
}
