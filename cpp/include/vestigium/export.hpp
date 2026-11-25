#pragma once

#include "vestigium/checkpoints.hpp"

#include <cstddef>
#include <functional>
#include <optional>
#include <string_view>

namespace vestigium {

// Counts delivered rows and failed files during one scan.
struct ExportResult {
    std::size_t rows = 0;
    std::size_t failedFiles = 0;
};

using BatchSender = std::function<void(std::string)>;

// Source bytes represented by a committed batch that contained invalid rows.
struct SkippedRows {
    std::uint64_t begin;
    std::uint64_t end;
    std::size_t invalidRows;
};

// Describe a scan problem without retaining the original log payload.
struct ExportDiagnostic {
    std::string_view event;
    std::filesystem::path source;
    std::string_view message;
    std::optional<SkippedRows> skipped = {};
};

// The diagnostic and its string views are valid only for the duration of the callback.
using DiagnosticReporter = std::function<void(const ExportDiagnostic&)>;

// Walk one opening snapshot of each log. A destination failure ends the pass.
ExportResult exportLogs(const std::filesystem::path& root, const CheckpointStore& checkpoints,
                        const BatchSender& send, const DiagnosticReporter& report);

}
