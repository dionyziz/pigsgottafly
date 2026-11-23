import Foundation

/// The flight list's text and grouping, as the website writes them (src/features/lobby/format.ts and
/// the day helpers of src/shared/date.ts it uses).
enum Lobby {
    /// The website's lobby says what the local clock reads in Greece, wherever the phone is.
    static let localZone = TimeZone(identifier: "Europe/Athens")!
    private static let utc = TimeZone(identifier: "UTC")!

    /// The row's title: summary.title (the server names an untitled flight after its date).
    static func title(_ r: FlightListItem) -> String { r.summary.title.isEmpty ? "Untitled flight" : r.summary.title }

    /// What renaming to '' or to the automatic name stores: the automatic title (constants.ts autoTitle).
    static func autoTitle(date: String) -> String { date.isEmpty ? "Untitled flight" : date }

    static func date(_ r: FlightListItem) -> String { r.date.isEmpty ? r.summary.date : r.date }

    /// Lower-cased text a row is searched by (flightSearchText).
    static func searchText(_ r: FlightListItem) -> String {
        let s = r.summary
        let d = date(r)
        var parts = [s.title, s.from, s.to]
        parts += r.points
        parts += r.passengers ?? []
        parts += [s.aircraft, withoutFirstDash(s.aircraft)]
        parts += [d, isoDate(d) ? d : "", s.blockOff]
        return parts.joined(separator: " ").lowercased()
    }

    /// JavaScript's String.replace with a string pattern replaces the first occurrence only.
    private static func withoutFirstDash(_ s: String) -> String {
        guard let r = s.range(of: "-") else { return s }
        return s.replacingCharacters(in: r, with: "")
    }

    /// Every whitespace-separated term of `q` occurs in the row's text (matchesQuery).
    static func matches(_ text: String, _ q: String) -> Bool {
        q.lowercased().split(whereSeparator: \.isWhitespace).allSatisfy { text.contains($0) }
    }

    /// Upcoming (date ≥ today, or no date) and past, both newest first, then the latest edited (splitFlights).
    static func split(_ rows: [FlightListItem], today: String) -> (upcoming: [FlightListItem], past: [FlightListItem]) {
        func key(_ r: FlightListItem) -> String {
            "\(r.date.isEmpty ? "9999-99-99" : r.date) \(r.summary.blockOff.isEmpty ? "99:99" : r.summary.blockOff)"
        }
        func newestFirst(_ a: FlightListItem, _ b: FlightListItem) -> Bool {
            let ka = key(a)
            let kb = key(b)
            return ka != kb ? ka > kb : a.updated > b.updated
        }
        let upcoming = rows.filter { $0.date.isEmpty || $0.date >= today }.sorted(by: newestFirst)
        let past = rows.filter { !$0.date.isEmpty && $0.date < today }.sorted(by: newestFirst)
        return (upcoming, past)
    }

    /// The time column: '0h44', '1h05' (src/shared/format.ts fmtDuration).
    static func duration(_ min: Double) -> String {
        guard min.isFinite, min >= 0 else { return "" }
        let m = Int(min.rounded())
        return String(format: "%dh%02d", m / 60, m % 60)
    }

    static func passengerNames(_ r: FlightListItem) -> String { (r.passengers ?? []).joined(separator: ", ") }

    // MARK: days

    static func isoDate(_ d: String) -> Bool { parse(d) != nil }

    private static func parse(_ d: String) -> Date? {
        guard d.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil, let t = Fmt.isoDay(d) else { return nil }
        // DateFormatter rolls 2026-02-30 over to March; the website rejects it
        return Fmt.isoDay(from: t) == d ? t : nil
    }

    private static func minutes(_ hhmm: String) -> Int? {
        guard let m = hhmm.wholeMatch(of: /(\d{2}):(\d{2})/), let h = Int(m.1), let mm = Int(m.2) else { return nil }
        return h * 60 + mm
    }

    private static func day(_ t: Date, in zone: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let c = cal.dateComponents([.year, .month, .day], from: t)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func clock(_ t: Date, in zone: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let c = cal.dateComponents([.hour, .minute], from: t)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Today's date in Greece (localToday).
    static func localToday(now: Date = Date()) -> String { day(now, in: localZone) }

    static func daysBetween(_ from: String, _ to: String) -> Int? {
        guard let a = parse(from), let b = parse(to) else { return nil }
        return Int((b.timeIntervalSince(a) / 86400).rounded())
    }

    /// 'today', 'tomorrow', 'in 5 days', 'yesterday', '3 days ago', or '' beyond two weeks (relativeDay).
    static func relativeDay(_ d: String, today: String) -> String {
        guard let n = daysBetween(today, d) else { return "" }
        switch n {
        case 0: return "today"
        case 1: return "tomorrow"
        case -1: return "yesterday"
        case 2...14: return "in \(n) days"
        case -14 ... -2: return "\(-n) days ago"
        default: return ""
        }
    }

    /// The local day a flight leaves on: its UTC date moved by the block-off time (localDepartureDay).
    static func localDepartureDay(_ date: String, _ hhmm: String) -> String {
        guard let d = parse(date), let m = minutes(hhmm) else { return date }
        return day(d.addingTimeInterval(Double(m * 60)), in: localZone)
    }

    /// The local clock of a UTC 'HH:MM' on a date, marked when it falls on another local day:
    /// '01:30+1'; '' when either is missing (utcToLocalMarked).
    static func utcToLocalMarked(_ date: String, _ hhmm: String) -> String {
        guard let d = parse(date), let m = minutes(hhmm) else { return "" }
        let t = d.addingTimeInterval(Double(m * 60))
        let n = daysBetween(date, day(t, in: localZone)) ?? 0
        return clock(t, in: localZone) + (n == 0 ? "" : n > 0 ? "+\(n)" : "\(n)")
    }
}
