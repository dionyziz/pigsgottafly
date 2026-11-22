import SwiftUI

/// The flight plan's filing status. Filing itself is the website's File & forms page until phase 2A.
struct FlightPlanView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        List {
            Section("Flight plan") {
                let status = model.filing?.filing?.status
                HStack {
                    Text("Status")
                    Spacer()
                    FilingBadge(status: status)
                }
                if let eobt = model.filing?.filing?.eobt {
                    ValueRow(label: "EOBT", value: Fmt.zulu(Date(timeIntervalSince1970: eobt / 1000)))
                }
                if let m = model.filing?.filing?.message, !m.isEmpty {
                    Text(m).font(.callout).foregroundStyle(.secondary)
                }
                WebLinkRow(title: "File & forms", path: "flights/\(model.id)/export/fpl", id: "file-and-forms") {
                    Task { await model.refresh() }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .accessibilityIdentifier(FlightSection.flightPlan.screenID)
    }
}
