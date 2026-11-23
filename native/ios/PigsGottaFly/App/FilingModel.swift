import Foundation

/// The Flight plan screen: the FPL message (PGF.fplMessage), the filing state (GET
/// /api/flights/:id/filing) seen through the website's Filing panel (PGF.filingView), and the actions
/// that send messages to ATC: file, delay, cancel, and asking the status again. Each answer is the new
/// filing state, kept by the flight so its File & forms row follows (FlightModel.applyFiling).
@MainActor
final class FilingModel: ObservableObject {
    enum Busy: String { case file, delay, cancel, refresh }

    let flight: FlightModel
    private var app: AppModel { flight.app }

    @Published private(set) var fpl: CoreFplMessage?
    @Published private(set) var view: CoreFilingView?
    @Published private(set) var choices = FilingChoices()
    @Published private(set) var busy: Busy?
    /// The last action's refusal, as the website words it.
    @Published var error: String?
    @Published private(set) var loadError: String?

    /// How often a fax on its way is asked about (the service reports a delivery within minutes).
    var pollInterval: Duration = .seconds(5)
    /// …and for how long at most before the pilot asks again by hand.
    var pollLimit = 36

    init(flight: FlightModel) {
        self.flight = flight
    }

    private var stateText: String? { app.store.text(.filing(flight.id)) }

    // MARK: reading

    /// The message from the flight as it is now, then the filing state from the server.
    func load() async {
        await makeMessage()
        await rebuild()
        loadError = nil
        do {
            await flight.applyFiling(try await app.api.filing(flight.id))
        } catch APIError.unauthorized {
            app.session.lost()
        } catch {
            if isCancellation(error) { return }
            loadError = await coreText(load: true, offline: error as? APIError == .offline)
        }
        await rebuild()
    }

    func makeMessage() async {
        guard let core = app.core, let inputs = SheetInputs(app: app, model: flight) else { return }
        let now = FlightModel.clock
        fpl = try? await core.run {
            try $0.fplMessage(
                flight: inputs.flight, aircraft: inputs.aircraft, pilot: inputs.pilot, ref: inputs.ref,
                weather: inputs.weather, now: now)
        }
    }

    /// The panel again from the kept state, the choices and the message.
    func rebuild(typed: String? = nil) async {
        guard let core = app.core else { return }
        let state = stateText
        let choices = choices
        let message = fpl?.fpl.message
        let complete = fpl?.fpl.complete ?? false
        let busy = busy != nil
        if let v = try? await core.run({
            try $0.filingView(
                state: state, choices: choices, message: message, complete: complete, busy: busy, typed: typed)
        }) {
            view = v
        }
    }

    // MARK: the pilot's choices

    func setAddress(_ address: String, on: Bool) async {
        if choices.extra.contains(address) {
            if !on { choices.extra.removeAll { $0 == address } }
        } else if on {
            choices.excluded.removeAll { $0 == address }
        } else if !choices.excluded.contains(address) {
            choices.excluded.append(address)
        }
        await rebuild()
    }

    /// The typed address as an AFTN address (8 letters), nil when it is not one.
    func typedAddress(_ text: String) async -> String? {
        guard let core = app.core else { return nil }
        let state = stateText
        return try? await core.run { try $0.filingView(state: state, typed: text) }.typedAddress
    }

    /// Adds a typed address; false when it is not one.
    func addAddress(_ text: String) async -> Bool {
        guard let a = await typedAddress(text) else { return false }
        if !choices.extra.contains(a) { choices.extra.append(a) }
        choices.excluded.removeAll { $0 == a }
        await rebuild()
        return true
    }

    func setCopy(_ email: String, on: Bool) async {
        choices.noCopy.removeAll { $0 == email }
        if !on { choices.noCopy.append(email) }
        await rebuild()
    }

    func setVia(_ id: String) async {
        choices.via = id
        await rebuild()
    }

    // MARK: actions (each sends a message to ATC)

    /// Files the plan the view shows (`request`, the message and the reviewed addressees).
    @discardableResult
    func file() async -> Bool {
        guard let r = view?.request, view?.file.enabled == true else { return false }
        let req = API.FileRequest(
            fpl: r["fpl"]?.string ?? "", addresses: r["addresses"]?.array?.compactMap(\.string) ?? [], eobt: nil,
            copyTo: r["copyTo"]?.array?.compactMap(\.string), via: r["via"]?.string.flatMap(API.Filer.init(rawValue:)))
        return await run(.file) { [api = app.api, id = flight.id] in try await api.fileFlightPlan(id, req) }
    }

    /// Why a delay to `eobt` cannot be sent, and the DLA a fax would carry (nil `eobt`: where the delay
    /// form starts, in `start`).
    func delayCheck(_ eobt: Date?) async -> CoreFilingDelay? {
        guard let core = app.core else { return nil }
        let state = stateText
        let now = FlightModel.clock ?? Date()
        return try? await core.run { try $0.filingDelay(state: state, eobt: eobt, now: now) }
    }

    @discardableResult
    func delay(to eobt: Date) async -> Bool {
        if let p = await delayCheck(eobt)?.problem {
            error = p
            return false
        }
        let ms = (eobt.timeIntervalSince1970 * 1000).rounded()
        return await run(.delay) { [api = app.api, id = flight.id] in try await api.delayFlightPlan(id, eobt: ms) }
    }

    @discardableResult
    func cancel() async -> Bool {
        let copyTo = view?.copyTo
        return await run(.cancel) { [api = app.api, id = flight.id] in
            try await api.cancelFlightPlan(id, copyTo: copyTo)
        }
    }

    @discardableResult
    func refresh() async -> Bool {
        await run(.refresh) { [api = app.api, id = flight.id] in try await api.refreshFlightPlan(id) }
    }

    /// While a fax is on its way, its delivery is asked about until it settles (the website waits for
    /// "Refresh status"; on the phone the pilot watches the screen). Ends with the calling task.
    func followDelivery() async {
        var asked = 0
        while view?.sending == true, asked < pollLimit, !Task.isCancelled {
            try? await Task.sleep(for: pollInterval)
            if Task.isCancelled || busy != nil { continue }
            asked += 1
            await refresh()
        }
    }

    private func run(_ kind: Busy, _ send: @escaping () async throws -> JSON) async -> Bool {
        guard busy == nil else { return false }
        busy = kind
        error = nil
        await rebuild()
        do {
            let state = try await send()
            await flight.applyFiling(try state.data())
            busy = nil
            await rebuild()
            // the lobby's filing chip follows (the website invalidates the flights)
            Task { await app.loadFlights() }
            return true
        } catch APIError.unauthorized {
            app.session.lost()
        } catch {
            if isCancellation(error) { return false }
            self.error = await coreText(error)
            // the server refused because filing is off: its state says why
            if case APIError.http(503, _) = error, let d = try? await app.api.filing(flight.id) {
                await flight.applyFiling(d)
            }
        }
        busy = nil
        await rebuild()
        return false
    }

    /// An API error as the website's panel words it (PGF.filingError): offline, else the server's text.
    private func coreText(_ e: Error) async -> String {
        let message: String? =
            switch e {
            case APIError.http(_, let m): m
            case APIError.conflict(let body): (try? JSON.parse(body))?["error"]?.string
            case APIError.offline: nil
            default: e.localizedDescription
            }
        return await coreText(offline: e as? APIError == .offline, message: message)
    }

    private func coreText(load: Bool = false, offline: Bool, message: String? = nil) async -> String {
        guard let core = app.core else { return message ?? "" }
        return (try? await core.run { try $0.filingError(offline: offline, message: message, load: load) }) ?? ""
    }

    /// Where an FPL warning's Fix leads (PGF.focusTarget of the warning's `fix`, else its text).
    func fixTarget(_ w: CoreFplMessage.Warning) async -> CoreFocusTarget? {
        guard let core = app.core else { return nil }
        let id = flight.id
        let aircraftId = flight.flight?["aircraftId"]?.string
        let fix = w.fix?.text
        guard
            let t = try? await core.run({
                try $0.focusTarget(text: w.text, fix: fix, flightId: id, aircraftId: aircraftId)
            }), t.fix != nil, t.focus != nil || t.link != nil
        else { return nil }
        return t
    }

    // MARK: reading the state

    /// '2026-11-28 07:45Z', as the website's panel writes times.
    nonisolated static func dateTimeZ(_ ms: Double?) -> String {
        guard let ms else { return Fmt.dash }
        let d = Date(timeIntervalSince1970: ms / 1000)
        return "\(Fmt.isoDay(from: d)) \(Fmt.zulu(d))"
    }

    /// The filed plan's EOBT.
    var eobt: Date? { flight.filing?.filing?.eobt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}
