import SwiftUI
import PhotosUI

// ── Edit Profile — native twin of /profile/edit (2026-07-23) ──
// Same fields and validation as the web form (shared server core):
// photo, display name, username (30-day change limit enforced server-side),
// bio, social handles, private-profile toggle. Presented as a sheet from
// the profile page's "Edit Profile" link, which used to bounce out to the
// web app.

struct EditProfileSheet: View {
    let user: ProfileUser
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var displayName: String
    @State private var username: String
    @State private var bio: String
    @State private var instagram: String
    @State private var tiktok: String
    @State private var threads: String
    @State private var twitter: String
    @State private var isPrivate: Bool
    @State private var avatarUrl: String?

    @State private var photoItem: PhotosPickerItem?
    @State private var uploadingPhoto = false
    @State private var saving = false
    @State private var errorText: String?

    init(user: ProfileUser, onSaved: @escaping () async -> Void) {
        self.user = user
        self.onSaved = onSaved
        _displayName = State(initialValue: user.displayName ?? "")
        _username = State(initialValue: user.username ?? "")
        _bio = State(initialValue: user.bio ?? "")
        _instagram = State(initialValue: user.instagram ?? "")
        _tiktok = State(initialValue: user.tiktok ?? "")
        _threads = State(initialValue: user.threads ?? "")
        _twitter = State(initialValue: user.twitter ?? "")
        _isPrivate = State(initialValue: user.isPrivate ?? false)
        _avatarUrl = State(initialValue: user.avatarUrl)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 1) {
                        Eyebrow("Profile")
                        Text("Edit Profile")
                            .font(Theme.heading(22, .bold))
                            .foregroundStyle(Theme.foreground)
                    }
                    Spacer()
                    Button { dismiss() } label: {
                        ShelfPill { Text("Cancel") }
                    }
                    .buttonStyle(.plain)
                }

                // ── Photo: hero card, avatar in the wordmark ring ──
                VStack(spacing: 12) {
                    RingedAvatar(avatarUrl: avatarUrl, name: displayName.isEmpty ? "?" : displayName, size: 84)
                        .opacity(uploadingPhoto ? 0.5 : 1)
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        HStack(spacing: 6) {
                            Image(systemName: "camera")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.neonBlue)
                            Text(uploadingPhoto ? "Uploading…" : "Change Photo")
                                .font(Theme.body(13, .semibold))
                                .foregroundStyle(Theme.foreground)
                        }
                        .padding(.horizontal, 14).frame(height: 34)
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay(Capsule().stroke(Theme.foreground.opacity(0.14), lineWidth: 1))
                    }
                    .disabled(uploadingPhoto)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
                .hairlineCard()

                Eyebrow("About you").padding(.leading, 4).padding(.top, 4)
                VStack(alignment: .leading, spacing: 14) {
                    field("Display name", text: $displayName, placeholder: "Your name")
                    field("Username", text: $username, placeholder: "username",
                          hint: "Lowercase letters, numbers, underscores. One change per 30 days.")
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    VStack(alignment: .leading, spacing: 6) {
                        Eyebrow("Bio").padding(.leading, 14)
                        TextEditor(text: $bio)
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.foreground)
                            .scrollContentBackground(.hidden)
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .frame(minHeight: 80)
                            .background(Theme.surfaceAlt.opacity(0.35), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.foreground.opacity(0.12), lineWidth: 1))
                            .onChange(of: bio) { if bio.count > 200 { bio = String(bio.prefix(200)) } }
                        Text("\(bio.count)/200")
                            .font(Theme.body(11))
                            .foregroundStyle(Theme.muted.opacity(0.7))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.trailing, 6)
                    }
                }
                .padding(16)
                .glassCard()

                Eyebrow("Social links").padding(.leading, 4).padding(.top, 4)
                VStack(spacing: 10) {
                    Text("Shown on your public profile so readers can find you.")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                    socialField("Instagram", text: $instagram)
                    socialField("TikTok", text: $tiktok)
                    socialField("Threads", text: $threads)
                    socialField("X (Twitter)", text: $twitter)
                }
                .padding(16)
                .glassCard()

                Eyebrow("Privacy").padding(.leading, 4).padding(.top, 4)
                Toggle(isOn: $isPrivate) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Private profile")
                            .font(Theme.body(15, .medium))
                            .foregroundStyle(Theme.foreground)
                        Text("Only you can see your reading life.")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .tint(Theme.accent)
                .padding(16)
                .glassCard()

                if let errorText {
                    Text(errorText)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.destructive)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }

                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView().tint(Theme.onAccent) } else { Text("Save Changes") }
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(saving || uploadingPhoto)
                .padding(.top, 6)
            }
            .padding(20)
        }
        .background(AmbientBackground())
        .onChange(of: photoItem) {
            if let photoItem { uploadPhoto(photoItem) }
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, hint: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(label).padding(.leading, 14)
            TextField(placeholder, text: text)
                .brandedField()
            if let hint {
                Text(hint)
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted.opacity(0.7))
                    .padding(.horizontal, 14)
            }
        }
    }

    private func socialField(_ label: String, text: Binding<String>) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(Theme.body(13, .medium))
                .foregroundStyle(Theme.muted)
                .frame(width: 84, alignment: .leading)
            TextField("@handle", text: text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .brandedField()
        }
    }

    private func uploadPhoto(_ item: PhotosPickerItem) {
        uploadingPhoto = true; errorText = nil
        Task {
            defer { uploadingPhoto = false; photoItem = nil }
            guard let raw = try? await item.loadTransferable(type: Data.self),
                  var image = UIImage(data: raw) else {
                errorText = "Couldn't read that photo."
                return
            }
            // Scale + recompress under the 5MB route cap (avatars are small
            // anyway — cap the long edge at 800px).
            if image.size.width > 800 {
                let scale = 800 / image.size.width
                let newSize = CGSize(width: 800, height: image.size.height * scale)
                image = UIGraphicsImageRenderer(size: newSize).image { _ in
                    image.draw(in: CGRect(origin: .zero, size: newSize))
                }
            }
            guard let jpeg = image.jpegData(compressionQuality: 0.85) else {
                errorText = "Couldn't process that photo."
                return
            }
            do {
                avatarUrl = try await APIClient.shared.uploadAvatar(jpeg: jpeg)
                await onSaved()
            } catch {
                errorText = "Photo upload failed — try again."
            }
        }
    }

    private func save() async {
        saving = true; errorText = nil
        defer { saving = false }
        do {
            try await APIClient.shared.updateProfile(
                displayName: displayName.isEmpty ? nil : displayName,
                username: username.isEmpty ? nil : username,
                bio: bio.isEmpty ? nil : bio,
                instagram: instagram.isEmpty ? nil : instagram,
                tiktok: tiktok.isEmpty ? nil : tiktok,
                threads: threads.isEmpty ? nil : threads,
                twitter: twitter.isEmpty ? nil : twitter,
                isPrivate: isPrivate
            )
            await onSaved()
            dismiss()
        } catch {
            if case .server(_, let message) = error as? APIError {
                errorText = message
            } else {
                errorText = "Couldn't save — try again."
            }
        }
    }
}
