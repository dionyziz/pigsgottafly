import SwiftUI

/// A flight in the list, with what the website's lobby row shows (LobbyPage.tsx row): the route
/// sketch, the title, the route and aircraft, the filing and shared-by chips, the date with the
/// relative day, the block-off time in UTC and local time, the passengers; on iPad also the
/// distance, time and fuel columns.
struct FlightRow: View {
    var item: FlightListItem
    /// Today in Greece: the relative day is counted from it.
    var today: String

    @Environment(\.horizontalSizeClass) private var sizeClass

    private var s: FlightSummary { item.summary }
    private var date: String { Lobby.date(item) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RouteThumb(route: s.route ?? [])
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(Lobby.title(item)).font(.headline).lineLimit(1)
                    Spacer(minLength: 4)
                    if let status = item.filingStatus {
                        FilingBadge(status: status).accessibilityIdentifier("flight-filing")
                    }
                }
                Text(routeAndAircraft).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Text(when).font(.subheadline).monospacedDigit()
                if !pax.isEmpty {
                    Label(pax, systemImage: "person.2")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        .accessibilityLabel("Passengers: \(pax)")
                        .accessibilityIdentifier("flight-pax")
                }
                if let by = item.sharedBy {
                    SharedChip(by: by, role: item.role).accessibilityIdentifier("flight-shared-by")
                }
            }
            if sizeClass == .regular {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(s.distNm.map { "\(Int($0.rounded())) NM" } ?? "—").accessibilityIdentifier("flight-dist")
                    Text(s.eteMin.map(Lobby.duration) ?? "—").accessibilityIdentifier("flight-time")
                    Text(s.fuelL.map { "\(Int($0.rounded())) L" } ?? "—").accessibilityIdentifier("flight-fuel")
                }
                .font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                .frame(minWidth: 60, alignment: .trailing)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var pax: String { Lobby.passengerNames(item) }

    private var routeAndAircraft: String {
        let parts = [s.routeLine ?? "", s.aircraft].filter { !$0.isEmpty }
        return parts.isEmpty ? "No route yet" : parts.joined(separator: " · ")
    }

    private var when: String {
        var parts = [Lobby.isoDate(date) ? date : "No date"]
        let rel = Lobby.relativeDay(Lobby.localDepartureDay(date, s.blockOff), today: today)
        if !rel.isEmpty { parts.append(rel) }
        if !s.blockOff.isEmpty {
            let local = Lobby.utcToLocalMarked(date, s.blockOff)
            parts.append("\(s.blockOff)Z" + (local.isEmpty ? "" : " (\(local)LT)"))
        }
        return parts.joined(separator: " · ")
    }
}

/// "View only · Another Pilot": who shared the flight and what this pilot may do with it.
struct SharedChip: View {
    var by: FlightListItem.SharedBy
    var role: String?

    var body: some View {
        let who = by.name.isEmpty ? by.email : by.name
        Label("\(role == "edit" ? "Can edit" : "View only") · \(who)", systemImage: "person.2.fill")
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.accentColor.opacity(0.12), in: Capsule())
            .foregroundStyle(Color.accentColor)
            .accessibilityLabel(
                "Shared with you by \(who)" + (by.name.isEmpty ? "" : " (\(by.email))")
                    + (role == "edit" ? ", can edit" : ", view only"))
    }
}

struct FilingBadge: View {
    var status: String?

    var body: some View {
        let label = FilingStatusLabel.label(status)
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
            .accessibilityLabel("Flight plan: \(label)")
    }

    private var color: Color {
        switch status {
        case "filed", "departed", "arriving", "arrived", "closed", "delivered": .green
        case "rejected", "cancelled", "suspended", "failed": .red
        case "manual_correction", "created", "sending": .orange
        default: .secondary
        }
    }
}
