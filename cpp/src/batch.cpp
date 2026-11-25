#include "vestigium/batch.hpp"

#include <lorica/byte_view.hpp>
#include <lorica/checked_size.hpp>
#include <lorica/input_budget.hpp>

#include <span>
#include <stdexcept>

namespace vestigium {
namespace {

bool appendRow(Batch& batch, const std::string& row) {
    const auto rowSize = lorica::checked_add(row.size(), 1);
    const auto bodySize = rowSize ? lorica::checked_add(batch.body.size(), *rowSize) : std::nullopt;
    if (!bodySize || *bodySize > batchLimit) {
        if (batch.consumed != 0) return false;
        throw std::runtime_error("formatted log row exceeds batch limit");
    }
    batch.body.append(row);
    batch.body.push_back('\n');
    ++batch.rows;
    return true;
}

bool meaningful(std::string_view line) {
    if (line.starts_with("\xef\xbb\xbf")) line.remove_prefix(3);
    return line.find_first_not_of(" \t\r") != std::string_view::npos;
}

}

Batch makeBatch(std::string_view input, std::string_view service, SourceKind kind) {
    const auto bytes = std::as_bytes(std::span{input});
    const auto view = lorica::byte_view::make(bytes.data(), bytes.size(), batchLimit);
    if (!view) throw std::invalid_argument("log input exceeds batch limit");
    lorica::input_budget budget({batchLimit, batchLimit, batchLimit, 64});
    Batch batch;
    while (true) {
        const auto newline = input.find('\n', batch.consumed);
        if (newline == std::string_view::npos) break;
        const auto length = newline - batch.consumed;
        if (!view->subview(batch.consumed, length) || !budget.consume(length, 1, 1)) {
            throw std::runtime_error("log input exceeds parse budget");
        }
        const auto line = input.substr(batch.consumed, length);
        if (const auto row = formatRecord(line, service, kind)) {
            if (!appendRow(batch, *row)) break;
        } else if (meaningful(line)) {
            ++batch.invalidRows;
        }
        batch.consumed = newline + 1;
    }
    if (batch.consumed == 0 && input.size() == batchLimit) {
        throw std::runtime_error("no complete log row within batch limit");
    }
    return batch;
}

}
