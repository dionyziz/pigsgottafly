import SwiftUI

/// The route sketched from summary.route ([lat, lon] pairs), equirectangular with cos(lat) scaling
/// (src/features/lobby/RouteThumb.tsx).
struct RouteThumb: View {
    var route: [[Double]]
    var size: CGFloat = 44

    var body: some View {
        Canvas { ctx, _ in
            let accent = Color.accentColor
            let pad: CGFloat = 5
            let center = CGPoint(x: size / 2, y: size / 2)
            func dot(_ p: CGPoint, _ r: CGFloat) -> Path {
                Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
            }
            let points = route.filter { $0.count >= 2 }
            let onePlace = !points.isEmpty && points.allSatisfy { $0[0] == points[0][0] && $0[1] == points[0][1] }
            if points.count > 1 && onePlace {
                // a local flight: the aerodrome, and a ring for the local area around it
                ctx.stroke(
                    dot(center, size / 2 - pad), with: .color(accent.opacity(0.7)),
                    style: StrokeStyle(lineWidth: 1.4, dash: [3, 2.5]))
                ctx.fill(dot(center, 2.6), with: .color(accent))
                return
            }
            if points.count < 2 {
                ctx.fill(dot(center, 3), with: .color(accent.opacity(0.5)))
                return
            }
            let k = cos(points.map { $0[0] }.reduce(0, +) / Double(points.count) * .pi / 180)
            let xs = points.map { $0[1] * k }
            let ys = points.map { -$0[0] }
            let minX = xs.min()!
            let maxX = xs.max()!
            let minY = ys.min()!
            let maxY = ys.max()!
            let span = max(maxX - minX, maxY - minY, 1e-6)
            let inner = Double(size - 2 * pad)
            let s = inner / span
            let ox = Double(pad) + (inner - (maxX - minX) * s) / 2
            let oy = Double(pad) + (inner - (maxY - minY) * s) / 2
            let pts = points.indices.map { CGPoint(x: ox + (xs[$0] - minX) * s, y: oy + (ys[$0] - minY) * s) }
            var line = Path()
            line.addLines(pts)
            ctx.stroke(
                line, with: .color(accent), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            ctx.fill(dot(pts[0], 2.6), with: .color(accent))
            let closed = points[0] == points[points.count - 1]
            if !closed {
                let end = dot(pts[pts.count - 1], 2.6)
                ctx.fill(end, with: .color(Color(.systemBackground)))
                ctx.stroke(end, with: .color(accent), lineWidth: 1.4)
            }
        }
        .frame(width: size, height: size)
        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
    }
}
