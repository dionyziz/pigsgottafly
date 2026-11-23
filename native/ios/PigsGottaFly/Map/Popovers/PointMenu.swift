import SwiftUI

/// A route point's menu (the website's PointMenu, RouteMap menuItems): an action sheet on iPhone, a
/// popover beside the point on iPad.
struct PointMenuActions: View {
    var m: PointMenuModel
    let editor: RouteEditor
    /// Opens a VFR chart's PDF.
    var open: (URL) -> Void

    var body: some View {
        if m.kind == "custom" {
            Button("Rename…") { Task { await editor.rename(uid: m.uid, current: m.name) } }
                .accessibilityIdentifier("menu-rename")
            Button("Save to my waypoints") { Task { await editor.saveWaypoint(uid: m.uid) } }
                .accessibilityIdentifier("menu-save-waypoint")
        }
        if let r = m.requests {
            if r.tng.on {
                Button("Remove touch-and-go request") {
                    Task { await editor.setRequest(uid: m.uid, kind: "touch-and-go", on: false) }
                }
                .accessibilityIdentifier("menu-tng-remove")
            } else if r.tng.allowed {
                Button(m.index == 0 ? "Request touch-and-go before leaving" : "Request touch-and-go") {
                    Task { await editor.setRequest(uid: m.uid, kind: "touch-and-go", on: true) }
                }
                .accessibilityIdentifier("menu-tng")
            }
            if r.stop.on {
                Button("Change stop (\(r.stop.stopMin ?? m.stopMin.default) min)…") { editor.askStop(m) }
                    .accessibilityIdentifier("menu-stop-change")
                Button("Remove stop request") { Task { await editor.setRequest(uid: m.uid, kind: "stop", on: false) } }
                    .accessibilityIdentifier("menu-stop-remove")
            } else if r.stop.allowed {
                Button(stopLabel) { editor.askStop(m) }.accessibilityIdentifier("menu-stop")
            }
        }
        if let ad = m.aerodromeId {
            Button("Aerodrome hours…") {
                let at = editor.menu?.at ?? .zero
                Task { await editor.openAerodrome(ad, at: at) }
            }
            .accessibilityIdentifier("menu-ad-hours")
        }
        ForEach(m.charts, id: \.icao) { c in
            Button("VFR chart \(c.icao) (PDF)") { if let u = URL(string: c.url) { open(u) } }
                .accessibilityIdentifier("menu-vfr-chart")
        }
        if m.last {
            Button("Continue drawing") { editor.continueDrawing() }.accessibilityIdentifier("menu-continue")
        }
        Button("Remove point", role: .destructive) { Task { await editor.remove(uid: m.uid) } }
            .accessibilityIdentifier("menu-remove")
        Button("Cancel", role: .cancel) {}
    }

    private var stopLabel: String {
        switch m.end {
        case "departure": "Request full stop before leaving…"
        case "destination": "Request full stop, then a circuit…"
        default: "Request intermediate stop…"
        }
    }
}
