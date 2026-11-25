#pragma once

#include "augur/contract_runtime.hpp"
#include "diagnostics.hpp"

#include <portus/json.hpp>

namespace contracts {
inline const auto sink_diagnostic_checks = augur::post_only(
    [](const std::string& line, const vestigium::ExportDiagnostic& diagnostic, std::int64_t epochMs) {
        const auto row = portus::Json::parse(line);
        const auto& context = row.at("ctx");
        if (line.find('\n') != line.size() - 1 || row.at("ts").as_number() != static_cast<double>(epochMs)
            || row.at("service").as_string() != "vestigium-sink"
            || context.at("event").as_string() != diagnostic.event || !context.at("row").is_null()) return false;
        if (!diagnostic.skipped) {
            return context.at("from_byte").is_null() && context.at("to_byte_exclusive").is_null();
        }
        return context.at("from_byte").as_string() == std::to_string(diagnostic.skipped->begin)
            && context.at("to_byte_exclusive").as_string() == std::to_string(diagnostic.skipped->end)
            && context.at("invalid_rows").as_number() == static_cast<double>(diagnostic.skipped->invalidRows);
    });
}
