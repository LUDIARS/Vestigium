#include "vestigium/sources.hpp"

#include <algorithm>

namespace vestigium {
namespace {

namespace fs = std::filesystem;

bool digits(std::string_view text) {
    return !text.empty() && text.find_first_not_of("0123456789") == std::string_view::npos;
}

bool dateShape(std::string_view name) {
    return name.size() == 10 && name[4] == '-' && name[7] == '-'
        && digits(name.substr(0, 4)) && digits(name.substr(5, 2)) && digits(name.substr(8, 2));
}

bool serviceDay(std::string_view stem) {
    return dateShape(stem) && stem.substr(0, 4) != "0000"
        && stem.substr(5, 2) != "00" && stem.substr(8, 2) != "00";
}

constexpr std::string_view codeCharacters = "abcdefghijklmnopqrstuvwxyz0123456789-_";

bool serviceCode(std::string_view name) {
    return !name.empty() && name.size() <= 64 && name.front() != '-' && name.front() != '_'
        && name.find_first_not_of(codeCharacters) == std::string_view::npos;
}

bool actioLog(std::string_view stem) {
    constexpr std::string_view prefix = "contracts-actio-";
    if (!stem.starts_with(prefix)) return false;
    stem.remove_prefix(prefix.size());
    if (stem.size() <= 11 || stem[10] != '-' || !dateShape(stem.substr(0, 10))) return false;
    return stem.substr(11).find_first_not_of(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") == std::string_view::npos;
}

std::string asciiName(const fs::path& path) {
    const auto name = path.filename().u8string();
    return {name.begin(), name.end()};
}

void addDirectory(std::vector<LogSource>& sources, const fs::path& directory, const std::string& code) {
    std::error_code error;
    const fs::directory_iterator children(directory, error);
    if (error == std::errc::no_such_file_or_directory) return;
    if (error) throw fs::filesystem_error("enumerate log directory", directory, error);
    for (const auto& child : children) {
        if (!fs::is_regular_file(child.symlink_status()) || child.path().extension() != ".jsonl") continue;
        const auto stem = asciiName(child.path().stem());
        if (code == "archive" && stem.starts_with("contracts-") && dateShape(std::string_view{stem}.substr(10))) {
            sources.push_back({child.path(), "augur", SourceKind::contract});
        } else if (serviceDay(stem)) {
            sources.push_back({child.path(), code, SourceKind::service});
        }
    }
}

void addRootFile(std::vector<LogSource>& sources, const fs::path& path, std::string_view name) {
    if (name == "contracts.jsonl") {
        sources.push_back({path, "augur", SourceKind::contract});
    } else if (path.extension() == ".jsonl" && actioLog(asciiName(path.stem()))) {
        sources.push_back({path, "actio", SourceKind::contract});
    }
}

}

std::vector<LogSource> discoverSources(const fs::path& root) {
    std::vector<LogSource> sources;
    for (const auto& entry : fs::directory_iterator(root)) {
        const auto status = entry.symlink_status();
        const auto name = asciiName(entry.path());
        if (fs::is_regular_file(status)) {
            addRootFile(sources, entry.path(), name);
        } else if (fs::is_directory(status) && serviceCode(name)) {
            addDirectory(sources, entry.path(), name);
        }
    }
    std::ranges::sort(sources, {}, &LogSource::path);
    return sources;
}

}
