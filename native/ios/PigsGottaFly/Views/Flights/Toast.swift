import SwiftUI

/// The website's toast: a line about what just happened, with one action (Undo, Open).
struct Toast: Identifiable {
    let id = UUID()
    var message: String
    var actionLabel: String?
    var action: (() -> Void)?
}

extension View {
    /// Shows `toast` at the bottom for a few seconds.
    func toast(_ toast: Binding<Toast?>) -> some View {
        overlay(alignment: .bottom) {
            if let t = toast.wrappedValue {
                HStack(spacing: 12) {
                    Text(t.message).font(.subheadline).lineLimit(2)
                    if let label = t.actionLabel, let action = t.action {
                        Button(label) {
                            toast.wrappedValue = nil
                            action()
                        }
                        .font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("toast-action")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(.regularMaterial, in: Capsule())
                .shadow(radius: 6, y: 2)
                .padding()
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("toast")
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: t.id) {
                    try? await Task.sleep(for: .seconds(6))
                    if toast.wrappedValue?.id == t.id { toast.wrappedValue = nil }
                }
            }
        }
        .animation(.default, value: toast.wrappedValue?.id)
    }
}
