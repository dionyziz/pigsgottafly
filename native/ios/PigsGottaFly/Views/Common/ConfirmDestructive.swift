import SwiftUI

/// Asks once before something that cannot be taken back (delete an aircraft, remove a person, leave a
/// shared flight); the website asks with window.confirm at the same places.
struct ConfirmDestructive: ViewModifier {
    @Binding var isPresented: Bool
    var title: String
    var action: String
    var message: String?
    var perform: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(title, isPresented: $isPresented, titleVisibility: .visible) {
            Button(action, role: .destructive, action: perform)
                .accessibilityIdentifier("confirm-destructive")
            Button("Cancel", role: .cancel) {}
        } message: {
            if let message { Text(message) }
        }
    }
}

extension View {
    func confirmDestructive(
        _ title: String, isPresented: Binding<Bool>, action: String, message: String? = nil,
        perform: @escaping () -> Void
    ) -> some View {
        modifier(
            ConfirmDestructive(
                isPresented: isPresented, title: title, action: action, message: message, perform: perform))
    }
}
