import SwiftUI

/// The operators the pilot flies for or shares (GET /api/operators), as the website's list shows them
/// (PGF.operatorList): the name and who shared it, the aircraft, the contact and what it wants before
/// each flight. New operator asks for the name, creates it and opens it. On iPad the list selects
/// into the detail column (`selection`); on iPhone a row pushes the operator.
struct OperatorsView: View {
    @EnvironmentObject private var app: AppModel
    var selection: Binding<String?>?
    @State private var rows: [CoreOperatorRow]?
    @State private var error: String?
    @State private var creating = false
    /// iPhone: the operator just created, pushed.
    @State private var opened: Opened?
    @State private var toast: Toast?

    struct Opened: Identifiable, Hashable {
        var id: String
    }

    var body: some View {
        Group {
            if let selection {
                List(selection: selection) { list(link: false) }
            } else {
                List { list(link: true) }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if rows == nil && error == nil {
                ProgressView()
            } else if let error, rows?.isEmpty ?? true {
                ContentUnavailableView("Operators", systemImage: "wifi.slash", description: Text(error))
            } else if rows?.isEmpty == true {
                ContentUnavailableView {
                    Label("No operators yet", systemImage: "building.2")
                } actions: {
                    Button("New operator") { creating = true }.buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Operators")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New operator")
                .accessibilityIdentifier("add-operator")
            }
        }
        .sheet(isPresented: $creating) {
            NewOperatorView { id in
                creating = false
                Task {
                    await load()
                    if let selection { selection.wrappedValue = id } else { opened = Opened(id: id) }
                }
            }
        }
        .navigationDestination(item: $opened) { OperatorEditorView(operatorId: $0.id) }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: app.operatorsChanged) { Task { await load() } }
        .onChange(of: app.operatorNotice) { _, notice in
            guard let notice else { return }
            toast = Toast(message: notice)
            app.operatorNotice = nil
        }
        .toast($toast)
        .accessibilityIdentifier("operator-list")
    }

    @ViewBuilder
    private func list(link: Bool) -> some View {
        ForEach(rows ?? []) { r in
            Group {
                if link {
                    NavigationLink {
                        OperatorEditorView(operatorId: r.id)
                    } label: {
                        row(r)
                    }
                } else {
                    row(r).tag(r.id)
                }
            }
            .accessibilityIdentifier("operator-\(r.id)")
        }
    }

    private func row(_ r: CoreOperatorRow) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(r.name).font(.headline)
            if let chip = r.chip { Text(chip).font(.caption).foregroundStyle(Color.accentColor) }
            ForEach([r.through, r.aircraft, r.contact].filter { !$0.isEmpty }, id: \.self) {
                Text($0).font(.subheadline).foregroundStyle(.secondary)
            }
            if !r.flags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(r.flags, id: \.label) { flag in
                        Text(flag.label)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .foregroundStyle(.orange)
                            .background(.orange.opacity(0.15), in: Capsule())
                            .accessibilityLabel(flag.title)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do {
            let r = try await app.operatorRows()
            rows = r
            error = nil
            if let id = selection?.wrappedValue, !r.contains(where: { $0.id == id }) { selection?.wrappedValue = nil }
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}

/// The website's New operator dialog: the name, then the operator is created and opens.
struct NewOperatorView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    var onCreated: (String) -> Void
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .focused($focused)
                        .onChange(of: name) { error = nil }
                        .onSubmit { Task { await create() } }
                        .accessibilityIdentifier("new-operator-name")
                } footer: {
                    if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("new-operator-error") }
                }
            }
            .navigationTitle("New operator")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Create") { Task { await create() } }.accessibilityIdentifier("new-operator-create")
                    }
                }
            }
            .onAppear { focused = true }
        }
        .accessibilityIdentifier("new-operator-dialog")
    }

    private func create() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            onCreated(try await app.createOperator(name: name))
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
