import Charts
import SwiftUI

/// The W&B chart as the MD 4.3 sheet draws it (moment against mass, PGF.wbChart): the aircraft's
/// envelopes, the flight's category filled, and the fuel-burn line from take-off through the stops to
/// landing (src/features/editor/panels/EnvelopeChart.tsx shows the same points in CG space).
struct WbChartView: View {
    struct Marker: Identifiable, Equatable {
        var id: String
        var label: String
        var point: WbLoadPoint
        var ok: Bool
    }

    var chart: CoreWbChart
    var category: String
    /// Take-off, the stops in flight order, landing.
    var markers: [Marker]

    var body: some View {
        let d = chart.domain
        Chart {
            ForEach(chart.envelopes, id: \.category) { env in envelope(env) }
            ForEach(markers) { m in burn(m) }
            ForEach(markers) { m in point(m) }
        }
        .chartXScale(domain: d.x0...d.x1)
        .chartYScale(domain: d.y0...d.y1)
        .chartXAxis {
            AxisMarks(values: d.xTicks) { _ in
                AxisGridLine()
                AxisValueLabel()
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: d.yTicks) { _ in
                AxisGridLine()
                AxisValueLabel()
            }
        }
        .chartXAxisLabel("Moment (kg·m)", alignment: .center)
        .chartYAxisLabel("Mass (kg)")
        .chartBackground { proxy in
            GeometryReader { geo in
                if let frame = proxy.plotFrame {
                    fill(proxy, origin: geo[frame].origin).fill(Color.accentColor.opacity(0.12))
                }
            }
        }
        .frame(minHeight: 220)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("W&B envelope with take-off and landing points")
        .accessibilityValue(markers.map { "\($0.label) \(Int($0.point.massKg.rounded())) kg" }.joined(separator: ", "))
        .accessibilityIdentifier("wb-chart")
    }

    private func envelope(_ env: CoreWbChart.Envelope) -> some ChartContent {
        let active = env.category == category
        let style = StrokeStyle(lineWidth: active ? 2 : 1, dash: active ? [] : [4, 3])
        let color: Color = active ? .accentColor : .secondary
        return ForEach(Array(closed(env.outline).enumerated()), id: \.offset) { _, p in
            LineMark(x: .value("Moment", p[0]), y: .value("Mass", p[1]), series: .value("Envelope", env.label))
                .foregroundStyle(color)
                .lineStyle(style)
        }
    }

    private func burn(_ m: Marker) -> some ChartContent {
        LineMark(
            x: .value("Moment", m.point.momentKgM), y: .value("Mass", m.point.massKg),
            series: .value("Envelope", "burn")
        )
        .foregroundStyle(Color.primary.opacity(0.5))
        .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 2]))
    }

    private func point(_ m: Marker) -> some ChartContent {
        let color: Color = m.ok ? .accentColor : .red
        let text: Color = m.ok ? .primary : .red
        let position: AnnotationPosition = m.id == "landing" ? .bottomTrailing : .topTrailing
        return PointMark(x: .value("Moment", m.point.momentKgM), y: .value("Mass", m.point.massKg))
            .foregroundStyle(color)
            .symbolSize(60)
            .annotation(position: position, spacing: 2) {
                Text(m.label).font(.caption2.weight(.semibold)).foregroundStyle(text)
            }
    }

    /// The flight's category's envelope, filled (Charts has no polygon mark).
    private func fill(_ proxy: ChartProxy, origin: CGPoint) -> Path {
        var path = Path()
        guard let env = chart.envelopes.first(where: { $0.category == category }) else { return path }
        var pts: [CGPoint] = []
        for p in env.outline {
            let x: Double = p[0]
            let y: Double = p[1]
            if let at = proxy.position(for: (x: x, y: y)) {
                pts.append(CGPoint(x: at.x + origin.x, y: at.y + origin.y))
            }
        }
        guard let first = pts.first else { return path }
        path.move(to: first)
        for p in pts.dropFirst() { path.addLine(to: p) }
        path.closeSubpath()
        return path
    }

    private func closed(_ outline: [[Double]]) -> [[Double]] {
        guard let first = outline.first, outline.count > 2 else { return outline }
        return outline + [first]
    }
}
