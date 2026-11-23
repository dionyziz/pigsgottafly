import Foundation

// The manifest's edits as the website's Manifest section makes them (src/features/editor/panels/
// ManifestSection.tsx): every change goes through PGF.manifest, inside the edit, so that a 409 applies
// it again to the server's crew rather than overwriting it with ours.

/// A manifest snapshot's fields (src/shared/types.ts PersonDetails, PERSON_KEYS).
enum CrewField: String, CaseIterable, Sendable {
    case fullName, phone, dateOfBirth, weightKg, idNumber, idType, nationality, relation
}

/// A point of the W&B (src/calc/wb.ts WbPoint).
struct WbLoadPoint: Equatable, Sendable {
    var massKg: Double
    var armM: Double
    var momentKgM: Double

    init(massKg: Double, armM: Double, momentKgM: Double) {
        self.massKg = massKg
        self.armM = armM
        self.momentKgM = momentKgM
    }

    init?(_ j: JSON?) {
        guard let j, let m = j["massKg"]?.double, let a = j["armM"]?.double, let mo = j["momentKgM"]?.double
        else { return nil }
        self.init(massKg: m, armM: a, momentKgM: mo)
    }
}

/// computeFlight's W&B as the Manifest section shows it (FlightCalc wb, wbOk, wbMissingWeights, stops).
struct WbSummary: Equatable {
    enum Status: Equatable {
        case ok, incomplete, out
    }
    /// An intermediate full stop or touch-and-go (StopCalc with a W&B).
    struct Stop: Equatable, Identifiable {
        var id: String
        /// 'Stop LGSY', 'Touch-and-go LGTG'
        var title: String
        /// The chart's label (the ICAO, else the point's name).
        var label: String
        var point: WbLoadPoint
        var ok: Bool?
        var fuelL: Double?
    }

    var takeoff: WbLoadPoint
    var landing: WbLoadPoint
    var takeoffOk: Bool
    var landingOk: Bool
    var loadingOk: Bool
    /// The people with no weight (counted as 0 kg).
    var missingWeights: [String]
    var stops: [Stop]
    /// Station and combined maxima broken: shown under the baggage.
    var loadBreaches: [String]
    var fobL: Double?
    var status: Status?

    init?(_ raw: JSON) {
        let wb = raw["wb"]
        guard let to = WbLoadPoint(wb?["takeoff"]), let ldg = WbLoadPoint(wb?["landing"]) else { return nil }
        takeoff = to
        landing = ldg
        let ok = raw["wbOk"]
        takeoffOk = ok?["takeoff"]?.bool ?? true
        landingOk = ok?["landing"]?.bool ?? true
        loadingOk = ok?["loading"]?.bool ?? true
        missingWeights = (raw["wbMissingWeights"]?.array ?? []).compactMap(\.string)
        stops = (raw["stops"]?.array ?? []).enumerated().compactMap { i, s in
            guard let p = WbLoadPoint(s["wb"]) else { return nil }
            let name = s["aerodrome"]?["icao"]?.string.flatMap { $0.isEmpty ? nil : $0 } ?? s["point"]?["name"]?.string
            let label = name ?? "?"
            let tng = s["kind"]?.string == "touch-and-go"
            return Stop(
                id: "\(s["point"]?["uid"]?.string ?? String(i))-\(s["kind"]?.string ?? "")",
                title: "\(tng ? "Touch-and-go" : "Stop") \(label)", label: label, point: p, ok: s["wbOk"]?.bool,
                fuelL: s["fuelL"]?.double)
        }
        loadBreaches = (wb?["limitBreaches"]?.array ?? []).compactMap { b in
            let k = b["kind"]?.string
            return k == "station" || k == "combined" ? b["text"]?.string : nil
        }
        fobL = raw["fuel"]?["fobL"]?.double
        if ok == nil || ok == .null {
            status = nil
        } else if !(takeoffOk && landingOk && loadingOk) || stops.contains(where: { $0.ok == false }) {
            status = .out
        } else {
            status = missingWeights.isEmpty ? .ok : .incomplete
        }
    }
}

extension FlightModel {
    /// The flight's aircraft as cached (GET /api/aircraft/:id); nil without one.
    var manifestAircraft: JSON? {
        guard let id = flight?["aircraftId"]?.string, let t = app.store.text(.aircraft(id)) else { return nil }
        return try? JSON.parse(t)
    }

    var crew: [JSON] { flight?["crew"]?.array ?? [] }

    /// The aircraft's M&B stations as the core takes them; nil without an aircraft (a four-seater's seats).
    func manifestStations(_ aircraft: JSON?) -> String? {
        aircraft?["massBalance"]?["stations"].map(\.text)
    }

    /// The manifest as it is: seats, whether every seat is taken, the PIC seat, validateCrew.
    func manifestState(aircraft: JSON?) -> CoreManifest? {
        try? app.core?.manifest(crew: JSON.array(crew).text, stations: manifestStations(aircraft), .seats)
    }

    /// What `op` would make of the crew now, without saving it (whether the PIC fits, who moves).
    func previewManifest(_ op: CoreManifestOp, aircraft: JSON?) -> CoreManifest? {
        try? app.core?.manifest(crew: JSON.array(crew).text, stations: manifestStations(aircraft), op)
    }

    /// Makes one change of the manifest and saves it; returns the core's answer for the crew as it was
    /// (nil without the core or on a flight shared for viewing). A change the core refuses (every seat
    /// taken) or one that changes nothing saves nothing.
    @discardableResult
    func changeManifest(_ op: CoreManifestOp, aircraft: JSON?) async -> CoreManifest? {
        guard let core = app.core, !readOnly else { return nil }
        let stations = manifestStations(aircraft)
        let before = JSON.array(crew)
        guard let r = try? core.manifest(crew: before.text, stations: stations, op) else { return nil }
        guard r.ok, r.crew != before else { return r }
        await edit { f in
            let now = f["crew"] ?? .array([])
            guard let again = try? core.manifest(crew: now.text, stations: stations, op), again.ok else { return }
            f["crew"] = again.crew
        }
        return r
    }

    /// A baggage station's load; nil or 0 takes it off (the website keeps no zero entries).
    func setBaggage(station: String, kg: Double?) async {
        await edit { f in
            var b = f["baggageKg"]?.object ?? [:]
            if let kg, kg != 0 { b[station] = .number(kg) } else { b[station] = nil }
            f["baggageKg"] = .object(b)
        }
    }

    func setCategory(_ category: String) async {
        await edit { f in
            var o = f["options"]?.object ?? [:]
            o["category"] = .string(category)
            f["options"] = .object(o)
        }
    }

    var wbSummary: WbSummary? { computed.flatMap { WbSummary($0.raw) } }

    /// The W&B chart's envelopes and axes holding the take-off, stop and landing points.
    func wbChart(aircraft: JSON?, points: [WbLoadPoint]) -> CoreWbChart? {
        guard let mb = aircraft?["massBalance"], let core = app.core else { return nil }
        return try? core.wbChart(
            massBalance: mb.text, points: points.map { CoreWbChart.Point(massKg: $0.massKg, momentKgM: $0.momentKgM) })
    }
}

/// The passenger form as the website's PassengerDialog and PilotDetailsDialog hold it
/// (src/features/passengers/person.ts PersonForm).
struct CrewPersonForm: Equatable {
    var fullName = ""
    var phone = ""
    var dateOfBirth = ""
    var weightKg: Double?
    var idType = ""
    var idNumber = ""
    var nationality = ""
    var relation = ""
    /// A passenger's (nil for the pilot: theirs is the sign-in address).
    var email: String? = ""
    var notes = ""
    /// The pilot's only.
    var licenceNo: String?

    init(initialName: String = "") {
        fullName = initialName
    }

    /// The core's form of a saved record (personIssues `form`).
    init(_ j: JSON) {
        fullName = j["fullName"]?.string ?? ""
        phone = j["phone"]?.string ?? ""
        dateOfBirth = j["dateOfBirth"]?.string ?? ""
        weightKg = j["weightKg"]?.double
        idType = j["idType"]?.string ?? ""
        idNumber = j["idNumber"]?.string ?? ""
        nationality = j["nationality"]?.string ?? ""
        relation = j["relation"]?.string ?? ""
        email = j["email"]?.string
        notes = j["notes"]?.string ?? ""
        licenceNo = j["licenceNo"]?.string
    }

    var json: JSON {
        var o: [String: JSON] = [
            "fullName": .string(fullName), "phone": .string(phone), "dateOfBirth": .string(dateOfBirth),
            "weightKg": weightKg.map { .number($0) } ?? .null, "idType": .string(idType),
            "idNumber": .string(idNumber), "nationality": .string(nationality), "relation": .string(relation),
            "notes": .string(notes),
        ]
        if let email { o["email"] = .string(email) }
        if let licenceNo { o["licenceNo"] = .string(licenceNo) }
        return .object(o)
    }
}

/// The Manifest section's lists and what it remembers between changes: the passenger list (GET
/// /api/passengers), the people as last seen (so that their snapshots follow edits made elsewhere),
/// the note after "Add me as PIC" moved someone, and the offer to stop sharing with a removed passenger.
@MainActor
final class ManifestModel: ObservableObject {
    let flight: FlightModel
    @Published private(set) var passengers: [JSON] = []
    @Published private(set) var passengersLoaded = false
    @Published private(set) var picNote: String?
    @Published var unshare: Unshare?
    @Published var error: String?

    struct Unshare: Equatable, Identifiable {
        var name: String
        /// The pilot's id (DELETE /flights/:id/shares/:key).
        var key: String
        var id: String { key }
    }

    /// { 'PIC' | passengerId: person } at the last sync (useCrewSync's `seen`).
    private var seen: JSON?
    private var noteTask: Task<Void, Never>?

    init(flight: FlightModel) {
        self.flight = flight
    }

    private var app: AppModel { flight.app }
    var aircraft: JSON? { flight.manifestAircraft }
    var pilot: JSON? { app.store.text(.pilot).flatMap { try? JSON.parse($0) } }

    func passenger(_ id: String?) -> JSON? {
        guard let id else { return nil }
        return passengers.first { $0["id"]?.string == id }
    }

    /// The passengers not on board whose name holds `query` (PersonPicker's matchPeople, without its
    /// limit of eight: the sheet scrolls).
    func candidates(_ query: String) -> [JSON] {
        let onBoard = Set(flight.crew.compactMap { $0["passengerId"]?.string })
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return passengers.filter { p in
            guard let id = p["id"]?.string, !onBoard.contains(id) else { return false }
            return q.isEmpty || (p["fullName"]?.string ?? "").lowercased().contains(q)
        }
    }

    // MARK: lists

    func load() async {
        do {
            let list: JSON = try await app.api.passengers()
            passengers = list.array ?? []
            passengersLoaded = true
            error = nil
        } catch APIError.unauthorized {
            app.session.lost()
            return
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
            return
        }
        await sync()
    }

    /// The snapshots follow their people (passenger list, profile) except the fields edited on the
    /// flight; a passenger gone from the list is unlinked.
    func sync() async {
        guard passengersLoaded else { return }
        var now: [String: JSON] = [:]
        for p in passengers { if let id = p["id"]?.string { now[id] = p } }
        if let pilot { now["PIC"] = pilot }
        let before = seen
        seen = .object(now)
        await flight.changeManifest(.sync(before: before, now: .object(now)), aircraft: aircraft)
    }

    // MARK: changes

    func add(_ passenger: JSON) async {
        await flight.changeManifest(.addPassenger(passenger), aircraft: aircraft)
    }

    /// The PIC back in front left; whoever sat there moves to a free seat, and a note says where.
    func addPic() async {
        guard let pilot else { return }
        let ac = aircraft
        guard let r = await flight.changeManifest(.addPic(pilot: pilot), aircraft: ac), r.ok else { return }
        noteTask?.cancel()
        guard let moved = r.moved, moved != .null else {
            picNote = nil
            return
        }
        let seats = r.seats
        let seat = moved["seat"]?.string ?? ""
        let label = (seats.first { $0.id == seat }?.label ?? seat).lowercased()
        let name = moved["snapshot"]?["fullName"]?.string ?? ""
        picNote = "\(name.isEmpty ? "The passenger" : name) moved to \(label) to free the PIC seat."
        noteTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            self?.picNote = nil
        }
    }

    func changeSeat(_ index: Int, to seat: String) async {
        await flight.changeManifest(.changeSeat(index: index, seat: seat), aircraft: aircraft)
    }

    func editField(_ index: Int, _ key: CrewField, _ value: JSON) async {
        await flight.changeManifest(.editField(index: index, key: key.rawValue, value: value), aircraft: aircraft)
    }

    /// The person a row is linked to: the profile for the PIC, the passenger record for a passenger.
    func source(of row: JSON) -> JSON? {
        row["role"]?.string == "PIC" ? pilot : passenger(row["passengerId"]?.string)
    }

    /// "Reset from the saved details": the person's details again, nothing kept from the flight.
    func reset(_ index: Int) async {
        let crew = flight.crew
        guard crew.indices.contains(index), let src = source(of: crew[index]) else { return }
        await flight.changeManifest(.reset(index: index, person: src), aircraft: aircraft)
    }

    /// Takes a passenger off; if the flight is shared with their e-mail (and the pilot manages the
    /// sharing), offers to stop sharing it with them as well.
    func remove(_ index: Int) async {
        let crew = flight.crew
        guard crew.indices.contains(index), crew[index]["role"]?.string == "PAX" else { return }
        let row = crew[index]
        await flight.changeManifest(.remove(index: index), aircraft: aircraft)
        let email = (passenger(row["passengerId"]?.string)?["email"]?.string ?? "")
            .trimmingCharacters(in: .whitespaces).lowercased()
        guard !email.isEmpty, !flight.readOnly,
            let sharing: JSON = try? await app.api.flightShares(flight.id),
            sharing["canManage"]?.bool == true,
            let who = (sharing["people"]?.array ?? []).first(where: {
                ($0["email"]?.string ?? "").trimmingCharacters(in: .whitespaces).lowercased() == email
            }),
            who["role"]?.string != "owner", let key = who["pilotId"]?.string, key != pilot?["id"]?.string
        else { return }
        let snapName = row["snapshot"]?["fullName"]?.string ?? ""
        let name = [snapName, who["name"]?.string ?? "", who["email"]?.string ?? ""].first { !$0.isEmpty } ?? ""
        unshare = Unshare(name: name, key: key)
    }

    func stopSharing(_ u: Unshare) async {
        do {
            try await app.api.removeFlightShare(flight.id, key: u.key)
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    // MARK: people's records

    /// The form's problems (PGF.personIssues) and, without any, the body to send.
    func check(_ form: CrewPersonForm, pilot: Bool) -> CorePersonIssues? {
        try? app.core?.personIssues(form: form.json.text, pilot: pilot, today: app.today)
    }

    /// POST /passengers, then the new passenger on the manifest (the website's "Create “…”").
    func create(_ form: CrewPersonForm) async throws {
        guard let input = check(form, pilot: false)?.input else { return }
        let p: JSON = try await app.api.createPassenger(input)
        await reloadPassengers()
        await add(p)
    }

    /// PUT /passengers/:id; the rows linked to them take the saved details but the fields edited on
    /// this flight.
    func update(passengerId: String, _ form: CrewPersonForm) async throws {
        guard let input = check(form, pilot: false)?.input else { return }
        let p: JSON = try await app.api.updatePassenger(passengerId, patch: input)
        for (i, c) in flight.crew.enumerated() where c["passengerId"]?.string == passengerId {
            await flight.changeManifest(.apply(index: i, person: p), aircraft: aircraft)
        }
        await reloadPassengers()
    }

    /// PUT /me with the profile's person fields and licence (PilotDetailsDialog); the PIC row follows.
    func updatePilot(_ form: CrewPersonForm) async throws {
        guard var o = check(form, pilot: true)?.input?.object else { return }
        o["notes"] = nil
        o["email"] = nil
        o["licenceNo"] = .string((form.licenceNo ?? "").trimmingCharacters(in: .whitespaces))
        let data = try await app.api.updateMe(.object(o))
        try? app.store.write(data, .pilot)
        let p = try JSON.parse(data)
        // the next sync starts from the saved profile: it has nothing more to change
        if var s = seen?.object {
            s["PIC"] = p
            seen = .object(s)
        }
        for (i, c) in flight.crew.enumerated() where c["role"]?.string == "PIC" {
            await flight.changeManifest(.apply(index: i, person: p), aircraft: aircraft)
        }
        await app.loadPilot()
    }

    private func reloadPassengers() async {
        guard let list: JSON = try? await app.api.passengers() else { return }
        passengers = list.array ?? []
        // the records as saved are what the snapshots were just given: the next sync starts from them
        if var s = seen?.object {
            for p in passengers { if let id = p["id"]?.string { s[id] = p } }
            seen = .object(s)
        }
    }
}
