#pragma once

#include <portus/file_follow.hpp>

namespace vestigium {

// Recover the Node cursor key, checking that the metadata handle refers to the followed file.
std::string sourceCheckpointKey(const std::filesystem::path& path, const portus::FileFollowId& followed);

}
