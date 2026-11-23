import XCTest

@testable import PigsGottaFly

/// The passenger editor on the fixture server: the core's check (problems, what the forms lack), a
/// saved passenger's autosave held back by a problem, a new one added only once it can be, Delete
/// and Undo, and an address added here reaching Form 731.
@MainActor
final class PassengerEditorTests: XCTestCase {
    private func app() -> (AppModel, FixtureTransport) {
        let transport = FixtureTransport.bundled()!
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        return (app, transport)
    }

    private func server(_ app: AppModel, _ id: String) async throws -> JSON {
        try await app.api.passenger(id, as: JSON.self)
    }

    func testASavedPassengerSavesByItselfOnlyWithoutProblems() async throws {
        let (app, _) = app()
        let editor = PassengerEditor()
        await editor.open(app: app, id: "pax-nikos")
        XCTAssertEqual(editor.form?["fullName"], "NIKOS GEORGIOU")
        XCTAssertEqual(editor.missing.map(\.label), ["weight", "ID", "date of birth", "phone"])

        editor.change(app: app) { $0["weightKg"] = 82 }
        editor.change(app: app) { $0["idNumber"] = "AK 123456" }
        await editor.flush()
        var saved = try await server(app, "pax-nikos")
        XCTAssertEqual(saved["weightKg"]?.double, 82)
        XCTAssertEqual(saved["idNumber"], "AK 123456")
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(editor.missing.map(\.label), ["date of birth", "phone"])

        // not an address: shown under the field, and nothing goes to the server
        editor.change(app: app) { $0["email"] = "nikos-at-example" }
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(editor.shownIssues("email"), ["Not an e-mail address"])
        await editor.flush()
        XCTAssertEqual(editor.autosave?.error, "Not saved: fix the details first")
        saved = try await server(app, "pax-nikos")
        XCTAssertEqual(saved["email"], "nikos@example.com")

        editor.change(app: app) { $0["email"] = " nikos@example.org " }
        await editor.flush()
        saved = try await server(app, "pax-nikos")
        XCTAssertEqual(saved["email"], "nikos@example.org", "saved as the website normalizes it")
        XCTAssertNil(editor.autosave?.error)
    }

    func testANewPassengerIsAddedOnceItCanBe() async throws {
        let (app, _) = app()
        let editor = PassengerEditor()
        await editor.open(app: app, id: nil)
        editor.change(app: app) { $0["fullName"] = "Robin  Rider" }
        XCTAssertEqual(editor.shownIssues("email"), [], "not before Add is tried")
        let refused = await editor.add(app: app)
        XCTAssertFalse(refused)
        XCTAssertEqual(editor.shownIssues("email"), ["Enter the e-mail address"])

        editor.change(app: app) { $0["email"] = "robin@example.com" }
        let added = await editor.add(app: app)
        XCTAssertTrue(added)
        let list = try await app.api.passengers(as: [JSON].self)
        XCTAssertTrue(list.contains { $0["fullName"] == "Robin Rider" && $0["email"] == "robin@example.com" })
    }

    func testDeleteThenUndoBringsTheDetailsBack() async throws {
        let (app, _) = app()
        let editor = PassengerEditor()
        await editor.open(app: app, id: "pax-maria")
        await editor.delete(app: app)
        XCTAssertEqual(editor.deleted?["fullName"], "MARIA KOSTA")
        XCTAssertNil(editor.form)
        var list = try await app.api.passengers(as: [JSON].self)
        XCTAssertFalse(list.contains { $0["fullName"] == "MARIA KOSTA" })

        await editor.restore(app: app)
        XCTAssertNil(editor.deleted)
        let id = try XCTUnwrap(editor.id)
        XCTAssertNotEqual(id, "pax-maria", "a new record")
        XCTAssertEqual(editor.form?["idNumber"], "P1234567")
        list = try await app.api.passengers(as: [JSON].self)
        XCTAssertTrue(list.contains { $0["id"]?.string == id && $0["nationality"] == "CYPRIOT" })
    }

    func testAnAddressAddedHereReachesForm731() async throws {
        let (app, _) = app()
        let editor = PassengerEditor()
        await editor.open(app: app, id: "pax-anna")
        editor.change(app: app) { $0["email"] = "anna@example.org" }
        await editor.flush()
        let forms = try JSON.parse(try await app.api.forms("fixture-forms"))
        let anna = forms["form731"]?["signatures"]?.array?.first { $0["key"] == "pax-anna" }
        XCTAssertEqual(anna?["email"], "anna@example.org")
    }
}
