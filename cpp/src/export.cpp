#include "vestigium/export.hpp"

#include "source_identity.hpp"
#include "vestigium/batch.hpp"
#include "vestigium/sources.hpp"

#include <optional>
#include <ostream>
#include <stdexcept>
#include <system_error>
#include <utility>
#include "augur/contract_runtime.hpp" /* augur-inject:import:8e197ab2 */
#include "reset_checkpoint.contract.hpp" /* augur-inject:contract-predicate:7462f7be */

namespace vestigium {

static std::uint64_t resetCheckpoint(const CheckpointStore& store, const std::string& key) { return ::augur::invoke_observed(::augur::ContractSpec{"C-3", "6cbddc0a", "cpp/src/export.cpp:15"}, contracts::reset_checkpoint_checks, [&]() -> std::uint64_t { /* augur-inject:contract-wrap:6cbddc0a */
    store.save(key, 0);
    return 0;
}, store, key); /* augur-inject:contract-end:6cbddc0a */ }

namespace {

std::ostream& sourceWarning(std::ostream& warnings, const LogSource& source) {
    const auto path = source.path.u8string();
    return warnings << "[vestigium-sink] " << std::string{path.begin(), path.end()} << ": ";
}

class DestinationError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void deliver(const BatchSender& send, std::string body) {
    if (body.empty()) return;
    try {
        send(std::move(body));
    } catch (const std::exception& error) {
        throw DestinationError(error.what());
    }
}

void exportSource(const LogSource& source, const CheckpointStore& checkpoints,
                  const BatchSender& send, std::ostream& warnings, ExportResult& result) {
    std::optional<portus::FileFollower> file;
    std::string key;
    try {
        file.emplace(source.path);
        key = sourceCheckpointKey(source.path, file->snapshot().id);
    } catch (const std::system_error& error) {
        if (error.code() != std::errc::no_such_file_or_directory) throw;
        // Rotation can remove a source after discovery. The next scan finds its new name.
        return;
    }
    auto offset = checkpoints.load(key);
    for (;;) {
        const auto read = file->read(offset, batchLimit);
        if (read.status == portus::FileFollowStatus::truncated) {
            sourceWarning(warnings, source) << "file truncated; restarting at byte 0\n";
            offset = resetCheckpoint(checkpoints, key);
            continue;
        }
        if (read.status == portus::FileFollowStatus::line_too_long) {
            throw std::runtime_error("log line exceeds batch limit at byte " + std::to_string(offset));
        }
        if (read.bytes.empty()) return;

        Batch batch;
        try {
            batch = makeBatch(read.bytes, source.service, source.kind);
        } catch (const std::runtime_error& error) {
            throw std::runtime_error(std::string(error.what()) + " at byte " + std::to_string(offset));
        }
        // Normalization can expand a row. Commit only the source bytes represented by this body.
        const auto next = read.next_offset - (read.bytes.size() - batch.consumed);
        deliver(send, std::move(batch.body));
        checkpoints.save(key, next);
        if (batch.invalidRows) {
            sourceWarning(warnings, source) << "skipped " << batch.invalidRows
                << " invalid row(s) at bytes " << offset << '-' << next << '\n';
        }
        result.rows += batch.rows;
        offset = next;
    }
}

}

ExportResult exportLogs(const std::filesystem::path& root, const CheckpointStore& checkpoints,
                        const BatchSender& send, std::ostream& warnings) {
    ExportResult result;
    for (const auto& source : discoverSources(root)) {
        try {
            exportSource(source, checkpoints, send, warnings, result);
        } catch (const DestinationError& error) {
            ++result.failedFiles;
            sourceWarning(warnings, source) << error.what() << '\n';
            break;
        } catch (const std::exception& error) {
            ++result.failedFiles;
            sourceWarning(warnings, source) << error.what() << '\n';
        }
    }
    return result;
}

}
