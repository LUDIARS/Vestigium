#pragma once

#include "augur/contract_runtime.hpp"
#include "vestigium/checkpoints.hpp"

namespace contracts {
inline const auto reset_checkpoint_checks = augur::predicates(
    [](const vestigium::CheckpointStore&, const std::string&) { return true; },
    [](std::uint64_t offset, const vestigium::CheckpointStore& store, const std::string& key) {
        return offset == 0 && store.load(key) == 0;
    });
}
