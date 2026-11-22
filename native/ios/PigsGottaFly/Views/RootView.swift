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
                AppShell()
            }
        }
        .task { await session.check() }
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
