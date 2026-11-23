import XCTest

@testable import PigsGottaFly

/// The flight workspace: the tab a flight opens on, the sections of each stage, Fix routing, undo.
@MainActor
final class WorkspaceTests: XCTestCase {
    func testAPlannedFlightOfTodayOpensInFly() {
        XCTAssertEqual(FlightTab.initial(date: "2026-11-23", planned: true, isNew: false, today: "2026-11-23"), .fly)
    }

    func testAnotherDayOrAnUnplannedFlightOpensOnPlan() {
        XCTAssertEqual(FlightTab.initial(date: "2026-11-24", planned: true, isNew: false, today: "2026-11-23"), .plan)
        XCTAssertEqual(FlightTab.initial(date: "2026-11-22", planned: true, isNew: false, today: "2026-11-23"), .plan)
        XCTAssertEqual(FlightTab.initial(date: "2026-11-23", planned: false, isNew: false, today: "2026-11-23"), .plan)
    }

    func testANewFlightOpensOnPlanWhateverItsDate() {
        XCTAssertEqual(FlightTab.initial(date: "2026-11-23", planned: true, isNew: true, today: "2026-11-23"), .plan)
        XCTAssertEqual(FlightTab.initial(date: "2026-12-01", planned: true, isNew: true, today: "2026-11-23"), .plan)
    }

    func testTheAppRemembersNewFlightsAndTabs() async throws {
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork", "-today", "2026-11-22"],
            api: API(transport: FixtureTransport.bundled()!), store: temporaryStore())
        XCTAssertEqual(app.today, "2026-11-22")
        let loaded = await app.ref()
        let ref = try XCTUnwrap(loaded)
        let places = Places.aerodromes(ref: ref)
        let from = try XCTUnwrap(places.first { $0.code == "LGTT" })
        let to = try XCTUnwrap(places.first { $0.code == "LGSY" })
        let id = try await app.createFlight(NewFlight.route(from: from, to: to, localDurationMin: 60))
        XCTAssertTrue(app.isNew(id))
        XCTAssertFalse(app.isNew("fixture-lgtt-lgsy"))
        XCTAssertNil(app.rememberedTab(for: id))
        app.rememberTab(.brief, for: id)
        XCTAssertEqual(app.rememberedTab(for: id), .brief)
    }

    func testTheFixtureFlightIsPlanned() async {
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: FixtureTransport.bundled()!),
            store: temporaryStore())
        let model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        XCTAssertTrue(model.planned)
        XCTAssertEqual(
            FlightTab.initial(date: model.date, planned: model.planned, isNew: false, today: "2026-11-22"), .fly)
        XCTAssertEqual(Set(model.stages.map(\.stage)), ["plan", "brief", "file"], "PGF.readinessStages")
    }

    func testEverySectionBelongsToOneStageTab() {
        XCTAssertEqual(
            FlightSection.of(.plan), [.route, .when, .aircraft, .manifest, .fuel, .fplOptions, .navlog])
        XCTAssertEqual(FlightSection.of(.brief), [.weather, .notams, .aerodromes, .performance, .atc, .warnings])
        XCTAssertEqual(
            FlightSection.of(.file), [.flightPlan, .form731, .genDec, .wbPerf, .navlogExport, .briefing])
        XCTAssertTrue(FlightSection.of(.fly).isEmpty)
        XCTAssertEqual(Set(FlightSection.allCases.map(\.screenID)).count, FlightSection.allCases.count)
    }

    func testFixRoutesTheCoresTargetToASection() {
        var opened: (FlightSection, String?)?
        var tab: FlightTab?
        var link: URL?
        let router = FocusRouter(
            openSection: { opened = ($0, $1) }, openTab: { tab = $0 }, openLink: { link = $0 })
        router.route(CoreFocusTarget(fix: nil, focus: "fob", section: "fuel", stage: "plan", link: nil))
        XCTAssertEqual(opened?.0, .fuel)
        XCTAssertEqual(opened?.1, "fob")
        router.route(CoreFocusTarget(fix: nil, focus: nil, section: "metar", stage: "brief", link: nil))
        XCTAssertEqual(opened?.0, .weather)
        router.route(CoreFocusTarget(fix: nil, focus: nil, section: nil, stage: "file", link: nil))
        XCTAssertEqual(tab, .file)
        router.route(
            CoreFocusTarget(
                fix: nil, focus: nil, section: nil, stage: nil, link: .init(to: "/profile", label: "Profile")))
        XCTAssertEqual(link?.absoluteString, "https://pigsgottafly.com/profile")
    }

    func testAnEditCanBeUndoneAndRedone() async throws {
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: FixtureTransport.bundled()!),
            store: temporaryStore())
        let model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        let undo = UndoManager()
        undo.groupsByEvent = false
        model.undoManager = undo
        let before = model.blockOff
        undo.beginUndoGrouping()
        await model.setBlockOff("11:45")
        undo.endUndoGrouping()
        XCTAssertEqual(model.blockOff, "11:45")
        XCTAssertTrue(undo.canUndo)
        undo.undo()
        await waitUntil { model.blockOff == before && !model.saving }
        XCTAssertEqual(model.blockOff, before)
        XCTAssertTrue(undo.canRedo)
        undo.redo()
        await waitUntil { model.blockOff == "11:45" && !model.saving }
        XCTAssertEqual(model.blockOff, "11:45")
    }

    private func waitUntil(_ condition: () -> Bool, timeout: TimeInterval = 5) async {
        let end = Date().addingTimeInterval(timeout)
        while !condition() && Date() < end { try? await Task.sleep(for: .milliseconds(20)) }
    }
}
