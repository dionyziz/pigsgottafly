import XCTest

@testable import PigsGottaFly

/// The operator editor's model and the documents against the fixture server (Fixtures/operators.json:
/// AEROCLUB MESOGEION, the pilot's own; AEGEAN FLYERS, shared with them to view).
@MainActor
final class OperatorTests: XCTestCase {
    private func makeApp() async -> AppModel {
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: FixtureTransport.bundled()!),
            store: temporaryStore())
        await app.loadPilot()
        return app
    }

    private func waitUntil(_ condition: () -> Bool, timeout: TimeInterval = 3) async {
        let end = Date().addingTimeInterval(timeout)
        while !condition() && Date() < end { try? await Task.sleep(for: .milliseconds(10)) }
    }

    func testTheListReadsAsTheWebsites() async throws {
        let rows = try await (await makeApp()).operatorRows()
        XCTAssertEqual(rows.map(\.id), ["op-mesogeion", "op-aegean-flyers"])
        XCTAssertEqual(rows[0].aircraft, "SX-ASV")
        XCTAssertEqual(rows[0].contact, "+30 210 000 0000 · ops@mesogeion.example")
        XCTAssertEqual(rows[0].flags.map(\.label), ["W&B + performance"])
        XCTAssertNil(rows[0].chip)
        XCTAssertEqual(rows[1].chip, "Shared by Another Pilot · Viewer")
        XCTAssertEqual(rows[1].flags.map(\.label), ["Flight plan copy"])
    }

    func testTheEditorChecksAndSavesByItself() async throws {
        let app = await makeApp()
        let op: JSON = try await app.api.operatorItem("op-mesogeion")
        let model = OperatorModel(app: app, operator: op)
        await model.loadPeople()
        var form = try XCTUnwrap(model.form(model.autosave.value))
        XCTAssertEqual(form.head.subtitle, "SX-ASV")
        XCTAssertTrue(form.head.canDelete)
        XCTAssertFalse(form.head.readOnly)
        XCTAssertEqual(form.people?.map(\.label), ["Owner"])
        XCTAssertNil(form.input["id"], "only the editable fields")

        // an issue holds the save back; fixing it saves every field
        model.autosave.update { $0["requiresFplCopy"] = true }
        model.autosave.update { $0["phone"] = "+30 210 111 1111" }
        form = try XCTUnwrap(model.form(model.autosave.value))
        XCTAssertEqual(form.issues("fplCopyEmail").map(\.message), ["Enter the e-mail address"])
        XCTAssertNil(form.body)
        await model.autosave.flush()
        var saved: JSON = try await app.api.operatorItem("op-mesogeion")
        XCTAssertEqual(saved["phone"]?.string, "+30 210 000 0000", "nothing sent while an issue holds it back")

        model.autosave.update { $0["fplCopyEmail"] = " fpl@mesogeion.example " }
        await model.autosave.flush()
        saved = try await app.api.operatorItem("op-mesogeion")
        XCTAssertEqual(saved["phone"]?.string, "+30 210 111 1111")
        XCTAssertEqual(saved["requiresFplCopy"]?.bool, true)
        XCTAssertEqual(saved["fplCopyEmail"]?.string, "fpl@mesogeion.example", "trimmed as the website saves it")

        // a rename tells the list
        let before = app.operatorsChanged
        model.autosave.update { $0["name"] = "MESOGEION FLYING CLUB" }
        await model.autosave.flush()
        XCTAssertEqual(app.operatorsChanged, before + 1)
        let renamed = try await app.operatorRows()
        XCTAssertEqual(renamed.first?.name, "MESOGEION FLYING CLUB")
    }

    func testAViewerReadsOnly() async throws {
        let app = await makeApp()
        let op: JSON = try await app.api.operatorItem("op-aegean-flyers")
        let model = OperatorModel(app: app, operator: op)
        await model.loadPeople()
        let form = try XCTUnwrap(model.form(model.autosave.value))
        XCTAssertTrue(form.head.readOnly)
        XCTAssertFalse(form.head.canDelete)
        XCTAssertEqual(form.head.viewOnly, "Shared by Another Pilot")
        XCTAssertEqual(form.head.subtitle, "No aircraft")
        XCTAssertEqual(form.people?.map(\.isSelf), [false, true])
        do {
            try await app.deleteOperator("op-aegean-flyers")
            XCTFail("only the owner deletes")
        } catch {}
    }

    func testNewOperatorAndDelete() async throws {
        let app = await makeApp()
        do {
            _ = try await app.createOperator(name: "  ")
            XCTFail("a name is needed")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Enter the operator’s name.")
        }
        let id = try await app.createOperator(name: " Island Air ")
        let made: JSON = try await app.api.operatorItem(id)
        XCTAssertEqual(made["name"]?.string, "Island Air")
        XCTAssertEqual(made["access"]?["role"]?.string, "owner")
        try await app.deleteOperator(id)
        let left = try await app.operatorRows()
        XCTAssertFalse(left.contains { $0.id == id })
    }

    func testDocumentsUploadOpenRenameRemove() async throws {
        let app = await makeApp()
        let core = try Core.bundled()
        let scope = API.FileScope.operators("op-mesogeion")
        let none = try await app.documentList(scope)
        XCTAssertEqual(try core.documents(none).rows, [])

        let pdf = Data("%PDF-1.4 fixture".utf8)
        let check = try core.documents(pick: ("application/pdf", pdf.count, "Ops Manual.pdf"), title: "")
        let start = try XCTUnwrap(check.start)
        XCTAssertEqual(start.title, "Ops Manual")
        var progress: [Double] = []
        try await app.uploadDocument(scope, data: pdf, start: start, chunkBytes: check.chunkBytes) {
            progress.append($0)
        }
        await waitUntil { progress.last == 1 }
        let list = try await app.documentList(scope)
        let row = try XCTUnwrap(try core.documents(list).rows.first)
        XCTAssertEqual(row.title, "Ops Manual")
        XCTAssertTrue(row.detail.hasPrefix("Ops Manual.pdf · 1 KB · "), row.detail)

        let file = try XCTUnwrap(try JSON.parse(list).array?.first)
        let content = try await app.downloadDocument(scope, file: file)
        XCTAssertEqual(content, pdf)

        XCTAssertNil(try core.documents(rename: (row.title, " Ops Manual ")).renamed, "nothing changed")
        let to = try XCTUnwrap(try core.documents(rename: (row.title, "OM-A")).renamed)
        let _: JSON = try await app.api.renameFile(scope, fileId: row.id, title: to)
        let afterRename = try await app.documentList(scope)
        XCTAssertEqual(try core.documents(afterRename).rows.first?.title, "OM-A")

        try await app.api.deleteFile(scope, fileId: row.id)
        let afterRemove = try await app.documentList(scope)
        XCTAssertEqual(try core.documents(afterRemove).rows, [])

        let png = try core.documents(pick: ("image/png", 10, "x.png"))
        XCTAssertEqual(png.pickError, "Choose a PDF file.")
        XCTAssertNil(png.start)
        let big = try core.documents(pick: ("application/pdf", 81 * 1_048_576, "big.pdf"))
        XCTAssertEqual(big.pickError, "The file is 81.0 MB; the limit is 80.0 MB.")
    }
}
