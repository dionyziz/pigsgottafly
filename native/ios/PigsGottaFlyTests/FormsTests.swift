import XCTest

@testable import PigsGottaFly

/// Form 731's signatures and sending, the General Declaration's sending and who sends it, and the
/// operator's W&B and performance sheets, on the fixture server (it simulates the links, the
/// passengers signing and the e-mails): the panels say what the website's say, and the File & forms
/// rows follow every answer.
@MainActor
final class FormsTests: XCTestCase {
    private func open() async throws -> (FlightModel, FormsModel, Core) {
        let transport = FixtureTransport.bundled()!
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        let model = FlightModel(id: "fixture-forms", app: app)
        await model.open()
        let forms = FormsModel(flight: model)
        await forms.load()
        return (model, forms, try XCTUnwrap(app.core))
    }

    private func row(_ model: FlightModel, _ id: String) -> ReadyItem? {
        model.readiness(stage: "file").first { $0.id == id }
    }

    private func panel(_ core: Core, _ forms: FormsModel) throws -> CoreForm731Panel {
        try core.form731Panel(forms: try XCTUnwrap(forms.forms?.text), links: forms.links)
    }

    func testForm731IsSignedThenSentToTheHCAA() async throws {
        let (model, forms, core) = try await open()
        var p = try panel(core, forms)
        XCTAssertEqual(p.summary, "1 of 2 signed · ANNA: no link yet")
        XCTAssertEqual(p.people.map(\.key), ["PIC", "pax-anna"])
        XCTAssertEqual(p.people[1].status, "no link")
        XCTAssertEqual(p.people[1].actions, .init(renew: false, revoke: false, email: true, addEmail: false))
        XCTAssertEqual(p.request, .init(shown: true, enabled: true))
        XCTAssertEqual(
            p.send, CoreFormButton(label: "Send to HCAA", enabled: false, hint: "Everyone has to sign first"))
        XCTAssertEqual(row(model, "form731")?.text, "1 signature missing, then send it.")

        await forms.requestLinks()
        XCTAssertNil(forms.error)
        let token = try XCTUnwrap(forms.links["pax-anna"])
        XCTAssertNil(forms.forms?["links"], "a token is not saved")
        p = try panel(core, forms)
        XCTAssertEqual(p.people[1].link?.url, "https://pigsgottafly.com/sign/\(token)")
        XCTAssertEqual(
            p.people[1].link?.text,
            "Please sign Form 731 (persons boarding) for our flight on 2026-11-22, ANNA PAPADOPOULOU:")
        XCTAssertTrue(p.people[1].status.hasPrefix("link created"), p.people[1].status)
        XCTAssertEqual(p.people[1].actions, .init(renew: true, revoke: true, email: true, addEmail: false))
        XCTAssertFalse(p.request.enabled, "everyone has a link")

        // Anna signs on the signing page; the next read shows it
        await forms.load()
        p = try panel(core, forms)
        XCTAssertEqual(p.summary, "2 of 2 signed")
        XCTAssertTrue(p.people[1].signed)
        XCTAssertEqual(p.signatures.keys.sorted(), ["PIC", "pax-anna"])
        XCTAssertTrue(p.send.enabled)
        XCTAssertEqual(row(model, "form731")?.text, "Signed: send it.")

        await forms.send731()
        XCTAssertNil(forms.error)
        p = try panel(core, forms)
        XCTAssertEqual(p.sent?.hasPrefix("Sent to 731@hcaa.gov.gr on "), true)
        XCTAssertEqual(p.send.label, "Re-send to HCAA")
        XCTAssertFalse(p.send.enabled, "this version was sent")
        XCTAssertEqual(row(model, "form731")?.state, .ok)
        XCTAssertEqual(row(model, "form731")?.text, "Sent.")
        XCTAssertEqual(
            model.app.store.decode(JSON.self, .forms(model.id))?["form731"]?["submission"]?["to"], "731@hcaa.gov.gr")

        // the server refuses a second send of the same version, in its own words
        await forms.send731()
        XCTAssertEqual(forms.error?.hasPrefix("this version of the form was already sent"), true)
    }

    func testLinksAreRevokedRenewedAndEmailed() async throws {
        let (_, forms, core) = try await open()
        await forms.email("pax-anna")
        var p = try panel(core, forms)
        XCTAssertEqual(p.people[1].emailed?.hasPrefix("e-mailed "), true)
        XCTAssertNil(p.people[1].link, "the e-mailed link is in the e-mail only")
        await forms.revoke("pax-anna")
        p = try panel(core, forms)
        XCTAssertEqual(p.people[1].status, "no link")
        XCTAssertEqual(p.people[1].actions.renew, true)
        XCTAssertEqual(p.people[1].actions.revoke, false)
        await forms.renew("pax-anna")
        XCTAssertNotNil(forms.links["pax-anna"])
        p = try panel(core, forms)
        XCTAssertNotNil(p.people[1].link)
        XCTAssertEqual(p.people[1].actions.revoke, true)
        // sending before everyone signed: the server's reason
        await forms.revoke("pax-anna")
        await forms.load()
        await forms.send731()
        XCTAssertEqual(forms.error, "not everyone has signed: ANNA PAPADOPOULOU")
    }

    func testTheGeneralDeclarationIsSentAndItsSenderChosen() async throws {
        let (model, forms, core) = try await open()
        let st = { try XCTUnwrap(forms.forms?.text) }
        var g = try core.genDecPanel(forms: try st())
        XCTAssertEqual(g.status, "Not sent")
        XCTAssertEqual(
            g.ends.map { "\($0.label) \($0.reason)" },
            [
                "Departure LGTT: no handling (AIP AD 1.6.5.4)", "Destination LGSY: handling 0600-1800 (AIP AD 2.3)",
            ])
        XCTAssertFalse(g.handled)
        XCTAssertEqual(g.send, CoreFormButton(label: "Send to HCAA", enabled: true, hint: nil))
        XCTAssertEqual(g.signature?.name, "FIXTURE PILOT")
        XCTAssertEqual(row(model, "gendec")?.text, "No handler at one end: send it yourself.")

        await forms.sendGenDec()
        g = try core.genDecPanel(forms: try st())
        XCTAssertEqual(g.status, "Sent")
        XCTAssertEqual(g.sent?.hasPrefix("Sent to gendec@hcaa.gov.gr on "), true)
        XCTAssertEqual(row(model, "gendec")?.text, "Sent.")

        // a handler submits it: the flight keeps the choice; back to the automatic decision it is automatic
        XCTAssertEqual(try core.genDecPanel(forms: try st(), handled: true).override, true)
        XCTAssertNil(try core.genDecPanel(forms: try st(), handled: false).override)
        let before = model.version
        await forms.setHandled(true)
        g = try core.genDecPanel(forms: try st())
        XCTAssertEqual(g.status, "Handled")
        XCTAssertTrue(g.handled)
        XCTAssertNil(g.send)
        XCTAssertEqual(g.automatic, "Automatic: you send it")
        XCTAssertNil(row(model, "gendec"), "nothing for the PIC to send")
        XCTAssertEqual(model.flight?["options"]?["genDecHandled"], true)
        XCTAssertEqual(model.version, before + 1, "the flight was read again at its new version")
        await forms.setHandled(nil)
        XCTAssertNil(try core.genDecPanel(forms: try st()).automatic)
    }

    func testTheOperatorGetsTheSheetsOnce() async throws {
        let (model, forms, core) = try await open()
        let inputs = try XCTUnwrap(SheetInputs(app: model.app, model: model))
        let sheets = try core.wbPerfContent(
            flight: inputs.flight, aircraft: inputs.aircraft, pilot: inputs.pilot, ref: inputs.ref,
            weather: inputs.weather)
        let decl = { forms.declarations?.text }
        var p = try XCTUnwrap(try core.operatorPanel(declarations: decl(), hash: sheets.hash, ready: true))
        XCTAssertEqual(p.title, "Send to Aeroclub Mesogeion")
        XCTAssertEqual(p.status, "Not sent")
        XCTAssertEqual(p.address, "ops@example.com")
        XCTAssertTrue(p.send.enabled)
        XCTAssertEqual(row(model, "operator")?.text, "Not sent yet.")

        await forms.sendDeclarations(content: sheets.content, resend: p.send.resend)
        XCTAssertNil(forms.error)
        p = try XCTUnwrap(try core.operatorPanel(declarations: decl(), hash: sheets.hash, ready: true))
        XCTAssertEqual(p.status, "Sent", "the server's hash of the sent sheets is the app's of the shown ones")
        XCTAssertFalse(p.send.enabled)
        XCTAssertEqual(p.send.label, "Re-send")
        XCTAssertEqual(row(model, "operator")?.state, .ok)
        // other sheets: changed since sent
        let other = try XCTUnwrap(try core.operatorPanel(declarations: decl(), hash: "other", ready: true))
        XCTAssertEqual(other.status, "Changed since it was sent")
        XCTAssertTrue(other.send.enabled)

        XCTAssertNil(
            try core.operatorPanel(declarations: try Fixtures.text("declarations.json"), hash: nil, ready: true))
    }

    func testAnErrorIsTheServersOwnWords() {
        let body = Data(#"{"error":"not everyone has signed: ANNA"}"#.utf8)
        XCTAssertEqual(FormsModel.errText(APIError.conflict(body)), "not everyone has signed: ANNA")
        XCTAssertEqual(FormsModel.errText(APIError.offline), "Offline: try again when connected.")
        XCTAssertEqual(FormsModel.errText(APIError.http(429, "Too many e-mails today")), "Too many e-mails today")
    }
}
