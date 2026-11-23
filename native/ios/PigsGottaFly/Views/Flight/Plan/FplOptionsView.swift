import SwiftUI

/// Flight plan options (the website's FplSection): up to two alternates (item 16), touch-and-go and
/// full-stop requests at the route's aerodromes (item 18 RMK/) and free-text remarks (item 18).
struct FplOptionsView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.flightFocus) private var focus
    @State private var fields = ["", ""]
    @State private var remarks = ""
    @State private var searching: Int?
    @FocusState private var editing: Field?

    enum Field: Hashable {
        case alternate(Int)
        case remarks
    }

    private var alternates: [String] {
        (model.flight?["options"]?["alternates"]?.array ?? []).compactMap(\.string)
    }
    private var savedRemarks: String { model.flight?["options"]?["remarks"]?.string ?? "" }

    var body: some View {
        Form {
            Section {
                ForEach(0..<2, id: \.self) { i in
                    HStack {
                        TextField("Alternate \(i + 1): ICAO or name", text: $fields[i])
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .focused($editing, equals: .alternate(i))
                            .submitLabel(.done)
                            .onSubmit(saveAlternates)
                            .accessibilityIdentifier("fpl-alternate-\(i + 1)")
                        if !model.readOnly {
                            Button {
                                searching = i
                            } label: {
                                Image(systemName: "magnifyingglass")
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Search alternate \(i + 1)")
                            .accessibilityIdentifier("fpl-alternate-\(i + 1)-search")
                        }
                    }
                }
            } header: {
                Text("Alternates")
            }
            .disabled(model.readOnly)
            requests
            Section("Remarks (item 18)") {
                TextField("e.g., PHOTO FLIGHT", text: $remarks, axis: .vertical)
                    .lineLimit(2...6)
                    .focused($editing, equals: .remarks)
                    .disabled(model.readOnly)
                    .accessibilityIdentifier("fpl-remarks")
            }
        }
        .accessibilityIdentifier(FlightSection.fplOptions.screenID)
        .onAppear {
            fields = Self.fieldsOf(alternates)
            remarks = savedRemarks
            switch focus {
            case "alternates": editing = .alternate(0)
            case "remarks": editing = .remarks
            default: break
            }
        }
        // undo, redo or another device changed them: the fields follow unless they are being typed in
        .onChange(of: alternates) { _, now in
            if editing == nil || editing == .remarks { fields = Self.fieldsOf(now) }
        }
        .onChange(of: savedRemarks) { _, now in if editing != .remarks { remarks = now } }
        .onChange(of: editing) { old, _ in
            switch old {
            case .alternate: saveAlternates()
            case .remarks: saveRemarks()
            case nil: break
            }
        }
        .toolbar {
            if editing != nil {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { editing = nil }
                }
            }
        }
        .sheet(item: Binding(get: { searching.map(Slot.init) }, set: { searching = $0?.index })) { slot in
            NavigationStack {
                PlaceSearchView(title: "Alternate \(slot.index + 1)", aerodromesOnly: true) { place in
                    fields[slot.index] = place.code
                    saveAlternates()
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { searching = nil } }
                }
            }
        }
    }

    private struct Slot: Identifiable {
        var index: Int
        var id: Int { index }
    }

    static func fieldsOf(_ alts: [String]) -> [String] {
        (0..<2).map { $0 < alts.count ? alts[$0] : "" }
    }

    private func saveAlternates() {
        let f = fields
        Task { await model.setAlternates(fields: f) }
    }

    private func saveRemarks() {
        let r = remarks
        Task { await model.setRemarks(r) }
    }

    /// The route's aerodromes, each with "Touch-and-go" and "Stop n min" (the map's point menu has the
    /// same requests); the departure and the destination may have them too.
    @ViewBuilder
    private var requests: some View {
        let route = model.route
        let aerodromes = route.indices.filter { route[$0]["kind"]?.string == "aerodrome" }
        if !aerodromes.isEmpty {
            let info = model.requestsInfo()
            let active = info?["active"]?.array ?? []
            let maxStop = info?["stopMin"]?["max"]?.int ?? 600
            let defaultStop = info?["stopMin"]?["default"]?.int ?? 10
            Section {
                ForEach(aerodromes, id: \.self) { index in
                    let p = route[index]
                    let uid = p["uid"]?.string ?? ""
                    let allowed = info?["allowed"]?[index]
                    let tng = active.first {
                        $0["point"]?["uid"]?.string == uid && $0["request"]?["kind"] == "touch-and-go"
                    }
                    let stop = active.first { $0["point"]?["uid"]?.string == uid && $0["request"]?["kind"] == "stop" }
                    RequestRow(
                        name: p["name"]?.string ?? "", index: index,
                        tngAllowed: allowed?["touch-and-go"]?.bool ?? false,
                        stopAllowed: allowed?["stop"]?.bool ?? false,
                        tng: tng != nil, stopMin: stop.map { $0["request"]?["stopMin"]?.int ?? defaultStop },
                        defaultStop: defaultStop, maxStop: maxStop, disabled: model.readOnly
                    ) { op in
                        Task { await model.setRequest(pointUid: uid, op) }
                    }
                }
            } header: {
                Text("Touch-and-go and stops")
            }
        }
    }
}

/// One aerodrome of the route: its touch-and-go and its full stop with the minutes on the ground.
struct RequestRow: View {
    var name: String
    var index: Int
    var tngAllowed: Bool
    var stopAllowed: Bool
    var tng: Bool
    /// nil: no stop requested.
    var stopMin: Int?
    var defaultStop: Int
    var maxStop: Int
    var disabled: Bool
    var change: (CoreRequestOp) -> Void

    @State private var minutes = 10

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(name).font(.headline)
            if tngAllowed {
                Toggle(
                    index == 0 ? "Touch-and-go first" : "Touch-and-go",
                    isOn: Binding(
                        get: { tng },
                        set: { on in
                            change(on ? .set(kind: "touch-and-go", stopMin: nil) : .remove(kind: "touch-and-go"))
                        }
                    )
                )
                .accessibilityIdentifier("fpl-tng-\(index)")
            }
            if stopAllowed {
                Toggle(
                    "Stop",
                    isOn: Binding(
                        get: { stopMin != nil },
                        set: { on in change(on ? .set(kind: "stop", stopMin: minutes) : .remove(kind: "stop")) })
                )
                .accessibilityIdentifier("fpl-stop-\(index)")
                Stepper(value: $minutes, in: 1...maxStop, step: 5) {
                    LabeledContent("On the ground", value: "\(minutes) min").monospacedDigit()
                }
                .disabled(stopMin == nil)
                .opacity(stopMin == nil ? 0.5 : 1)
                .accessibilityIdentifier("fpl-stop-min-\(index)")
            }
        }
        .padding(.vertical, 4)
        .disabled(disabled)
        .onAppear { minutes = stopMin ?? defaultStop }
        .onChange(of: stopMin) { _, now in if let now { minutes = now } }
        .task(id: minutes) {
            guard let stopMin, minutes != stopMin, minutes > 0 else { return }
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            change(.set(kind: "stop", stopMin: minutes))
        }
    }
}
