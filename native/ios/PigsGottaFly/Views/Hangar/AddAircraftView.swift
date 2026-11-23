import SwiftUI

/// The website's Add aircraft dialog: the registration and what the aircraft starts from (a type
/// template, the same type as an aircraft in the hangar, or blank). The choices, the body and the
/// messages come from the core (PGF.newAircraft), so they are the website's.
struct AddAircraftView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    /// GET /api/aircraft as JSON text.
    var hangar: String
    /// "Add another of this type": starts from that aircraft.
    var copyOf: String?
    var onCreated: (_ id: String, _ toast: String) -> Void

    @State private var registration = ""
    @State private var source: CoreNewAircraft.Source?
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var preview: CoreNewAircraft? {
        try? app.core?.newAircraft(hangar: hangar, registration: registration, source: source, copyOf: copyOf)
    }

    var body: some View {
        let p = preview
        NavigationStack {
            Form {
                Section {
                    TextField("e.g., SX-ABC", text: $registration)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { Task { await create() } }
                        .onChange(of: registration) { _, new in
                            let up = String(new.uppercased().prefix(20))
                            if up != new { registration = up }
                            error = nil
                        }
                        .accessibilityIdentifier("add-aircraft-registration")
                } header: {
                    Text("Registration")
                } footer: {
                    if let message = error ?? (p?.taken == true ? p?.conflict : nil) {
                        Text(message).foregroundStyle(.red).accessibilityIdentifier("add-aircraft-error")
                    }
                }
                Section("Start from") {
                    ForEach(p?.options ?? []) { o in
                        Button {
                            source = o.source
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(o.title).foregroundStyle(.primary)
                                    if !o.description.isEmpty {
                                        Text(o.description).font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                if o.source == p?.source {
                                    Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(o.source == p?.source ? .isSelected : [])
                        .accessibilityIdentifier("add-aircraft-source-\(o.source.kind)-\(o.source.id ?? "")")
                    }
                }
            }
            .navigationTitle("Add aircraft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Add") { Task { await create() } }
                            .accessibilityIdentifier("add-aircraft-submit")
                    }
                }
            }
            .interactiveDismissDisabled(busy)
            .onAppear { focused = true }
        }
        .accessibilityIdentifier("add-aircraft-dialog")
    }

    private func create() async {
        guard !busy, let p = preview else { return }
        if let message = p.error {
            error = message
            return
        }
        busy = true
        defer { busy = false }
        do {
            let made = try await app.addAircraft(hangar: hangar, registration: registration, source: p.source)
            onCreated(made.id, made.toast)
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
