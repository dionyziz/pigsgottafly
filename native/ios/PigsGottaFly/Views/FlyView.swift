import SwiftUI

/// Fly: the moving map with the strips (NATIVE.md "Fly"). The screen stays on while it is shown.
struct FlyView: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @StateObject private var location: LocationFeed
    @State private var progress: Progress?
    @State private var following = true
    @AppStorage("fly.trackUp") private var trackUp = true
    @AppStorage("fly.night") private var night = false
    @Environment(\.verticalSizeClass) private var verticalSize

    init(model: FlightModel) {
        self.model = model
        _location = StateObject(
            wrappedValue: LocationFeed(simulated: LocationFeed.simulated(from: ProcessInfo.processInfo.arguments)))
    }

    var body: some View {
        ZStack {
            ChartMapView(
                styleURL: model.styleURL, chartData: model.chartData, symbolNames: app.symbolNames,
                route: model.routeCoordinates, fix: location.fix, trackUp: trackUp, following: $following
            )
            .ignoresSafeArea(.container, edges: .horizontal)
            if night {
                Color.black.opacity(0.5).allowsHitTesting(false).accessibilityHidden(true)
            }
            VStack(spacing: 0) {
                TopStrip(text: stripText, waiting: waitingText, compact: verticalSize == .compact)
                Spacer()
                controls
                BottomStrip(text: stripText)
            }
            .environment(\.colorScheme, night ? .dark : .light)
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            Orientation.allow(.allButUpsideDown)
            Orientation.applyLaunchArgument()
            location.start()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            Orientation.allow(.portrait)
            location.stop()
        }
        .onChange(of: location.fix) { _, fix in update(fix) }
        .onChange(of: model.computed) { _, _ in update(location.fix) }
    }

    private func update(_ fix: Position?) {
        guard let fix else { return }
        Task {
            if let p = await model.progress(at: fix) { progress = p }
        }
    }

    private var stripText: StripText? {
        progress.map { StripText(progress: $0, groundspeedKt: location.fix?.gsKt) }
    }

    private var waitingText: String {
        if location.denied { return "Location is off for Pig's Gotta Fly: turn it on in Settings to see the aircraft." }
        if model.computed == nil { return "Preparing the flight…" }
        return "Waiting for GPS…"
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Spacer()
            if !following && location.fix != nil {
                MapButton(systemImage: "location.fill", label: "Re-centre") { following = true }
                    .accessibilityIdentifier("recentre")
            }
            MapButton(
                systemImage: trackUp ? "location.north.line.fill" : "location.north.line",
                label: trackUp ? "Track up. Switch to north up" : "North up. Switch to track up",
                caption: trackUp ? "TRK" : "N"
            ) { trackUp.toggle() }
            .accessibilityIdentifier("orientation")
            MapButton(
                systemImage: night ? "sun.max.fill" : "moon.fill", label: night ? "Day display" : "Night display"
            ) { night.toggle() }
            .accessibilityIdentifier("night")
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }
}

/// A round map button, 56 pt (gloves, turbulence).
struct MapButton: View {
    var systemImage: String
    var label: String
    var caption: String?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Image(systemName: systemImage).font(.title3.weight(.semibold))
                if let caption { Text(caption).font(.caption2.weight(.bold)) }
            }
            .frame(width: 56, height: 56)
            .background(.regularMaterial, in: Circle())
            .overlay(Circle().stroke(.primary.opacity(0.15)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// One figure of a strip: a small label over a large value.
struct StripCell: View {
    var label: String
    var value: String
    var emphasis = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(emphasis ? .title2 : .title3, design: .rounded).weight(.bold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Next waypoint, bearing, distance, ETE, ETA, groundspeed, the leg's planned altitude and heading.
struct TopStrip: View {
    var text: StripText?
    var waiting: String
    var compact: Bool

    var body: some View {
        Group {
            if let t = text {
                let cells: [(String, String, Bool)] = [
                    ("TO", t.waypoint, true), ("DIST", t.distance, true), ("BRG", t.bearing, true),
                    ("ETE", t.ete, false), ("ETA", t.eta, false), ("GS", t.groundspeed, false),
                    ("ALT", t.plannedAltitude, false), ("HDG", t.plannedHeading, false),
                    (t.offRoute ? "OFF ROUTE" : "XTK", t.crossTrack, false),
                ]
                let columns = compact ? 9 : 3
                Grid(horizontalSpacing: 10, verticalSpacing: 6) {
                    ForEach(0..<(cells.count + columns - 1) / columns, id: \.self) { r in
                        GridRow {
                            ForEach(0..<columns, id: \.self) { c in
                                let i = r * columns + c
                                if i < cells.count {
                                    StripCell(label: cells[i].0, value: cells[i].1, emphasis: cells[i].2)
                                        .foregroundStyle(cells[i].0 == "OFF ROUTE" ? Color.orange : Color.primary)
                                }
                            }
                        }
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(t.accessibilityTop)
                .accessibilityIdentifier("fly-top-strip")
            } else {
                Text(waiting)
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .accessibilityIdentifier("fly-waiting")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial)
    }
}

/// The current leg's frequency and the next one.
struct BottomStrip: View {
    var text: StripText?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text("FREQ").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(text?.frequency ?? Fmt.dash)
                    .font(.system(.title3, design: .rounded).weight(.bold).monospacedDigit())
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Text("NEXT").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(text?.nextFrequency ?? Fmt.dash)
                    .font(.system(.body, design: .rounded).weight(.semibold).monospacedDigit())
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text?.accessibilityBottom ?? "No frequency yet")
        .accessibilityIdentifier("fly-bottom-strip")
    }
}
