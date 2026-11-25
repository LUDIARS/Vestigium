#pragma once

#include "vestigium/export.hpp"

namespace vestigium {

// Encode one diagnostic as a newline-terminated Vestigium record.
std::string formatDiagnostic(const ExportDiagnostic& diagnostic, std::int64_t epochMs);

// Append a UTF-8 diagnostic while keeping stderr available if the file is unwritable.
void recordDiagnostic(const std::filesystem::path& directory, const ExportDiagnostic& diagnostic);

}
