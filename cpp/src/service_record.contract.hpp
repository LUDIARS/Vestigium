#pragma once

#include "augur/contract_runtime.hpp"
#include "vestigium/record.hpp"

namespace contracts {
inline const auto service_record_checks = augur::predicates(
    [](const portus::Json&) { return true; },
    [](const std::optional<vestigium::ServiceAliases>& result, const portus::Json& row) {
        const auto time = vestigium::serviceTime(row);
        for (const auto* field : {"msg", "event", "message"}) {
            const auto& message = row.at(field);
            if (message.is_string()) {
                if (!time) return !result;
                return result && result->time == *time && result->message == message.as_string();
            }
        }
        return !result;
    });
}
