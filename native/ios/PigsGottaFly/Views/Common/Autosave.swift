import Foundation

/// An edited record saved by itself, like the website's editors (src/data/flightStore.ts, the hangar's
/// autosave): each change shows at once, a PUT follows when the pilot pauses, carrying the version the
/// record was read at. On 409 the server's copy comes back; the changes not yet saved are applied
/// again on top of it, so the last writer wins field by field instead of losing either side.
@MainActor
final class Autosave<T: Sendable>: ObservableObject {
    typealias Change = (inout T) -> Void

    /// What a PUT answered: the new version, or the server's copy and version on 409.
    enum Outcome: Sendable {
        case saved(version: Int)
        case conflict(server: T, version: Int)
    }

    @Published private(set) var value: T
    @Published private(set) var version: Int
    @Published private(set) var saving = false
    @Published private(set) var offline = false
    @Published var error: String?

    private let delay: Duration
    private let put: (T, Int) async throws -> Outcome
    /// Changes since the last save that succeeded, in order: re-applied to a server copy on 409.
    private var pending: [Change] = []
    private var timer: Task<Void, Never>?
    private var running: Task<Void, Never>?
    /// Called after a 409 replaced the record (FlightModel clears its undo stack: the snapshots it holds
    /// predate the server's copy).
    var onConflict: (() -> Void)?

    /// `put` sends the record with the version it was read at. An API that answers 409 with the
    /// current record turns it into `.conflict` (see `Autosave.conflictDecoding`).
    init(
        _ value: T, version: Int, delay: Duration = .milliseconds(800), put: @escaping (T, Int) async throws -> Outcome
    ) {
        self.value = value
        self.version = version
        self.delay = delay
        self.put = put
    }

    var hasPending: Bool { !pending.isEmpty }

    func update(_ change: @escaping Change) {
        change(&value)
        pending.append(change)
        schedule()
    }

    /// The record as read again from the server (a refresh): nothing pending is lost.
    func replace(with server: T, version: Int) {
        var v = server
        for c in pending { c(&v) }
        value = v
        self.version = version
    }

    /// Saves now (the screen goes away, the app goes to the background).
    func flush() async {
        timer?.cancel()
        timer = nil
        await save()
    }

    private func schedule() {
        timer?.cancel()
        let delay = delay
        timer = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    private func save() async {
        // one PUT at a time: a second would carry a version the first is about to make stale
        while let r = running { await r.value }
        guard !pending.isEmpty else { return }
        let t = Task { await self.send() }
        running = t
        await t.value
        running = nil
    }

    private func send() async {
        saving = true
        defer { saving = false }
        for _ in 0..<3 {
            let sent = pending.count
            do {
                switch try await put(value, version) {
                case .saved(let v):
                    version = v
                    pending.removeFirst(min(sent, pending.count))
                    offline = false
                    error = nil
                    if !pending.isEmpty { schedule() }
                    return
                case .conflict(let server, let v):
                    replace(with: server, version: v)
                    onConflict?()
                }
            } catch APIError.offline {
                offline = true
                return
            } catch  where isCancellation(error) {
                return
            } catch {
                self.error = "Not saved: \(error.localizedDescription)"
                return
            }
        }
    }
}

extension Autosave where T == JSON {
    /// The flight, aircraft and operator PUTs answer 409 with the current record in the body.
    static func conflictDecoding(_ body: Data) -> Outcome? {
        guard let server = try? JSON.parse(body) else { return nil }
        return .conflict(server: server, version: server["version"]?.int ?? 0)
    }
}
