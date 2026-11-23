import XCTest

@testable import PigsGottaFly

/// The navlog's per-leg values typed over the computed ones (the PUT the website's NavlogStrip makes),
/// and "E-mail me the navlog" (the body of the website's MailPanel).
@MainActor
final class NavlogExportTests: XCTestCase {
    private func openFixture() async -> (FlightModel, FixtureTransport) {
        let transport = FixtureTransport.bundled()!
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        let model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        return (model, transport)
    }

    func testLegOverridesAreSavedAndReset() async throws {
        let (model, _) = await openFixture()
        let row = try XCTUnwrap(model.computed?.rows.first)
        let before = try XCTUnwrap(LegFigures.all(try XCTUnwrap(model.computed?.raw)).first)
        XCTAssertEqual(before.defaultAltFt, 1900, "the pattern altitude")

        await model.setLegOverride(
            legKey: row.key, LegOverride(altFt: 4500, tasKt: 95, windDirDeg: 270, windKt: 20, tempC: 8))
        XCTAssertEqual(
            model.flight?["legOverrides"]?[row.key],
            ["altFt": 4500, "tasKt": 95, "windDirDeg": 270, "windKt": 20, "tempC": 8])
        let l = try XCTUnwrap(model.computed?.raw["navlog"]?["legs"]?[0])
        XCTAssertEqual(l["altFt"]?.int, 4500)
        XCTAssertEqual(l["tasKt"]?.int, 95)
        XCTAssertEqual(l["windSource"]?.string, "override")
        XCTAssertEqual(l["tempC"]?.int, 8)
        XCTAssertEqual(LegFigures.all(try XCTUnwrap(model.computed?.raw))[0].wind, "270/20*")

        // the altitude alone reset: the rest stays typed
        await model.setLegOverride(legKey: row.key, LegOverride(tasKt: 95, windDirDeg: 270, windKt: 20, tempC: 8))
        XCTAssertNil(model.flight?["legOverrides"]?[row.key]?["altFt"])
        XCTAssertEqual(model.computed?.rows.first?.altFt, 1900)

        // all reset: the leg's entry goes (setAltitudeOverride / setTas on the website)
        await model.setLegOverride(legKey: row.key, LegOverride())
        XCTAssertNil(model.flight?["legOverrides"]?[row.key])
        XCTAssertEqual(LegFigures.all(try XCTUnwrap(model.computed?.raw))[0].tasKt, before.tasKt)
    }

    func testAWindNeedsBothItsDirectionAndSpeed() {
        XCTAssertFalse(LegOverride(windDirDeg: 270).valid)
        XCTAssertTrue(LegOverride(windDirDeg: 270, windKt: 0).valid)
        XCTAssertFalse(LegOverride(tasKt: 10).valid, "TAS 20…300 kt")
        XCTAssertFalse(LegOverride(altFt: 25000).valid)
        XCTAssertNil(LegOverride(windDirDeg: 270).json)
        XCTAssertEqual(LegOverride(JSON.object(["tasKt": 90])), LegOverride(tasKt: 90))
    }

    func testTheNavlogIsMailedWithItsSheets() async throws {
        let (model, _) = await openFixture()
        let core = try Core.bundled()
        let n = try core.navlogContent(
            flight: try XCTUnwrap(model.flight?.text), aircraft: try Fixtures.text("aircraft.json"),
            pilot: try Fixtures.text("pilot.json"), ref: try Fixtures.text("ref.json"), weather: "{}")
        var sent: URLRequest?
        let api = API(
            transport: FakeTransport { req in
                sent = req
                return (200, Data(#"{"to":"a@b.c","sent":{"to":"a@b.c","sentAt":1},"emailEnabled":true}"#.utf8), [:])
            })
        let state = try await api.sendNavlogMail(model.id, content: n.content, as: NavlogMailState.self)
        XCTAssertEqual(state.sent?.to, "a@b.c")
        let req = try XCTUnwrap(sent)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertTrue(req.url?.path.hasSuffix("/api/flights/fixture-lgtt-lgsy/exports/navlog/email") ?? false)
        let body = try JSON.parse(try XCTUnwrap(req.httpBody))
        XCTAssertEqual(body.object?.keys.sorted(), ["content"])
        XCTAssertEqual(body["content"], n.content, "the sheets as navlogContentOf normalizes them")

        // the fixture server answers the state with the sending
        let fixtures = API(transport: FixtureTransport.bundled()!)
        let before = try await fixtures.navlogMail(model.id, as: NavlogMailState.self)
        XCTAssertNil(before.sent)
        XCTAssertTrue(before.emailEnabled)
        let after = try await fixtures.sendNavlogMail(model.id, content: n.content, as: NavlogMailState.self)
        XCTAssertEqual(after.sent?.to, "pilot@example.com")
    }
}
