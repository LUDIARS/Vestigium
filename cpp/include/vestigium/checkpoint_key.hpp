#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace vestigium {

// Values follow Node BigIntStats exactly. The file reader must obtain them from its open handle.
struct CheckpointIdentity {
    std::uint64_t device;
    std::uint64_t inode;
    std::string birthtimeNs;
};

// Use the canonical origin to select the existing checkpoint directory.
std::string destinationKey(const std::string& origin);
// Derive a checkpoint name that survives rename and hard links.
std::string fileKey(const CheckpointIdentity& identity, std::string_view sourcePath);

}
