import SwiftUI

/// The ATC list (the website's AtcSection): generated from the route (departure, aerodromes along it,
/// destination, the TMAs entered at the planned altitude, FIS) until the pilot edits it; then the
/// flight keeps its own list (doc.atc), and Regenerate refreshes the generated rows, keeping the ones
/// added by hand.
struct AtcView: View {
    @ObservedObject var model: FlightModel
    @State private var state: AtcState?
    @State private var editing: AtcUnit?
    /// The row just added: dropped when its editor is cancelled before it has a callsign.
    @State private var added: String?

    var body: some View {
        List {
            if let state {
                if state.stale {
                    Section {
                        HStack {
                            Text("Route changed since this list was edited.").foregroundStyle(.orange)
                            Spacer()
                            if !model.readOnly {
                                Button("Regenerate") { Task { await model.regenerateAtc() } }
                                    .buttonStyle(.borderless)
                                    .accessibilityIdentifier("atc-regenerate-stale")
                            }
                        }
                    }
                }
                if state.list.isEmpty {
                    Section { Text("No route.").foregroundStyle(.secondary) }
                }
                ForEach(groups(state.list), id: \.first!.id) { units in
                    Section(units[0].group.isEmpty ? "Other" : units[0].group) {
                        ForEach(units) { row($0) }
                    }
                }
            } else {
                Section { Text(model.computed == nil ? "Preparing…" : "Loading…").foregroundStyle(.secondary) }
            }
        }
        .listStyle(.insetGrouped)
        // before the badge: an identifier on the container would replace the chip's own (atc-edited)
        .accessibilityIdentifier(FlightSection.atc.screenID)
        .safeAreaInset(edge: .top) { badge }
        .toolbar {
            if !model.readOnly {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if state?.edited == true {
                        Button {
                            Task { await model.regenerateAtc() }
                        } label: {
                            Label("Regenerate", systemImage: "arrow.clockwise")
                        }
                        .accessibilityIdentifier("atc-regenerate")
                    }
                    Button {
                        Task { await add() }
                    } label: {
                        Label("Add a unit", systemImage: "plus")
                    }
                    .accessibilityIdentifier("atc-add")
                }
            }
        }
        .sheet(item: $editing) { unit in
            AtcUnitEditor(unit: unit) { saved in
                editing = nil
                added = nil
                Task { await model.editAtc { $0.map { $0.id == saved.id ? saved : $0 } } }
            } onCancel: {
                editing = nil
                if added == unit.id, unit.callsign.isEmpty {
                    Task { await model.editAtc { $0.filter { $0.id != unit.id } } }
                }
                added = nil
            }
        }
        .task(id: Key(computed: model.computed, atc: model.flight?["atc"])) { state = await model.atcState() }
    }

    private struct Key: Equatable {
        var computed: ComputedFlight?
        var atc: JSON?
    }

    @ViewBuilder
    private var badge: some View {
        if let state {
            HStack(spacing: 8) {
                Text("\(state.list.count) units").foregroundStyle(.secondary)
                if state.edited {
                    ChipView(text: state.stale ? "Outdated" : "Edited", tone: state.stale ? .warn : nil)
                        .accessibilityIdentifier("atc-edited")
                }
                Spacer()
            }
            .font(.footnote)
            .padding(.horizontal)
            .padding(.vertical, 4)
            .background(.bar)
        }
    }

    /// Consecutive rows under one heading, as the website prints them.
    private func groups(_ list: [AtcUnit]) -> [[AtcUnit]] {
        var out: [[AtcUnit]] = []
        for u in list {
            if let last = out.last?.last, last.group == u.group {
                out[out.count - 1].append(u)
            } else {
                out.append([u])
            }
        }
        return out
    }

    private func row(_ u: AtcUnit) -> some View {
        Button {
            if !model.readOnly { editing = u }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(u.callsign.isEmpty ? "New unit" : u.callsign).font(.body.weight(.semibold))
                    if !u.service.isEmpty { Text(u.service).font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if u.frequencies.isEmpty {
                        Text("no frequency").foregroundStyle(.secondary)
                    } else {
                        Text(u.frequencies).monospacedDigit()
                    }
                }
                if !u.remark.isEmpty { Text(u.remark).font(.caption).foregroundStyle(.secondary) }
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("atc-row")
        .swipeActions {
            if !model.readOnly {
                Button(role: .destructive) {
                    Task { await model.editAtc { $0.filter { $0.id != u.id } } }
                } label: {
                    Label("Remove", systemImage: "trash")
                }
                .accessibilityIdentifier("atc-remove")
            }
        }
    }

    private func add() async {
        let unit = AtcUnit(id: AtcUnit.newId())
        added = unit.id
        editing = unit
        await model.editAtc { $0 + [unit] }
    }
}

/// One unit's callsign, unit, frequencies, heading and remark (the website's EditRow).
struct AtcUnitEditor: View {
    var unit: AtcUnit
    var onSave: (AtcUnit) -> Void
    var onCancel: () -> Void

    @State private var callsign = ""
    @State private var service = ""
    @State private var primary = ""
    @State private var backups = ""
    @State private var group = ""
    @State private var remark = ""
    @FocusState private var callsignFocused: Bool

    private var backupList: [String] { AtcUnit.backups(backups) }
    private var badPrimary: Bool { !primary.isEmpty && !AtcUnit.validFrequency(primary) }
    private var badBackups: Bool { backupList.contains { !AtcUnit.validFrequency($0) } }
    private var ok: Bool {
        !callsign.trimmingCharacters(in: .whitespaces).isEmpty && !badPrimary && !badBackups
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Callsign", text: $callsign, prompt: Text("TATOI TOWER"))
                        .textInputAutocapitalization(.characters)
                        .focused($callsignFocused)
                        .accessibilityIdentifier("atc-callsign")
                    TextField("Unit", text: $service, prompt: Text("TWR"))
                        .textInputAutocapitalization(.characters)
                        .accessibilityIdentifier("atc-service")
                }
                Section {
                    TextField("Primary", text: $primary, prompt: Text("122.650"))
                        .keyboardType(.decimalPad)
                        .accessibilityIdentifier("atc-primary")
                    if badPrimary {
                        Text("Format 123.450").font(.footnote).foregroundStyle(.red)
                            .accessibilityIdentifier("atc-freq-format")
                    }
                    TextField("Backups", text: $backups, prompt: Text("118.500 …"))
                        .keyboardType(.numbersAndPunctuation)
                        .accessibilityIdentifier("atc-backups")
                    if badBackups { Text("Format 123.450").font(.footnote).foregroundStyle(.red) }
                } header: {
                    Text("Frequencies")
                }
                Section {
                    TextField("Heading", text: $group, prompt: Text("e.g., LGTT DEKELIA / TATOI"))
                        .accessibilityIdentifier("atc-group")
                    TextField("Remark", text: $remark).accessibilityIdentifier("atc-remark")
                }
            }
            .navigationTitle(unit.callsign.isEmpty ? "New unit" : unit.callsign)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel).accessibilityIdentifier("atc-cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!ok).accessibilityIdentifier("atc-save")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled()
        .accessibilityIdentifier("atc-edit")
        .onAppear {
            callsign = unit.callsign
            service = unit.service
            primary = unit.primary
            backups = unit.backups.joined(separator: " ")
            group = unit.group
            remark = unit.remark
            if unit.callsign.isEmpty { callsignFocused = true }
        }
    }

    private func save() {
        guard ok else { return }
        var u = unit
        u.group = group.trimmingCharacters(in: .whitespaces)
        u.callsign = callsign.trimmingCharacters(in: .whitespaces).uppercased()
        u.service = service.trimmingCharacters(in: .whitespaces).uppercased()
        u.primary = primary.trimmingCharacters(in: .whitespaces)
        u.backups = backupList
        u.remark = remark.trimmingCharacters(in: .whitespaces)
        onSave(u)
    }
}
