#ifdef _WIN32
#include "diagnostics.hpp"
#include "source_identity.hpp"
#include "vestigium/batch.hpp"
#include "vestigium/checkpoint_key.hpp"
#include "vestigium/export.hpp"

#include <fstream>
#include <iostream>
#include <random>
#include <stdexcept>
#include <system_error>
#include <utility>
#include <vector>

namespace {

using namespace vestigium;
namespace fs = std::filesystem;

constexpr auto origin = "http://127.0.0.1:9428";
constexpr auto date = "2026-11-26";
constexpr std::string_view first = "{\"ts\":0,\"msg\":\"first\"}\r\n";
constexpr std::string_view second = "{\"ts\":1,\"msg\":\"second with more bytes\"}\n";

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

class TestRoot {
public:
    TestRoot() : path_(fs::temp_directory_path() / ("vestigium-sink-test-" + std::to_string(std::random_device{}()))) {
        if (!fs::create_directory(path_)) throw std::runtime_error("test root already exists");
    }
    ~TestRoot() {
        std::error_code ignored;
        fs::remove_all(path_, ignored);
    }
    TestRoot(const TestRoot&) = delete;
    TestRoot& operator=(const TestRoot&) = delete;

    [[nodiscard]] const fs::path& path() const { return path_; }

private:
    fs::path path_;
};

void write(const fs::path& file, std::string_view bytes, std::ios::openmode mode = std::ios::trunc) {
    std::ofstream stream;
    stream.exceptions(std::ios::failbit | std::ios::badbit);
    stream.open(file, mode | std::ios::binary);
    stream << bytes;
    stream.close();
}

std::string keyFor(const fs::path& file) {
    const portus::FileFollower follower(file);
    return sourceCheckpointKey(file, follower.snapshot().id);
}

void requireLockUnavailable(const fs::path& root) {
    try {
        const CheckpointStore competing(root, "HTTP://127.0.0.1:9428/");
    } catch (const std::system_error&) {
        return;
    }
    throw std::runtime_error("sink started with the same root and canonical destination");
}

void retriesFromLegacyCursor() {
    const TestRoot root;
    const auto file = root.path() / "contracts.jsonl";
    write(file, std::string(first) + std::string(second));
    const auto key = keyFor(file);
    const auto oldDirectory = root.path() / ".vestigium-victorialogs" / destinationKey(origin);
    fs::create_directories(oldDirectory);
    write(oldDirectory / key, std::to_string(first.size()) + '\n');

    const DiagnosticReporter ignoreDiagnostic = [](const ExportDiagnostic&) {};
    {
        const CheckpointStore store(root.path(), origin);
        requireLockUnavailable(root.path());
        const CheckpointStore differentDestination(root.path(), "http://127.0.0.1:9429");
        const auto failed = exportLogs(root.path(), store, [](std::string) {
            throw std::runtime_error("destination unavailable");
        }, ignoreDiagnostic);
        require(failed.failedFiles == 1 && failed.rows == 0, "failed insert was counted as delivered");
        require(store.load(key) == first.size(), "failed insert changed the Node cursor");
    }

    const CheckpointStore store(root.path(), origin);
    std::vector<std::string> bodies;
    const auto collect = [&bodies](std::string body) {
        bodies.push_back(std::move(body));
    };
    require(exportLogs(root.path(), store, collect, ignoreDiagnostic).rows == 1 && bodies.size() == 1,
            "restart did not send exactly the pending row");
    require(bodies.front().find("second with more bytes") != std::string::npos,
            "restart replayed the already committed row");
    require(store.load(key) == first.size() + second.size(), "successful insert did not advance the cursor");
    require(exportLogs(root.path(), store, collect, ignoreDiagnostic).rows == 0, "rescan sent a committed row again");
    require(fs::exists(file), "export removed its input");
}

void rotationAndTruncation() {
    const TestRoot root;
    const auto current = root.path() / "contracts.jsonl";
    const auto archive = root.path() / "archive";
    const auto rotated = archive / (std::string("contracts-") + date + ".jsonl");
    const CheckpointStore store(root.path(), origin);
    const BatchSender accept = [](std::string) {};
    const DiagnosticReporter ignoreDiagnostic = [](const ExportDiagnostic&) {};

    write(current, second);
    const auto key = keyFor(current);
    require(exportLogs(root.path(), store, accept, ignoreDiagnostic).rows == 1, "initial row was not sent");
    fs::create_directory(archive);
    fs::create_hard_link(current, rotated);
    require(keyFor(rotated) == key, "hard link changed checkpoint identity");
    require(exportLogs(root.path(), store, accept, ignoreDiagnostic).rows == 0, "hard link replayed a committed row");
    fs::remove(rotated);
    fs::rename(current, rotated);
    require(keyFor(rotated) == key, "rename changed checkpoint identity");
    write(current, first);
    require(keyFor(current) != key, "replacement inherited the retired file identity");
    require(exportLogs(root.path(), store, accept, ignoreDiagnostic).rows == 1,
            "replacement did not start at byte zero");

    write(rotated, first);
    bool truncated = false;
    const auto report = [&truncated](const ExportDiagnostic& diagnostic) {
        truncated |= diagnostic.event == "source_truncated";
    };
    require(exportLogs(root.path(), store, accept, report).rows == 1, "truncation did not restart the file");
    require(store.load(key) == first.size() && truncated,
            "truncation was not reported and checkpointed");
}

// Exercise the Revisor input path with a split UTF-8 message and both skip and size diagnostics.
void incompleteAndOversizeLines() {
    const TestRoot root;
    const auto directory = root.path() / "revisor";
    const auto file = directory / (std::string(date) + ".jsonl");
    fs::create_directory(directory);
    write(file, "{\"timestamp\":\"2026-11-25T23:26:17.774Z\",\"level\":\"info\","
                "\"service\":\"revisor\",\"event\":\"\xe6\x97");
    const auto key = keyFor(file);
    const CheckpointStore store(root.path(), origin);
    const auto report = [&store](const ExportDiagnostic& diagnostic) {
        recordDiagnostic(store.directory(), diagnostic);
    };
    std::string body;
    const auto collect = [&body](std::string row) {
        body = std::move(row);
    };
    require(exportLogs(root.path(), store, collect, report).rows == 0 && store.load(key) == 0,
            "partial UTF-8 row was consumed");
    write(file, "\xa5\"}\ninvalid\n", std::ios::app);
    require(exportLogs(root.path(), store, collect, report).rows == 1 && body.contains("\xe6\x97\xa5")
        && body.contains("\"_time\":\"2026-11-25T23:26:17.774Z\""),
            "row completed across scans was not sent intact");

    const auto cursor = store.load(key);
    write(file, std::string(batchLimit, 'x') + "\n", std::ios::app);
    const auto failed = exportLogs(root.path(), store, collect, report);
    require(failed.failedFiles == 1 && store.load(key) == cursor, "oversized line advanced the cursor");
    bool invalidLogged = false;
    bool oversizeLogged = false;
    for (const auto& entry : fs::directory_iterator(store.directory())) {
        if (entry.path().extension() != ".jsonl") continue;
        std::ifstream input(entry.path(), std::ios::binary);
        for (std::string line; std::getline(input, line);) {
            invalidLogged |= line.contains("\"event\":\"invalid_rows\"")
                && line.contains("\"from_byte\":\"0\"")
                && line.contains("\"to_byte_exclusive\":\"" + std::to_string(cursor) + "\"")
                && !line.contains("2026-11-25T23:26:17.774Z");
            oversizeLogged |= line.contains("line exceeds batch limit at byte ");
        }
    }
    require(invalidLogged && oversizeLogged, "source diagnostics were not persisted with the expected range");
}

}

int main() {
    try {
        retriesFromLegacyCursor();
        rotationAndTruncation();
        incompleteAndOversizeLines();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    return 0;
}
#endif
