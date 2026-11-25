#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <portus/json.hpp>

namespace vestigium {

enum class SourceKind { service, contract };

// The canonical timestamp and message selected from service log fields.
struct ServiceAliases {
    std::string time;
    std::string message;
};

// Select a valid timestamp in service field priority order.
std::optional<std::string> serviceTime(const portus::Json& row);
// Resolve the supported timestamp and message aliases before adding metadata.
std::optional<ServiceAliases> resolveServiceAliases(const portus::Json& row);
// Convert one complete source row to VictoriaLogs JSON or reject it.
std::optional<std::string> formatRecord(std::string_view line, std::string_view service, SourceKind kind);

}
