import SwiftUI

// Completion-date sheet — recreates completion-date-picker.tsx: precision
// selector (Exact date / Month / Year — web defaults to MONTH), adaptive
// pickers, future dates blocked, and "Skip the date". Confirms with
// (dateString, precision) exactly like the web's onConfirm.

struct CompletionDateSheet: View {
    let title: String
    /// (date "YYYY-MM-DD" or nil, precision "exact"|"month"|"year" or nil)
    let onConfirm: (String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var precision = "month"   // web default
    @State private var exactDate = Date()
    @State private var month: Int
    @State private var year: Int

    private let months = ["January", "February", "March", "April", "May", "June",
                          "July", "August", "September", "October", "November", "December"]
    private let years: [Int]
    private let currentMonth: Int
    private let currentYear: Int

    init(title: String, onConfirm: @escaping (String?, String?) -> Void) {
        self.title = title
        self.onConfirm = onConfirm
        let cal = Calendar.current
        let now = Date()
        let y = cal.component(.year, from: now)
        let m = cal.component(.month, from: now)
        currentYear = y
        currentMonth = m
        years = Array((y - 30)...y).reversed()
        _month = State(initialValue: m)
        _year = State(initialValue: y)
    }

    private var isFuture: Bool {
        precision == "month" && year == currentYear && month > currentMonth
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.heading(18, .bold))
                    .foregroundStyle(Theme.foreground)
                Text("All selections are optional")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }

            Picker("", selection: $precision) {
                Text("Exact date").tag("exact")
                Text("Month").tag("month")
                Text("Year").tag("year")
            }
            .pickerStyle(.segmented)

            switch precision {
            case "exact":
                DatePicker("", selection: $exactDate, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(Theme.accent)
                    .frame(maxHeight: 320)
            case "month":
                HStack(spacing: 0) {
                    Picker("Month", selection: $month) {
                        ForEach(1...12, id: \.self) { m in
                            Text(months[m - 1]).tag(m)
                        }
                    }
                    .pickerStyle(.wheel)
                    Picker("Year", selection: $year) {
                        ForEach(years, id: \.self) { y in
                            Text(String(y)).tag(y)
                        }
                    }
                    .pickerStyle(.wheel)
                }
                .frame(height: 140)
            default:
                Picker("Year", selection: $year) {
                    ForEach(years, id: \.self) { y in
                        Text(String(y)).tag(y)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 140)
            }

            if isFuture {
                Text("That's in the future — pick an earlier month.")
                    .font(Theme.body(12, .medium))
                    .foregroundStyle(Theme.destructive)
            }

            Button("Save") {
                let dateStr: String
                switch precision {
                case "exact":
                    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
                    dateStr = f.string(from: exactDate)
                case "month":
                    dateStr = String(format: "%04d-%02d-01", year, month)
                default:
                    dateStr = String(format: "%04d-01-01", year)
                }
                onConfirm(dateStr, precision)
                dismiss()
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(isFuture)

            Button("Skip the date") {
                onConfirm(nil, nil)
                dismiss()
            }
            .font(Theme.body(13, .medium))
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity)
        }
        .padding(20)
        .background(Theme.surface)
    }
}
