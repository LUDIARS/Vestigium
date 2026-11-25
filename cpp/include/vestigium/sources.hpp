#pragma once

#include "vestigium/record.hpp"

#include <filesystem>
#include <vector>

namespace vestigium {
// A file paired with the stream labels derived from its path.
struct LogSource {
    std::filesystem::path path;
    std::string service;
    SourceKind kind;
};

// Discover supported JSONL file names without following directory symlinks.
std::vector<LogSource> discoverSources(const std::filesystem::path& root);
}
