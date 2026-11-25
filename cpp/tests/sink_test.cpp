#include "vestigium/batch.hpp"
#include "vestigium/checkpoint_key.hpp"
#include "vestigium/victoria_http.hpp"

#include <iostream>
#include <stdexcept>

namespace {

using namespace vestigium;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void endpoint() {
    require(createInsertUrl("HTTP://LOCALHOST:80/") ==
        "http://localhost/insert/jsonline?_time_field=_time&_msg_field=_msg&_stream_fields=service%2Ckind",
        "insert query or origin differs");
    for (const auto* url : {"http://user:pass@localhost", "http://localhost/path",
                            "http://localhost/#fragment", "http://localhost?x=y", "ftp://localhost"}) {
        try {
            static_cast<void>(createInsertUrl(url));
        } catch (const std::invalid_argument&) {
            continue;
        }
        throw std::runtime_error("invalid destination was accepted");
    }
}

void aliases() {
    const auto original = portus::Json::parse(
        R"({"ts":-1,"timestamp":"2026-11-25T00:00:00Z","msg":"","event":"ignored"})");
    const auto primary = resolveServiceAliases(original);
    require(primary && primary->time == "1969-12-31T23:59:59.999Z" && primary->message.empty(),
        "epoch and msg take precedence");

    const auto revisor = portus::Json::parse(
        R"({"ts":"invalid","timestamp":"2026-11-25T09:00:14.2834+09:00","event":"heartbeat","message":"ignored"})");
    const auto alternative = resolveServiceAliases(revisor);
    require(alternative && alternative->time == "2026-11-25T00:00:14.283Z"
        && alternative->message == "heartbeat", "ISO timestamp and event are accepted");

    const auto fallback = portus::Json::parse(
        R"({"timestamp":"invalid","time":"2026-11-25T09:00:14+09:00","message":"fallback"})");
    const auto last = resolveServiceAliases(fallback);
    require(last && last->time == "2026-11-25T00:00:14.000Z" && last->message == "fallback",
        "time and message are the final fallbacks");
    require(!resolveServiceAliases(portus::Json::object({{"ts", 0}})), "missing message must be rejected");
}

void contractRecord() {
    const auto formatted = formatRecord(
        R"({"ts":1,"time":"2026-11-26T00:00:00Z","msg":"contract violated","ctx":{"observed_at":"2026-11-25T00:00:00Z","contract":"C-2"}})",
        "actio", SourceKind::contract);
    require(formatted.has_value(), "contract record rejected");
    const auto row = portus::Json::parse(formatted.value());
    require(row.at("_time").as_string() == "2026-11-25T00:00:00.000Z", "observed timestamp is preferred");
    require(row.at("_msg").as_string() == "contract violated", "message changed");
    require(row.at("service").as_string() == "actio" && row.at("kind").as_string() == "contract", "wrong stream");
    require(row.at("level").as_string() == "warn" && row.at("contract_id").as_string() == "C-2", "wrong fields");
}

void batches() {
    const std::string prefix = "{\"service\":\"revisor\",\"ts\":0,\"event\":\"ok\"}\r\n\xff\n";
    const auto batch = makeBatch(prefix + "{\"event\":\"\xe6\x97", "revisor", SourceKind::service);
    require(batch.consumed == prefix.size() && batch.rows == 1 && batch.invalidRows == 1,
        "unfinished UTF-8 suffix must remain unread and invalid complete line counted");
    require(batch.body.ends_with('\n'), "output is newline-delimited");
    try {
        static_cast<void>(makeBatch(std::string(batchLimit, 'x'), "revisor", SourceKind::service));
    } catch (const std::runtime_error&) {
        return;
    }
    throw std::runtime_error("oversize partial line was accepted");
}

void checkpointKeys() {
    require(destinationKey("http://127.0.0.1:9428/") ==
        "8c0d0308a4689d572212f1b2aa6c631c54d6d5876fe5b41abaab07b40c63dd41", "origin hash differs from TypeScript");
    const CheckpointIdentity identity{42, 187, "1795651200123456700"};
    const auto key = fileKey(identity, "contracts.jsonl");
    require(key == "fc6960372f2ee1c78faa858235786dd6628d4aa2ff46af634388097952c5d394",
        "Windows identity serialization differs from TypeScript");
    require(key == fileKey(identity, "archive/contracts-2026-11-26.jsonl"), "rename must preserve identity");
    require(fileKey({0, 0, identity.birthtimeNs}, "C:/logs/revisor/2026-11-26.jsonl") ==
        "369533804f6dab9cda98fffda6da545ab8f62f9328bc9f26ed332fcd363bda8b", "fallback path hash differs");
}

}

int main() {
    try {
        endpoint();
        aliases();
        contractRecord();
        batches();
        checkpointKeys();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    return 0;
}
