import Foundation

/// Plan's edits of the flight; phase 1B adds route editing, requests and fuel here.
extension FlightModel {
    func setDate(_ day: String) async {
        await edit { $0["date"] = .string(day) }
    }

    func setBlockOff(_ clock: String) async {
        await edit { $0["blockOff"] = .string(clock) }
    }

    /// A local flight's airborne time (FlightOptions.localDurationMin), minutes.
    func setLocalDuration(_ minutes: Int) async {
        await edit { f in
            var o = f["options"]?.object ?? [:]
            o["localDurationMin"] = .number(Double(minutes))
            f["options"] = .object(o)
        }
    }

    /// Adds a point where it lengthens the route least; then the chart, the weather and the
    /// briefing follow the new route.
    func addPoint(_ place: Place) async {
        await edit { RouteEdit.add(place, to: &$0) }
        await routeChanged()
    }

    func removePoint(uid: String) async {
        guard route.count > 2 else { return }
        await edit { RouteEdit.remove(uid: uid, from: &$0) }
        await routeChanged()
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
}
