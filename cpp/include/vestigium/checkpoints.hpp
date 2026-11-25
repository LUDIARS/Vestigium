#pragma once

#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>

namespace vestigium {

// A store owns the process lock for its log root and destination.
class CheckpointStore {
public:
    // Open the destination's state directory and acquire its exclusive lock.
    CheckpointStore(const std::filesystem::path& root, const std::string& origin);
    ~CheckpointStore();
    CheckpointStore(const CheckpointStore&) = delete;
    CheckpointStore& operator=(const CheckpointStore&) = delete;

    // Keep per-destination diagnostics beside the cursors protected by this store.
    [[nodiscard]] const std::filesystem::path& directory() const noexcept { return directory_; }

    // Read a legacy-compatible byte cursor, or return zero when absent.
    [[nodiscard]] std::uint64_t load(const std::string& key) const;
    // Flush a replacement cursor before making it visible at its final path.
    void save(const std::string& key, std::uint64_t offset) const;

private:
    class Lock;
    std::filesystem::path directory_;
    std::unique_ptr<Lock> lock_;
};

}
