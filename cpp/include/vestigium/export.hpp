#pragma once

#include "vestigium/checkpoints.hpp"

#include <cstddef>
#include <functional>
#include <iosfwd>

namespace vestigium {

// Counts delivered rows and failed files during one scan.
struct ExportResult {
    std::size_t rows = 0;
    std::size_t failedFiles = 0;
};

using BatchSender = std::function<void(std::string)>;

// Walk one opening snapshot of each log. A destination failure ends the pass.
ExportResult exportLogs(const std::filesystem::path& root, const CheckpointStore& checkpoints,
                        const BatchSender& send, std::ostream& warnings);

}
