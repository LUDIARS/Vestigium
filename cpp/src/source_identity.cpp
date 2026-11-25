#include "source_identity.hpp"

#ifdef _WIN32
#include "vestigium/checkpoint_key.hpp"
#include "windows_handle.hpp"

#include <algorithm>
#include <stdexcept>

namespace vestigium {
namespace {

std::uint64_t combineWords(DWORD high, DWORD low) {
    return (static_cast<std::uint64_t>(high) << 32) | low;
}

std::string birthtimeNs(const FILETIME& created) {
    constexpr std::uint64_t unixEpochTicks = 116'444'736'000'000'000;
    const auto ticks = combineWords(created.dwHighDateTime, created.dwLowDateTime);
    if (ticks == unixEpochTicks) return "0";
    // FILETIME counts 100ns ticks. Append the scale factor to avoid integer overflow.
    if (ticks < unixEpochTicks) return "-" + std::to_string(unixEpochTicks - ticks) + "00";
    return std::to_string(ticks - unixEpochTicks) + "00";
}

}

std::string sourceCheckpointKey(const std::filesystem::path& path, const portus::FileFollowId& followed) {
    const WindowsHandle handle(CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, nullptr), "open VictoriaLogs source metadata");

    FILE_ID_INFO identity{};
    if (!GetFileInformationByHandleEx(handle.get(), FileIdInfo, &identity, sizeof(identity))) {
        failWindows("read VictoriaLogs source file ID");
    }
    if (identity.VolumeSerialNumber != followed.volume ||
        !std::ranges::equal(identity.FileId.Identifier, followed.file)) {
        throw std::runtime_error("log path changed during discovery; retrying on the next scan");
    }

    // libuv exposes the volume serial and the 64-bit file index through Node BigIntStats.
    BY_HANDLE_FILE_INFORMATION metadata{};
    if (!GetFileInformationByHandle(handle.get(), &metadata)) failWindows("read VictoriaLogs source metadata");
    const auto inode = combineWords(metadata.nFileIndexHigh, metadata.nFileIndexLow);
    const auto source = path.u8string();
    return fileKey({metadata.dwVolumeSerialNumber, inode, birthtimeNs(metadata.ftCreationTime)},
                   std::string{source.begin(), source.end()});
}

}
#endif
