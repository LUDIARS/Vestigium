#pragma once

#include "vestigium/record.hpp"

#include <cstddef>

namespace vestigium {
inline constexpr std::size_t batchLimit = 1024 * 1024;

// The request body and byte count for the complete lines represented in it.
struct Batch {
    std::size_t consumed = 0;
    std::string body;
    std::size_t invalidRows = 0;
    std::size_t rows = 0;
};

// Consumed counts complete source bytes, including newlines. Commit it only after send.
Batch makeBatch(std::string_view input, std::string_view service, SourceKind kind);
}
