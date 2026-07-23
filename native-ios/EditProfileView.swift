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
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Edit Profile")
                        .font(Theme.heading(22, .bold))
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                    Button { dismiss() } label: {
                        Text("Cancel")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.muted)
                    }
                }

                // ── Photo ──
                HStack(spacing: 16) {
                    avatarPreview
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Text(uploadingPhoto ? "Uploading…" : "Change Photo")
                            .font(Theme.body(14, .medium))
                            .foregroundStyle(Theme.neonBlue)
                    }
                    .disabled(uploadingPhoto)
                }

                field("DISPLAY NAME", text: $displayName, placeholder: "Your name")
                field("USERNAME", text: $username, placeholder: "username",
                      hint: "Lowercase letters, numbers, underscores. One change per 30 days.")
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                VStack(alignment: .leading, spacing: 6) {
                    Text("BIO")
                        .font(Theme.body(10, .semibold)).tracking(1.2)
                        .foregroundStyle(Theme.muted)
                    TextEditor(text: $bio)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.foreground)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .frame(minHeight: 80)
                        .background(Theme.surfaceAlt.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
                        .onChange(of: bio) { if bio.count > 200 { bio = String(bio.prefix(200)) } }
                    Text("\(bio.count)/200")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.muted.opacity(0.7))
                }

                Text("SOCIAL LINKS")
                    .font(Theme.body(10, .semibold)).tracking(1.2)
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 2)
                socialField("Instagram", text: $instagram)
                socialField("TikTok", text: $tiktok)
                socialField("Threads", text: $threads)
                socialField("X (Twitter)", text: $twitter)

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
                .padding(.top, 4)

                if let errorText {
                    Text(errorText)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.destructive)
                }

                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView().tint(Theme.onAccent) } else { Text("Save Changes") }
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(saving || uploadingPhoto)
                .padding(.top, 4)
            }
            .padding(20)
        }
        .background(Theme.bg)
        .onChange(of: photoItem) {
            if let photoItem { uploadPhoto(photoItem) }
        }
    }

    private var avatarPreview: some View {
        Group {
            if let avatarUrl,
               let url = avatarUrl.hasPrefix("/")
                   ? URL(string: avatarUrl, relativeTo: APIClient.baseURL)
                   : URL(string: avatarUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.accent }
            } else {
                ZStack {
                    Theme.accent
                    Text(String((displayName.isEmpty ? "?" : displayName).prefix(1)).uppercased())
                        .font(Theme.heading(24, .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .frame(width: 64, height: 64)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.border, lineWidth: 1))
        .opacity(uploadingPhoto ? 0.5 : 1)
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, hint: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(Theme.body(10, .semibold)).tracking(1.2)
                .foregroundStyle(Theme.muted)
            TextField(placeholder, text: text)
                .font(Theme.body(15))
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Theme.surfaceAlt.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
            if let hint {
                Text(hint)
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.muted.opacity(0.7))
            }
        }
    }

    private func socialField(_ label: String, text: Binding<String>) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)
                .frame(width: 84, alignment: .leading)
            TextField("@handle", text: text)
                .font(Theme.body(14))
                .foregroundStyle(Theme.foreground)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(Theme.surfaceAlt.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
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
