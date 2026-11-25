#pragma once

#include <optional>
#include <string>
#include <portus/json.hpp>

namespace vestigium {
// Normalize a supported ISO timestamp or epoch milliseconds to UTC.
std::optional<std::string> instant(const portus::Json& value);
}
