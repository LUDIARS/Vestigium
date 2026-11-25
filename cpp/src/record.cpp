#include "vestigium/record.hpp"
#include "vestigium/batch.hpp"

#include "timestamp.hpp"

#include <algorithm>
#include <initializer_list>
#include <lorica/input_budget.hpp>
#include <portus/util.hpp>
#include "augur/contract_runtime.hpp" /* augur-inject:import:1072f73f */
#include "service_record.contract.hpp" /* augur-inject:contract-predicate:8c1da4ef */

namespace vestigium {
namespace {

using portus::Json;

std::string_view choice(const Json& value, std::initializer_list<std::string_view> valid, std::string_view fallback) {
    const auto& text = value.as_string();
    return std::ranges::find(valid, text) != valid.end() ? std::string_view{text} : fallback;
}

std::string_view contractLevel(std::string_view message) {
    if (message == "contract violated") return "warn";
    if (message == "contract predicate threw") return "error";
    return "info";
}

std::optional<std::string> formatService(const Json& row, std::string_view service) {
    const auto& recordedService = row.at("service");
    if (!recordedService.is_string() || recordedService.as_string() != service) return {};
    const auto aliases = resolveServiceAliases(row);
    if (!aliases) return {};
    const auto level = choice(row.at("level"), {"trace", "debug", "info", "warn", "error", "fatal"}, "info");
    const auto channel = choice(row.at("channel"), {"stdout", "stderr", "app", "llm"}, "app");
    auto result = Json::object({{"service", service}, {"kind", "service"}, {"_time", aliases->time},
        {"_msg", aliases->message}, {"level", level}, {"channel", channel}});
    const auto& pid = row.at("pid");
    const auto& context = row.at("ctx");
    if (pid.is_number()) result.set("pid", pid);
    if (context.is_object() || context.is_array()) result.set("ctx", context);
    return result.dump();
}

std::optional<std::string> contractTime(const Json& row) {
    if (const auto time = instant(row.at("ctx").at("observed_at"))) {
        return time;
    }
    if (const auto time = instant(row.at("time"))) {
        return time;
    }
    return instant(row.at("ts"));
}

std::optional<std::string> formatContract(const Json& row, std::string_view service) {
    const auto& message = row.at("msg");
    if (!message.is_string()) return {};
    const auto time = contractTime(row);
    if (!time) return {};
    const auto& context = row.at("ctx");
    const auto& level = row.at("level");
    auto result = Json::object({{"service", service}, {"kind", "contract"}, {"_time", *time},
        {"_msg", message}, {"level", level.is_string() ? level : Json{contractLevel(message.as_string())}},
        {"ctx", context.is_object() ? context : Json::object()}});
    const auto& id = context.at("contract");
    if (id.is_string()) result.set("contract_id", id);
    return result.dump();
}

}

// Only ts can use numeric epoch milliseconds. Later fields must be ISO strings.
std::optional<std::string> serviceTime(const portus::Json& row) {
    const auto& epoch = row.at("ts");
    if (epoch.is_number()) {
        if (const auto time = instant(epoch)) {
            return time;
        }
    }
    for (const auto* name : {"timestamp", "time"}) {
        const auto& value = row.at(name);
        if (value.is_string()) {
            if (const auto time = instant(value)) {
                return time;
            }
        }
    }
    return {};
}

std::optional<ServiceAliases> resolveServiceAliases(const portus::Json& row) { return ::augur::invoke_observed(::augur::ContractSpec{"C-2", "9badba54", "cpp/src/record.cpp:80"}, contracts::service_record_checks, [&]() -> std::optional<ServiceAliases> { /* augur-inject:contract-wrap:9badba54 */
    const auto time = serviceTime(row);
    if (!time) return {};
    for (const auto* name : {"msg", "event", "message"}) {
        const auto& message = row.at(name);
        if (message.is_string()) return ServiceAliases{*time, message.as_string()};
    }
    return {};
}, row); /* augur-inject:contract-end:9badba54 */ }

std::optional<std::string> formatRecord(std::string_view line, std::string_view service, SourceKind kind) {
    lorica::input_budget budget({batchLimit, 1, 1, 64});
    if (!budget.consume(line.size(), 1, 1)) return {};
    if (line.starts_with("\xef\xbb\xbf")) line.remove_prefix(3);
    if (!portus::utf8_valid(line)) return {};
    try {
        const auto row = Json::parse(line, budget.remaining().depth);
        if (!row.is_object()) return {};
        return kind == SourceKind::service ? formatService(row, service) : formatContract(row, service);
    } catch (const portus::JsonError&) {
        return {};
    }
}

}
