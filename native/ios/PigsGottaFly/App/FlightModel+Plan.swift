import Foundation

/// Plan's edits of the flight, each one undo step through `edit`. Where the website's section does more
/// than set a field (the route, the aircraft, the fuel, the requests, the alternates), the core makes
/// the change with the website's own functions, so the PUT carries what the website would send.
extension FlightModel {
    // MARK: when

    func setDate(_ day: String) async {
        await edit { $0["date"] = .string(day) }
    }

    func setBlockOff(_ clock: String) async {
        await edit { $0["blockOff"] = .string(clock) }
    }

    /// Block start → take-off (nil: not set, which the planning warns about), minutes 0…180.
    func setTaxiOut(_ minutes: Int?) async {
        await edit { $0["taxiOutMin"] = Self.minutes(minutes, max: 180) }
    }

    func setTaxiIn(_ minutes: Int?) async {
        await edit { $0["taxiInMin"] = Self.minutes(minutes, max: 180) }
    }

    /// The website's NumberField: out of range is clamped, empty is null.
    nonisolated static func minutes(_ m: Int?, max: Int) -> JSON {
        m.map { .number(Double(Swift.min(Swift.max($0, 0), max))) } ?? .null
    }

    /// A local flight's airborne time (FlightOptions.localDurationMin), minutes.
    func setLocalDuration(_ minutes: Int) async {
        await setOption("localDurationMin", .number(Double(minutes)))
    }

    func setOption(_ key: String, _ value: JSON) async {
        await edit { f in
            var o = f["options"]?.object ?? [:]
            o[key] = value
            f["options"] = .object(o)
        }
    }

    // MARK: route

    /// One route edit by the core (PGF.routeEdit): the route and the leg overrides it keeps. An edit the
    /// core refuses (an unknown aerodrome) is reported and changes nothing.
    @discardableResult
    func routeEdit(_ ops: [CoreRouteOp]) async -> Bool {
        guard let core = app.core, var probe = flight, !readOnly else { return false }
        let needsRef = ops.contains { if case .setEnd = $0 { true } else { false } }
        let ref = needsRef ? app.store.text(.ref) : nil
        let apply: (inout JSON) throws -> Void = { f in
            for op in ops {
                let r = try core.routeEdit(
                    route: (f["route"] ?? .array([])).text, legOverrides: f["legOverrides"]?.text, op, ref: ref)
                f["route"] = r.route
                f["legOverrides"] = r.legOverrides
            }
        }
        do {
            try apply(&probe)
        } catch {
            self.error = error.localizedDescription
            return false
        }
        guard probe["route"] != flight?["route"] || probe["legOverrides"] != flight?["legOverrides"] else {
            return false
        }
        await edit { f in try? apply(&f) }
        await routeChanged()
        return true
    }

    func routeEdit(_ op: CoreRouteOp) async {
        await routeEdit([op])
    }

    /// The origin or destination picked (RouteSection): that end is replaced, a local flight moves as
    /// a whole, a one-point route gets its destination.
    func setEnd(from: Bool, _ place: Place) async {
        await routeEdit(.setEnd(from: from, aerodrome: place.refId))
    }

    func makeLocal() async {
        await routeEdit(.makeLocal)
    }

    /// Local flight unticked: the closing point goes, leaving the origin for a destination or drawing.
    func endLocal() async {
        guard route.count == 2, let uid = route.last?["uid"]?.string else { return }
        await routeEdit(.remove(uid: uid))
    }

    /// Adds a point where it lengthens the route least.
    func addPoint(_ place: Place) async {
        await insert(place.routePoint(), at: RouteEdit.bestIndex(for: place, in: route))
    }

    /// `index`: where the point goes (leg + 1 splits a leg).
    func insert(_ point: JSON, at index: Int) async {
        await routeEdit(.insert(index: index, point: point))
    }

    /// A point at a typed position, as the map places one (kind custom, six decimals).
    nonisolated static func customPoint(name: String, lat: Double, lon: Double) -> JSON {
        func six(_ x: Double) -> Double { (x * 1e6).rounded() / 1e6 }
        return [
            "uid": .string(Places.newUid()), "kind": "custom", "refId": nil, "name": .string(name),
            "lat": .number(six(lat)), "lon": .number(six(lon)),
        ]
    }

    func removePoint(uid: String) async {
        guard route.count > 2 else { return }
        await routeEdit(.remove(uid: uid))
    }

    func renamePoint(uid: String, name: String) async {
        await routeEdit(.rename(uid: uid, name: name))
    }

    /// Moves the points at `source` to `destination` (List.onMove's indices): each keeps its uid, so
    /// the overrides of legs that still exist stay.
    func movePoints(from source: IndexSet, to destination: Int) async {
        var order = route
        order.move(fromOffsets: source, toOffset: destination)
        var ops: [CoreRouteOp] = []
        for i in source.sorted() {
            guard let uid = route[i]["uid"]?.string, let at = order.firstIndex(where: { $0["uid"]?.string == uid })
            else { continue }
            ops.append(.remove(uid: uid))
            ops.append(.insert(index: at, point: route[i]))
        }
        // removing all first, then inserting in their final order, lands each at its final index
        let removes = ops.filter { if case .remove = $0 { true } else { false } }
        let inserts = ops.filter { if case .insert = $0 { true } else { false } }.sorted {
            if case .insert(let a, _) = $0, case .insert(let b, _) = $1 { return a < b }
            return false
        }
        await routeEdit(removes + inserts)
    }

    /// PGF.routeInfo of the route (round trip, local, the next custom point's name).
    func routeInfo() -> CoreRouteInfo? {
        try? app.core?.routeInfo(route: JSON.array(route).text)
    }

    /// PGF.localFlight: whether the flight is local and its airborne time.
    func localFlight() -> CoreLocalFlight? {
        try? app.core?.localFlight(route: JSON.array(route).text, options: flight?["options"]?.text)
    }

    /// A route point name as the map takes it ('' when invalid).
    func cleanPointName(_ text: String) -> String {
        (try? app.core?.routePointName(text)) ?? text.trimmingCharacters(in: .whitespaces)
    }

    /// A typed position (decimal degrees, degrees and minutes, ICAO compact), or nil.
    func parsePosition(_ text: String) -> CoreCoords.LatLon? {
        (try? app.core?.parseCoords(text))?.latLon
    }

    func routeChanged() async {
        await prepareChart()
        await fetchWeather()
        await fetchBriefing()
        await recompute()
        await prepareChart()
    }

    func setAltitude(legKey: String, feet: Int) async {
        await edit { f in
            var all = f["legOverrides"]?.object ?? [:]
            var o = all[legKey]?.object ?? [:]
            o["altFt"] = .number(Double(feet))
            all[legKey] = .object(o)
            f["legOverrides"] = .object(all)
        }
    }

    // MARK: aircraft

    /// The flight's aircraft as cached (GET /api/aircraft/:id).
    var aircraft: JSON? {
        guard let id = flight?["aircraftId"]?.string, let d = app.store.read(.aircraft(id)) else { return nil }
        return try? JSON.parse(d)
    }

    /// On a shared flight the aircraft is its owner's choice (from the owner's hangar).
    var aircraftIsOwnersChoice: Bool { flight?["access"].map { !$0.isNull } ?? false }

    /// GET /api/aircraft: the pilot's own aircraft and those shared with them.
    func hangar() async -> [JSON] {
        guard let d = try? await app.api.aircraftList(), let list = try? JSON.parse(d) else { return [] }
        return list.array ?? []
    }

    /// The aircraft chosen (nil: none): the manifest's seats, the baggage, the compass card and the W&B
    /// category follow it, as the website's Aircraft section does.
    func chooseAircraft(_ aircraft: JSON?) async {
        guard let core = app.core, !readOnly, !aircraftIsOwnersChoice else { return }
        if let aircraft, let id = aircraft["id"]?.string { try? app.store.write(try aircraft.data(), .aircraft(id)) }
        let text = aircraft?.text
        await edit { f in
            guard let c = try? core.setAircraft(doc: f.text, aircraft: text) else { return }
            f["aircraftId"] = c.aircraftId.map(JSON.string) ?? .null
            f["crew"] = c.crew
            f["baggageKg"] = c.baggageKg
            f["options"] = c.options
        }
    }

    /// nil: the aircraft's first card.
    func setCompassCard(_ name: String?) async {
        await setOption("compassCard", name.map(JSON.string) ?? .null)
    }

    func setWindModel(_ model: String) async {
        await setOption("windModel", .string(model))
        await fetchWeather()
        await recompute()
    }

    /// FlightOptions.windModel's values with the website's labels (src/shared/constants.ts WIND_MODELS).
    nonisolated static let windModels: [(id: String, label: String)] = [
        ("ecmwf_ifs025", "ECMWF IFS 0.25°"), ("gfs_seamless", "GFS"), ("icon_seamless", "ICON"),
        ("best_match", "Open-Meteo best match"),
    ]

    // MARK: fuel

    /// The fuel on board by type and the taxi allowance (PGF.fuelLoad), for the flight's FOB.
    func fuelLoad() -> CoreFuelLoad? {
        guard let fuel = aircraft?["fuel"], let fob = computed?.raw["fuel"]?["fobL"]?.double else { return nil }
        let byType = flight?["options"]?["fuelL"]?.object?.compactMapValues(\.double)
        return try? app.core?.fuelLoad(
            fuel: fuel.text, totalL: fob, byType: byType, options: flight?["options"]?.text)
    }

    func fuelEdit(_ op: CoreFuelOp) async {
        guard let core = app.core else { return }
        await edit { f in
            guard let r = try? core.fuelEdit(doc: f.text, op) else { return }
            f["fobL"] = r.fobL.map(JSON.number) ?? .null
            f["options"] = r.options
        }
    }

    /// Litres of fuel `type` typed (nil: cleared) on an aircraft with more than one approved fuel.
    func setFuel(_ type: String, litres: Double?) async {
        guard let fuel = aircraft?["fuel"] else { return }
        await fuelEdit(.type(fuel: fuel.text, type: type, litres: litres.map { min(max($0, 0), 2000) }))
    }

    func setFob(_ litres: Double?) async {
        await fuelEdit(.total(litres.map { min(max($0, 0), 2000) }))
    }

    /// Start-up, taxi, take-off and landing fuel per take-off (nil: the aircraft's), litres 0…1000.
    func setTaxiAllowance(_ litres: Double?) async {
        await setOption("taxiAllowanceL", litres.map { .number(min(max($0, 0), 1000)) } ?? .null)
    }

    // MARK: flight plan options

    /// The alternate fields as typed: the flight keeps the resolved codes, at most two (PGF.fplOptions).
    func setAlternates(fields: [String]) async {
        guard let core = app.core else { return }
        let ref = app.store.text(.ref)
        guard let codes = try? core.fplAlternates(fields, ref: ref) else { return }
        let now = (flight?["options"]?["alternates"]?.array ?? []).compactMap(\.string)
        guard codes != now else { return }
        await setOption("alternates", .array(codes.map(JSON.string)))
        await fetchWeather()
        await recompute()
    }

    func setRemarks(_ text: String) async {
        guard text != (flight?["options"]?["remarks"]?.string ?? "") else { return }
        await setOption("remarks", .string(text))
    }

    /// A touch-and-go or stop request at a route point (PGF.setRequest).
    func setRequest(pointUid: String, _ op: CoreRequestOp) async {
        guard let core = app.core else { return }
        await edit { f in
            var o = f["options"]?.object ?? [:]
            guard let list = try? core.setRequest(o["aerodromeRequests"]?.text, pointUid: pointUid, op) else {
                return
            }
            o["aerodromeRequests"] = list
            f["options"] = .object(o)
        }
    }

    /// PGF.requests: the active requests, which kinds each point may carry, the remarks.
    func requestsInfo() -> JSON? {
        guard let core = app.core else { return nil }
        return try? core.requests(
            route: JSON.array(route).text, options: flight?["options"]?.text, ref: app.store.text(.ref))
    }
}
