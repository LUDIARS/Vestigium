#include "vestigium/victoria_http.hpp"

#include <lorica/input_budget.hpp>
#include <portus/net.hpp>
#include <portus/url.hpp>
#include <stdexcept>
#include <utility>
#include "augur/contract_runtime.hpp" /* augur-inject:import:88b604f0 */
#include "insert_url.contract.hpp" /* augur-inject:contract-predicate:99478125 */

namespace vestigium {

std::string createInsertUrl(const std::string& origin) { return ::augur::invoke_observed(::augur::ContractSpec{"C-1", "74411a57", "cpp/src/victoria_http.cpp:11"}, contracts::insert_url_checks, [&]() -> std::string { /* augur-inject:contract-wrap:74411a57 */
    constexpr std::size_t maximum = 8192;
    lorica::input_budget budget({maximum, 1, 1, 0});
    portus::Url url;
    if (!budget.consume(origin.size(), 1, 1) || origin.find_first_of("@#?\\%") != std::string::npos
        || !portus::parse_url(origin, url) || (url.scheme != "http" && url.scheme != "https")
        || url.target != "/") {
        throw std::invalid_argument("VictoriaLogs URL must be an HTTP(S) origin without credentials");
    }
    return url.origin() + "/insert/jsonline?_time_field=_time&_msg_field=_msg&_stream_fields=service%2Ckind";
}, origin); /* augur-inject:contract-end:74411a57 */ }

void sendBatch(const std::string& endpoint, std::string body) {
    portus::FetchRequest request;
    request.method = "POST";
    request.headers = {{"content-type", "application/stream+json"}};
    request.body = std::move(body);
    request.timeout_ms = 15'000;
    const auto response = portus::fetch(endpoint, request);
    if (!response.ok()) throw std::runtime_error("VictoriaLogs returned HTTP " + std::to_string(response.status));
}

}
