import SwiftUI

/// When (the website's WhenSection): the date, block start, taxi out and in, a local flight's airborne
/// time, then the times in UTC with the local time under each.
struct WhenView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.flightFocus) private var focus

    private static let utc = TimeZone(identifier: "UTC")!

    var body: some View {
        Form {
            Section {
                DebouncedDatePicker(
                    label: "Date", value: model.date, components: .date, id: "flight-date",
                    disabled: model.readOnly
                ) { day, _ in
                    await model.setDate(day)
                }
                VStack(alignment: .leading, spacing: 2) {
                    DebouncedDatePicker(
                        label: "Block start (UTC)", value: model.date, clock: model.blockOff,
                        components: .hourAndMinute, id: "block-off", disabled: model.readOnly
                    ) { _, clock in
                        await model.setBlockOff(clock)
                    }
                    if let local = Self.localClock(day: model.date, clock: model.blockOff) {
                        Text("\(local) local")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("block-off-local")
                    }
                }
                NumberEntry(
                    label: "Taxi out", unit: "min", value: model.flight?["taxiOutMin"]?.double, placeholder: "15",
                    id: "taxi-out", invalid: model.flight?["taxiOutMin"]?.double == nil, integer: true,
                    disabled: model.readOnly, focused: focus == "taxiOut"
                ) { v in
                    await model.setTaxiOut(v.map { Int($0.rounded()) })
                }
                NumberEntry(
                    label: "Taxi in", unit: "min", value: model.flight?["taxiInMin"]?.double, placeholder: "15",
                    id: "taxi-in", invalid: model.flight?["taxiInMin"]?.double == nil, integer: true,
                    disabled: model.readOnly, focused: focus == "taxiIn"
                ) { v in
                    await model.setTaxiIn(v.map { Int($0.rounded()) })
                }
                if let local = model.localFlight(), local.local {
                    LocalDurationRow(model: model, minutes: local.durationOf, max: local.maxMin)
                }
            }
            times
        }
        .accessibilityIdentifier(FlightSection.when.screenID)
    }

    @ViewBuilder
    private var times: some View {
        if let c = model.computed {
            let t = c.raw["times"]
            Section("Times (UTC)") {
                timeRow("Block start", c.blockOff, t?["blockOffMs"], id: "time-blockoff")
                timeRow("Take-off", c.takeoff, t?["takeoffMs"], id: "time-takeoff")
                timeRow("Landing", c.landing, t?["landingMs"], id: "time-landing", late: late(t?["landingMin"], t))
                timeRow("Block stop", c.blockOn, t?["blockOnMs"], id: "time-blockon", late: late(t?["blockOnMin"], t))
                if c.hasNavlog, let flightMin = c.raw["navlog"]?["flightMin"]?.double {
                    let block = (t?["blockOnMin"]?.double).flatMap { on in
                        (t?["blockOffMin"]?.double).map { on - $0 }
                    }
                    ValueRow(
                        label: "Flight / block time",
                        value: "\(Fmt.hoursMinutes(flightMin)) / \(Fmt.hoursMinutes(block))")
                }
                if let sunset = c.sunset {
                    timeRow("Sunset at destination", sunset, nil, id: "time-sunset")
                }
            }
        } else {
            Section("Times (UTC)") { Text("Preparing…").foregroundStyle(.secondary) }
        }
    }

    /// After sunset: shown red, as on the website.
    private func late(_ min: JSON?, _ t: JSON?) -> Bool {
        guard let m = min?.double, let s = t?["sunsetMin"]?.double else { return false }
        return m > s
    }

    private func timeRow(_ label: String, _ clock: String?, _ ms: JSON?, id: String, late: Bool = false) -> some View {
        HStack {
            Text(label)
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text(clock.map { "\($0)Z" } ?? "--:--Z")
                    .monospacedDigit()
                    .foregroundStyle(late ? .red : .primary)
                if let ms = ms?.double {
                    Text("\(Self.localClock(Date(timeIntervalSince1970: ms / 1000)))LT")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    /// The device's clock time of a UTC day and HH:MM, with +1/−1 when the local day differs.
    static func localClock(day: String, clock: String) -> String? {
        guard Fmt.isoDay(day) != nil, clock.split(separator: ":").count == 2 else { return nil }
        let d = Fmt.date(day: day, clock: clock)
        var mark = ""
        var local = Calendar(identifier: .gregorian)
        local.timeZone = .current
        var utcCal = Calendar(identifier: .gregorian)
        utcCal.timeZone = utc
        let a = local.dateComponents([.year, .month, .day], from: d)
        let b = utcCal.dateComponents([.year, .month, .day], from: d)
        if let la = local.date(from: a), let lb = local.date(from: b), la != lb { mark = la > lb ? " +1" : " −1" }
        return "\(localClock(d))\(mark)"
    }

    static func localClock(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = .current
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

/// A date or UTC time picker that saves once the wheel stops (one undo step, one PUT), not on every
/// tick.
struct DebouncedDatePicker: View {
    var label: String
    var value: String
    var clock: String = "12:00"
    var components: DatePickerComponents
    var id: String
    var disabled: Bool
    var save: (_ day: String, _ clock: String) async -> Void

    @State private var draft = Date()
    @State private var pending = false

    private static let utc = TimeZone(identifier: "UTC")!

    var body: some View {
        DatePicker(label, selection: $draft, displayedComponents: components)
            .environment(\.timeZone, Self.utc)
            .disabled(disabled)
            .accessibilityIdentifier(id)
            .onAppear { draft = shown }
            .onChange(of: value + clock) { if !pending { draft = shown } }
            .onChange(of: draft) {
                guard draft != shown else { return }
                pending = true
            }
            .task(id: draft) {
                guard pending else { return }
                try? await Task.sleep(for: .milliseconds(700))
                guard !Task.isCancelled else { return }
                pending = false
                await save(Fmt.isoDay(from: draft), Fmt.clock(draft))
            }
    }

    private var shown: Date { Fmt.date(day: value, clock: clock.isEmpty ? "12:00" : clock) }
}

/// A number typed in a form row, saved when the field is left or Return is pressed. Empty means not
/// set (the placeholder shows the suggestion), as the website's NumberField.
struct NumberEntry: View {
    var label: String
    var unit: String
    var value: Double?
    var placeholder: String
    var id: String
    var invalid = false
    var integer = false
    var disabled = false
    var focused = false
    var commit: (Double?) async -> Void

    @State private var text = ""
    @FocusState private var editing: Bool

    var body: some View {
        LabeledContent {
            HStack(spacing: 4) {
                TextField(placeholder, text: $text)
                    .keyboardType(integer ? .numberPad : .decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(maxWidth: 110)
                    .focused($editing)
                    .disabled(disabled)
                    .submitLabel(.done)
                    .onSubmit(save)
                    .accessibilityIdentifier(id)
                    .accessibilityLabel(label)
                Text(unit).foregroundStyle(.secondary)
            }
        } label: {
            Text(label).foregroundStyle(invalid ? .orange : .primary)
        }
        .onAppear {
            text = Self.text(value)
            if focused { editing = true }
        }
        .onChange(of: value) { if !editing { text = Self.text(value) } }
        .onChange(of: editing) { if !editing { save() } }
        .toolbar {
            if editing {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { editing = false }
                }
            }
        }
    }

    private func save() {
        let typed = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let v: Double? = typed.isEmpty ? nil : Double(typed)
        if !typed.isEmpty && v == nil {
            text = Self.text(value)
            return
        }
        guard v != value else { return }
        Task { await commit(v) }
    }

    static func text(_ v: Double?) -> String {
        guard let v else { return "" }
        return v == v.rounded() ? String(Int(v)) : String(v)
    }
}

/// A local flight's airborne time (FlightOptions.localDurationMin), 5 minutes a step.
struct LocalDurationRow: View {
    @ObservedObject var model: FlightModel
    var minutes: Double
    var max: Double
    @State private var draft = 60
    @State private var pending = false

    var body: some View {
        Stepper(value: $draft, in: 5...Swift.max(5, Int(max)), step: 5) {
            LabeledContent("Estimated total time", value: Fmt.hoursMinutes(Double(draft)))
                .monospacedDigit()
        }
        .disabled(model.readOnly)
        .accessibilityIdentifier("local-duration")
        .onAppear { draft = Int(minutes.rounded()) }
        .onChange(of: minutes) { if !pending { draft = Int(minutes.rounded()) } }
        .onChange(of: draft) { if draft != Int(minutes.rounded()) { pending = true } }
        .task(id: draft) {
            guard pending else { return }
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            pending = false
            await model.setLocalDuration(draft)
        }
    }
}
