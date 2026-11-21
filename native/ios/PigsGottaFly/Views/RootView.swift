import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var session: Session

    var body: some View {
        Group {
            switch session.state {
            case .unknown:
                ProgressView("Pig's Gotta Fly")
            case .signedOut:
                SignInView()
            case .signedIn:
                MainView()
            }
        }
        .task { await session.check() }
    }
}

/// Flights in the sidebar (iPad) or the first screen (iPhone), the open flight beside or pushed.
struct MainView: View {
    @EnvironmentObject private var app: AppModel
    /// `-openFlight <id>` opens a flight at launch (screenshots, tests).
    @State private var selection: String? = LaunchArgs.value("-openFlight")
    @State private var showAccount = false

    var body: some View {
        NavigationSplitView {
            FlightsView(selection: $selection, showAccount: $showAccount)
        } detail: {
            if let id = selection {
                FlightView(id: id, app: app) { selection = nil }.id(id)
            } else {
                ContentUnavailableView(
                    "Choose a flight", systemImage: "airplane", description: Text("Plan flights on pigsgottafly.com."))
            }
        }
        .sheet(isPresented: $showAccount) { AccountView() }
    }
}

struct SignInView: View {
    @EnvironmentObject private var session: Session

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "airplane.circle.fill")
                .font(.system(size: 88))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("Pig's Gotta Fly").font(.largeTitle.bold())
            Text("Fly the route, check the flight on the morning of the flight, make small changes.")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            Spacer()
            if let error = session.error {
                Text(error).font(.callout).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button {
                Task { await session.signIn() }
            } label: {
                HStack {
                    if session.busy { ProgressView() }
                    Text("Sign in").font(.headline)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(session.busy)
            .accessibilityIdentifier("sign-in")
        }
        .padding(24)
        .frame(maxWidth: 520)
    }
}

/// Launch arguments: `-name value`.
enum LaunchArgs {
    static func value(_ name: String, _ arguments: [String] = ProcessInfo.processInfo.arguments) -> String? {
        guard let i = arguments.firstIndex(of: name), arguments.indices.contains(i + 1) else { return nil }
        return arguments[i + 1]
    }
}
