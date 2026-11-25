#include "vestigium/checkpoints.hpp"

#ifdef _WIN32
#include "vestigium/checkpoint_key.hpp"
#include "windows_handle.hpp"

#include <array>
#include <charconv>
#include <stdexcept>
#include <string_view>

namespace vestigium {
namespace {

constexpr std::uint64_t maximumOffset = 9'007'199'254'740'991; // Node Number.MAX_SAFE_INTEGER

std::filesystem::path checkpointDirectory(const std::filesystem::path& root, const std::string& origin) {
    if (!std::filesystem::is_directory(root)) throw std::runtime_error("VictoriaLogs log root is not a directory");
    auto directory = root / ".vestigium-victorialogs" / destinationKey(origin);
    std::filesystem::create_directories(directory);
    return directory;
}

}

class CheckpointStore::Lock {
public:
    explicit Lock(const std::filesystem::path& path)
        : handle_(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_ALWAYS,
              FILE_ATTRIBUTE_NORMAL, nullptr), "open exclusive VictoriaLogs sink lock") {}

private:
    WindowsHandle handle_;
};

CheckpointStore::CheckpointStore(const std::filesystem::path& root, const std::string& origin)
    : directory_(checkpointDirectory(root, origin)), lock_(std::make_unique<Lock>(directory_ / ".lock")) {}

CheckpointStore::~CheckpointStore() = default;

std::uint64_t CheckpointStore::load(const std::string& key) const {
    const auto path = directory_ / key;
    const auto handle = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE && GetLastError() == ERROR_FILE_NOT_FOUND) return 0;
    const WindowsHandle file(handle, "open VictoriaLogs checkpoint");

    // A valid cursor needs at most 16 digits and LF. One extra byte detects excess input.
    std::array<char, 18> bytes{};
    DWORD count = 0;
    if (!ReadFile(file.get(), bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr)) {
        failWindows("read VictoriaLogs checkpoint");
    }
    auto text = std::string_view{bytes.data(), count};
    if (text.ends_with('\n') && count < bytes.size()) {
        text.remove_suffix(1);
        std::uint64_t offset = 0;
        const auto parsed = std::from_chars(text.data(), text.data() + text.size(), offset);
        if (parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size() && offset <= maximumOffset) {
            return offset;
        }
    }
    throw std::runtime_error("invalid VictoriaLogs checkpoint " + key);
}

void CheckpointStore::save(const std::string& key, std::uint64_t offset) const {
    if (offset > maximumOffset) throw std::runtime_error("VictoriaLogs checkpoint exceeds safe integer range");
    const auto target = directory_ / key;
    auto temporary = target;
    temporary += ".tmp";
    {
        // Only the process holding the directory lock can write this temporary file.
        const auto bytes = std::to_string(offset) + '\n';
        const WindowsHandle file(CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
              FILE_ATTRIBUTE_NORMAL, nullptr), "open temporary VictoriaLogs checkpoint");
        DWORD count = 0;
        if (!WriteFile(file.get(), bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr)) {
            failWindows("write VictoriaLogs checkpoint");
        }
        if (count != bytes.size()) throw std::runtime_error("incomplete VictoriaLogs checkpoint write");
        if (!FlushFileBuffers(file.get())) failWindows("flush VictoriaLogs checkpoint");
    }
    if (!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        failWindows("replace VictoriaLogs checkpoint");
    }
}

}
#endif
