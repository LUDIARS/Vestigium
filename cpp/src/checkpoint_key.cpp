#include "vestigium/checkpoint_key.hpp"

#include "vestigium/victoria_http.hpp"

#include <portus/crypto.hpp>

namespace vestigium {

std::string destinationKey(const std::string& origin) {
    const auto endpoint = createInsertUrl(origin);
    const auto end = endpoint.find('/', endpoint.find("://") + 3);
    return portus::hex(portus::sha256(std::string_view{endpoint}.substr(0, end)));
}

std::string fileKey(const CheckpointIdentity& identity, std::string_view sourcePath) {
    const auto name = identity.inode == 0 ? std::string{sourcePath}
        : std::to_string(identity.device) + ":" + std::to_string(identity.inode);
    return portus::hex(portus::sha256(name + ":" + identity.birthtimeNs));
}

}
