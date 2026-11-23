import PDFKit
import XCTest

@testable import PigsGottaFly

/// The sheets printed on the device (SheetRenderer: the web's PDF page in WKWebView, A4 pages) from the
/// core's documents of the fixture flight. The page counts are the server's Chromium print of the
/// same snapshots (tools/build_native_pdf.ts's page; Fixtures/pdf holds the longer snapshots).
/// PGF_PDF_OUT (TEST_RUNNER_PGF_PDF_OUT for xcodebuild) keeps each snapshot and PDF there, for the
/// comparison with the web print.
@MainActor
final class SheetRendererTests: XCTestCase {
    private var core: Core!
    private var flight: String!
    private var aircraft: String!
    private var pilot: String!
    private var ref: String!
    private var weather: String!

    override func setUp() async throws {
        core = try Core.bundled()
        flight = try Fixtures.text("flight.json")
        aircraft = try Fixtures.text("aircraft.json")
        pilot = try Fixtures.text("pilot.json")
        ref = try Fixtures.text("ref.json")
        weather = Core.object(["/api/weather/metar?ids=LGSY,LGTT": try Fixtures.text("metar.json")])
    }

    private func render(_ kind: SheetRenderer.Kind, _ content: JSON, name: String) async throws -> PDFDocument {
        let data = try await SheetRenderer.pdf(kind, content: content)
        XCTAssertEqual(data.prefix(5), Data("%PDF-".utf8))
        if let out = ProcessInfo.processInfo.environment["PGF_PDF_OUT"] {
            let dir = URL(fileURLWithPath: out)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let snap = JSON.object(["kind": .string(kind.rawValue), "content": content])
            try snap.data().write(to: dir.appendingPathComponent("\(name).json"))
            try data.write(to: dir.appendingPathComponent("\(name).pdf"))
        }
        return try XCTUnwrap(PDFDocument(data: data))
    }

    private func size(_ doc: PDFDocument, page: Int = 0) -> CGSize {
        doc.page(at: page)?.bounds(for: .mediaBox).size ?? .zero
    }

    func testTheNavlogIsOneLandscapePagePerSheet() async throws {
        let n = try core.navlogContent(flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        let one = try await render(.navlog, n.content, name: "navlog-1")
        XCTAssertEqual(one.pageCount, 1)
        XCTAssertEqual(size(one).width, 841.89, accuracy: 0.5)
        XCTAssertEqual(size(one).height, 595.28, accuracy: 0.5)
        XCTAssertTrue(one.string?.contains("SX-ASV") ?? false, "vector text with the registration")

        var three = n.content
        let sheet = try XCTUnwrap(n.content["sheets"]?[0])
        three["sheets"] = .array([sheet, sheet, sheet])
        let doc = try await render(.navlog, three, name: "navlog-3")
        XCTAssertEqual(doc.pageCount, 3)
    }

    func testTheBriefingOnA4Portrait() async throws {
        let m = try core.briefingModel(flight: flight, briefing: try Fixtures.text("notams.json"))
        let doc = try await render(.briefing, m, name: "briefing")
        XCTAssertEqual(doc.pageCount, 1)
        XCTAssertEqual(size(doc).width, 595.28, accuracy: 0.5)
        XCTAssertTrue(doc.string?.contains("NOTAM BRIEFING") ?? false)

        let long = try JSON.parse(try Fixtures.data("pdf/briefing-long.json"))
        let longDoc = try await render(.briefing, long, name: "briefing-long")
        XCTAssertEqual(longDoc.pageCount, 4)
    }

    func testTheFlightPlanFormIsOnePage() async throws {
        let m = try core.fplMessage(flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        let content = JSON.object([
            "fpl": try JSON.parse(Core.text(m.fpl)), "addresses": .array([.string("LGGGZPZX")]),
        ])
        let doc = try await render(.fplform, content, name: "fplform")
        XCTAssertEqual(doc.pageCount, 1)
        XCTAssertTrue(doc.string?.contains("FLIGHT PLAN") ?? false)
        XCTAssertTrue(doc.string?.contains("KALAMO KIMI") ?? false)
    }

    func testEmptyContentIsAnError() async {
        do {
            _ = try await SheetRenderer.pdf(snapshot: .null, kind: .briefing, timeout: 5)
            XCTFail("rendered nothing into a PDF")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("did not render"), error.localizedDescription)
        }
    }
}
