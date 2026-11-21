import UIKit

/// The chart's symbol images, drawn with Core Graphics under the names the core's style uses
/// (PGF.symbolNames()). They follow src/features/editor/map/symbols.ts shape for shape: aerodrome =
/// ring with the runway bar, reporting point = triangle, waypoint = four-point star, navaids per ICAO
/// Annex 4. Sizes are in points, drawn at 2× like the website's.
enum Symbols {
    /// src/features/editor/map/style.ts CHART defaults.
    enum Chart {
        static let aerodrome = UIColor(hex: 0x1d3f8f)
        static let navaid = UIColor(hex: 0x0e5a78)
        static let vfr = UIColor(hex: 0x1e6b46)
        static let waypoint = UIColor(hex: 0x7a3db8)
        static let route = UIColor(hex: 0xc2185b)
        static let restricted = UIColor(hex: 0xc62828)
        static let paper = UIColor.white
        static let halo = UIColor(white: 1, alpha: 0.92)

        /// The CHART keys PGF.symbolNames() names a symbol's colours by.
        static let byKey: [String: UIColor] = [
            "aerodrome": aerodrome, "navaid": navaid, "vfr": vfr, "waypoint": waypoint, "route": route,
            "restricted": restricted, "paper": paper, "halo": halo,
        ]
    }

    /// The own aircraft (not a chart symbol: the app's own layer).
    static let ownship = "pgf-ownship"

    /// The symbols of the core's style when it cannot list them (it always can: a fallback).
    static let known: [SymbolInfo] = [
        ("pgf-ad-major", 30), ("pgf-ad-minor", 26), ("pgf-ad-plain", 22), ("pgf-ad-water", 24), ("pgf-vfr", 18),
        ("pgf-vfr-ofm", 18), ("pgf-wpt", 20), ("pgf-nav-vor", 20), ("pgf-nav-vordme", 24), ("pgf-nav-vortac", 28),
        ("pgf-nav-tacan", 28), ("pgf-nav-dme", 18), ("pgf-nav-ndb", 26), ("pgf-nav-l", 20), ("pgf-arrow", 14),
        ("pgf-route-arrow", 22), ("pgf-hatch-r", 8),
    ].map { SymbolInfo(name: $0.0, size: $0.1) }

    /// A symbol as the core describes it: drawn at its size, in its main colour.
    static func image(_ info: SymbolInfo) -> UIImage {
        image(
            info.name, size: info.size > 0 ? info.size : nil,
            color: info.colors.first.flatMap { Chart.byKey[$0] })
    }

    /// The image for a name; an unknown name gets a small route-coloured dot so the layer still draws.
    static func image(_ name: String, size: Double? = nil, color: UIColor? = nil) -> UIImage {
        switch name {
        case "pgf-ad-major":
            return make(size ?? 30) { g, s in
                ring(g, s, r: 8, width: 2.2, color: color ?? Chart.aerodrome)
                runwayBar(g, s, len: 24, width: 3.6, color: color ?? Chart.aerodrome)
            }
        case "pgf-ad-minor":
            return make(size ?? 26) { g, s in
                ring(g, s, r: 6.5, width: 1.8, color: color ?? Chart.aerodrome)
                runwayBar(g, s, len: 19, width: 2.8, color: color ?? Chart.aerodrome)
            }
        case "pgf-ad-plain":
            return make(size ?? 22) { g, s in
                ring(g, s, r: 6, width: 1.8, color: color ?? Chart.aerodrome)
                dot(g, s / 2, s / 2, r: 2.2, color: color ?? Chart.aerodrome)
            }
        case "pgf-ad-water":
            return make(size ?? 24) { g, s in
                ring(g, s, r: 7, width: 1.8, color: color ?? Chart.aerodrome)
                g.setStrokeColor((color ?? Chart.aerodrome).cgColor)
                g.setLineWidth(1.6)
                var x = -4.5
                g.move(to: CGPoint(x: s / 2 + x, y: s / 2 + sin(x / 4.5 * .pi * 1.5) * 1.6))
                while x <= 4.5 {
                    g.addLine(to: CGPoint(x: s / 2 + x, y: s / 2 + sin(x / 4.5 * .pi * 1.5) * 1.6))
                    x += 0.5
                }
                g.strokePath()
            }
        case "pgf-vfr":
            return make(size ?? 18) { g, s in
                triangle(g, s, r: 6.4)
                g.setFillColor((color ?? Chart.vfr).cgColor)
                g.setStrokeColor(Chart.paper.cgColor)
                g.setLineWidth(1.4)
                g.drawPath(using: .fillStroke)
            }
        case "pgf-vfr-ofm":
            return make(size ?? 18) { g, s in
                triangle(g, s, r: 5.6)
                g.setFillColor(Chart.halo.cgColor)
                g.setStrokeColor((color ?? Chart.vfr).cgColor)
                g.setLineWidth(1.6)
                g.drawPath(using: .fillStroke)
            }
        case "pgf-wpt":
            return make(size ?? 20) { g, s in
                let c = s / 2
                let r = 7.0
                let k = 2.2
                let pts: [(Double, Double)] = [
                    (c, c - r), (c + k, c - k), (c + r, c), (c + k, c + k), (c, c + r), (c - k, c + k), (c - r, c),
                    (c - k, c - k),
                ]
                g.addLines(between: pts.map { CGPoint(x: $0.0, y: $0.1) })
                g.closePath()
                g.setFillColor((color ?? Chart.waypoint).cgColor)
                g.setStrokeColor(Chart.paper.cgColor)
                g.setLineWidth(1.2)
                g.drawPath(using: .fillStroke)
            }
        case "pgf-nav-vor":
            return make(size ?? 20) { g, s in vor(g, s, r: 6.5, ink: color ?? Chart.navaid) }
        case "pgf-nav-vordme":
            return make(size ?? 24) { g, s in
                let c = s / 2
                let w = 9.2
                let h = 7.6
                g.setFillColor(Chart.halo.cgColor)
                g.fill(CGRect(x: c - w - 1, y: c - h - 1, width: 2 * w + 2, height: 2 * h + 2))
                g.setStrokeColor((color ?? Chart.navaid).cgColor)
                g.setLineWidth(1.5)
                g.stroke(CGRect(x: c - w, y: c - h, width: 2 * w, height: 2 * h))
                vor(g, s, r: 6.5, ink: color ?? Chart.navaid)
            }
        case "pgf-nav-vortac":
            return make(size ?? 28) { g, s in
                lobes(g, s, r: 6.5, filled: true, ink: color ?? Chart.navaid)
                vor(g, s, r: 6.5, ink: color ?? Chart.navaid)
            }
        case "pgf-nav-tacan":
            return make(size ?? 28) { g, s in
                lobes(g, s, r: 6.5, filled: false, ink: color ?? Chart.navaid)
                vor(g, s, r: 6.5, ink: color ?? Chart.navaid)
            }
        case "pgf-nav-dme":
            return make(size ?? 18) { g, s in
                let c = s / 2
                let h = 6.0
                g.setFillColor(Chart.halo.cgColor)
                g.fill(CGRect(x: c - h - 1, y: c - h - 1, width: 2 * h + 2, height: 2 * h + 2))
                g.setStrokeColor((color ?? Chart.navaid).cgColor)
                g.setLineWidth(1.5)
                g.stroke(CGRect(x: c - h, y: c - h, width: 2 * h, height: 2 * h))
                dot(g, c, c, r: 1.5, color: color ?? Chart.navaid)
            }
        case "pgf-nav-ndb":
            return make(size ?? 26) { g, s in ndb(g, s, rings: [4.2, 7, 9.8], ink: color ?? Chart.navaid) }
        case "pgf-nav-l":
            return make(size ?? 20) { g, s in ndb(g, s, rings: [3.8, 6.6], ink: color ?? Chart.navaid) }
        case "pgf-arrow":
            return make(size ?? 14) { g, s in
                g.move(to: CGPoint(x: s / 2 - 3, y: s / 2 - 4))
                g.addLine(to: CGPoint(x: s / 2 + 3, y: s / 2))
                g.addLine(to: CGPoint(x: s / 2 - 3, y: s / 2 + 4))
                g.setLineWidth(2)
                g.setStrokeColor((color ?? Chart.vfr).cgColor)
                g.strokePath()
            }
        case "pgf-route-arrow":
            return make(size ?? 22) { g, s in
                let c = s / 2
                let path = CGMutablePath()
                path.move(to: CGPoint(x: c, y: c - 7))
                path.addLine(to: CGPoint(x: c + 6.5, y: c + 5.5))
                path.addLine(to: CGPoint(x: c, y: c + 2.5))
                path.addLine(to: CGPoint(x: c - 6.5, y: c + 5.5))
                path.closeSubpath()
                g.addPath(path)
                g.setLineWidth(3)
                g.setStrokeColor(Chart.paper.cgColor)
                g.strokePath()
                g.addPath(path)
                g.setFillColor((color ?? Chart.route).cgColor)
                g.fillPath()
            }
        case "pgf-hatch-r":
            return make(size ?? 8) { g, s in
                g.setStrokeColor((color ?? Chart.restricted).withAlphaComponent(0.45).cgColor)
                g.setLineWidth(1)
                g.setLineCap(.butt)
                for o in [-s, 0, s] {
                    g.move(to: CGPoint(x: o, y: s))
                    g.addLine(to: CGPoint(x: o + s, y: 0))
                }
                g.strokePath()
            }
        case ownship:
            return ownshipImage()
        default:
            return make(size ?? 10) { g, s in dot(g, s / 2, s / 2, r: 3, color: color ?? Chart.route) }
        }
    }

    /// An aircraft seen from above, nose up (the layer rotates it to the track): black with a white edge,
    /// readable on the chart's pale colours and under the magenta route.
    static func ownshipImage() -> UIImage {
        make(40) { g, s in
            let c = s / 2
            let p = CGMutablePath()
            // fuselage, wings, tailplane
            p.move(to: CGPoint(x: c, y: 3))
            p.addLine(to: CGPoint(x: c + 2.6, y: 9))
            p.addLine(to: CGPoint(x: c + 2.6, y: 15))
            p.addLine(to: CGPoint(x: c + 17, y: 21))
            p.addLine(to: CGPoint(x: c + 17, y: 24.5))
            p.addLine(to: CGPoint(x: c + 2.6, y: 22))
            p.addLine(to: CGPoint(x: c + 2.2, y: 31))
            p.addLine(to: CGPoint(x: c + 7.5, y: 34))
            p.addLine(to: CGPoint(x: c + 7.5, y: 36.5))
            p.addLine(to: CGPoint(x: c, y: 35))
            p.addLine(to: CGPoint(x: c - 7.5, y: 36.5))
            p.addLine(to: CGPoint(x: c - 7.5, y: 34))
            p.addLine(to: CGPoint(x: c - 2.2, y: 31))
            p.addLine(to: CGPoint(x: c - 2.6, y: 22))
            p.addLine(to: CGPoint(x: c - 17, y: 24.5))
            p.addLine(to: CGPoint(x: c - 17, y: 21))
            p.addLine(to: CGPoint(x: c - 2.6, y: 15))
            p.addLine(to: CGPoint(x: c - 2.6, y: 9))
            p.closeSubpath()
            g.addPath(p)
            g.setLineWidth(3)
            g.setLineJoin(.round)
            g.setStrokeColor(UIColor.white.cgColor)
            g.strokePath()
            g.addPath(p)
            g.setFillColor(UIColor.black.cgColor)
            g.fillPath()
        }
    }

    // MARK: drawing helpers (symbols.ts)

    private static func make(_ size: Double, _ draw: (CGContext, Double) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format).image { ctx in
            let g = ctx.cgContext
            g.setLineJoin(.round)
            g.setLineCap(.round)
            draw(g, size)
        }
    }

    private static func ring(_ g: CGContext, _ s: Double, r: Double, width: Double, color: UIColor) {
        let rect = CGRect(x: s / 2 - r, y: s / 2 - r, width: 2 * r, height: 2 * r)
        g.setFillColor(Chart.halo.cgColor)
        g.fillEllipse(in: rect)
        g.setLineWidth(width)
        g.setStrokeColor(color.cgColor)
        g.strokeEllipse(in: rect)
    }

    private static func runwayBar(_ g: CGContext, _ s: Double, len: Double, width: Double, color: UIColor) {
        g.setFillColor(Chart.paper.cgColor)
        g.fill(CGRect(x: s / 2 - width / 2 - 1.2, y: s / 2 - len / 2 - 1.2, width: width + 2.4, height: len + 2.4))
        g.setFillColor(color.cgColor)
        g.fill(CGRect(x: s / 2 - width / 2, y: s / 2 - len / 2, width: width, height: len))
    }

    private static func triangle(_ g: CGContext, _ s: Double, r: Double) {
        let cx = s / 2
        let cy = s / 2 + r * 0.18
        let pts = (0..<3).map { i -> CGPoint in
            let a = -Double.pi / 2 + Double(i) * 2 * .pi / 3
            return CGPoint(x: cx + r * cos(a), y: cy + r * sin(a))
        }
        g.addLines(between: pts)
        g.closePath()
    }

    private static func hexagon(_ g: CGContext, _ cx: Double, _ cy: Double, r: Double) {
        let pts = (0..<6).map { i -> CGPoint in
            let a = Double(i) * .pi / 3
            return CGPoint(x: cx + r * cos(a), y: cy + r * sin(a))
        }
        g.addLines(between: pts)
        g.closePath()
    }

    private static func dot(_ g: CGContext, _ x: Double, _ y: Double, r: Double, color: UIColor) {
        g.setFillColor(color.cgColor)
        g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
    }

    private static func vor(_ g: CGContext, _ s: Double, r: Double, ink: UIColor) {
        let c = s / 2
        hexagon(g, c, c, r: r)
        g.setFillColor(Chart.halo.cgColor)
        g.setStrokeColor(ink.cgColor)
        g.setLineWidth(1.5)
        g.drawPath(using: .fillStroke)
        dot(g, c, c, r: 1.5, color: ink)
    }

    private static func lobes(_ g: CGContext, _ s: Double, r: Double, filled: Bool, ink: UIColor) {
        let c = s / 2
        let apo = r * sqrt(3) / 2
        let half = r / 2
        let depth = r * 0.62
        for deg in [-90.0, 30, 150] {
            g.saveGState()
            g.translateBy(x: c, y: c)
            g.rotate(by: (deg + 90) * .pi / 180)
            let rect = CGRect(x: -half, y: -apo - depth, width: 2 * half, height: depth)
            if filled {
                g.setFillColor(ink.cgColor)
                g.fill(rect)
            } else {
                g.setFillColor(Chart.halo.cgColor)
                g.fill(rect)
                g.setLineWidth(1.3)
                g.setStrokeColor(ink.cgColor)
                g.stroke(rect)
            }
            g.restoreGState()
        }
    }

    private static func ndb(_ g: CGContext, _ s: Double, rings: [Double], ink: UIColor) {
        let c = s / 2
        let outer = (rings.last ?? 4) + 1.6
        g.setFillColor(Chart.halo.cgColor)
        g.fillEllipse(in: CGRect(x: c - outer, y: c - outer, width: 2 * outer, height: 2 * outer))
        dot(g, c, c, r: 1.8, color: ink)
        for r in rings {
            let n = Int((2 * Double.pi * r / 2.6).rounded())
            for i in 0..<n {
                let a = Double(i) * 2 * .pi / Double(n)
                dot(g, c + r * cos(a), c + r * sin(a), r: 0.75, color: ink)
            }
        }
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}
