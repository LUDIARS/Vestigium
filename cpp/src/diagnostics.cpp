#include "diagnostics.hpp"

#include <chrono>
#include <format>
#include <fstream>
#include <iostream>
#include <portus/json.hpp>
#include <portus/util.hpp>
#include "augur/contract_runtime.hpp" /* augur-inject:import:2a0a5ef5 */
#include "sink_diagnostic.contract.hpp" /* augur-inject:contract-predicate:44a40802 */

namespace vestigium {

std::string formatDiagnostic(const ExportDiagnostic& diagnostic, std::int64_t epochMs) { return ::augur::invoke_observed(::augur::ContractSpec{"C-4", "38cbc5d2", "cpp/src/diagnostics.cpp:12"}, contracts::sink_diagnostic_checks, [&]() -> std::string { /* augur-inject:contract-wrap:38cbc5d2 */
    auto context = portus::Json::object({{"event", diagnostic.event}});
    if (!diagnostic.source.empty()) {
        const auto path = diagnostic.source.u8string();
        context.set("source", std::string{path.begin(), path.end()});
    }
    if (diagnostic.skipped) {
        const auto& range = *diagnostic.skipped;
        context.set("from_byte", std::to_string(range.begin));
        context.set("to_byte_exclusive", std::to_string(range.end));
        context.set("invalid_rows", static_cast<double>(range.invalidRows));
    }
    const auto message = portus::utf8_valid(diagnostic.message) ? diagnostic.message : "sink error text is not UTF-8";
    const auto row = portus::Json::object({{"ts", static_cast<double>(epochMs)}, {"level", "warn"},
        {"service", "vestigium-sink"}, {"channel", "app"}, {"msg", message}, {"ctx", context}});
    return row.dump() + '\n';
}, diagnostic, epochMs); /* augur-inject:contract-end:38cbc5d2 */ }

void recordDiagnostic(const std::filesystem::path& directory, const ExportDiagnostic& diagnostic) {
    try {
        using namespace std::chrono;
        const auto now = system_clock::now();
        const auto line = formatDiagnostic(diagnostic, duration_cast<milliseconds>(now.time_since_epoch()).count());
        std::cerr << line;
        const auto day = year_month_day{floor<days>(now)};
        const auto filename = std::format("diagnostics-{:%F}.jsonl", day);
        std::ofstream output;
        output.exceptions(std::ios::failbit | std::ios::badbit);
        output.open(directory / filename, std::ios::binary | std::ios::app);
        output << line;
        output.close();
    } catch (const std::exception& error) {
        std::cerr << "[vestigium-sink] could not persist diagnostic: " << error.what() << '\n';
    }
}

}
