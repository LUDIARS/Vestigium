#ifdef _WIN32
#include "diagnostics.hpp"
#include "vestigium/export.hpp"
#include "vestigium/victoria_http.hpp"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string_view>
#include <thread>
#include <utility>

namespace {

struct Options {
    std::string origin;
    std::filesystem::path root;
    bool watch = false;
};

std::wstring_view readValue(int& index, int count, wchar_t* const* args) {
    if (++index == count) throw std::invalid_argument("option is missing its value");
    const std::wstring_view value(args[index]);
    if (value.empty() || value.starts_with(L"--")) throw std::invalid_argument("option is missing its value");
    return value;
}

// Portus accepts an ASCII HTTP origin. Keep Windows paths native throughout.
std::string originText(std::wstring_view value) {
    std::string ascii;
    for (const auto character : value) {
        if (character < 0x21 || character > 0x7e) {
            throw std::invalid_argument("VictoriaLogs URL must be an ASCII HTTP(S) origin");
        }
        ascii.push_back(static_cast<char>(character));
    }
    return ascii;
}

std::wstring environment(const wchar_t* name) {
    wchar_t* value = nullptr;
    std::size_t size = 0;
    const auto error = _wdupenv_s(&value, &size, name);
    const std::unique_ptr<wchar_t, decltype(&std::free)> buffer(value, std::free);
    if (error != 0) throw std::runtime_error("could not read sink environment");
    return buffer ? std::wstring(buffer.get()) : std::wstring{};
}

// Resolve CLI arguments before environment defaults so deployments can override either value.
Options parseOptions(int count, wchar_t* const* args) {
    Options options;
    for (int index = 1; index < count; ++index) {
        const std::wstring_view flag(args[index]);
        if (flag == L"--watch") options.watch = true;
        else if (flag == L"--url") options.origin = originText(readValue(index, count, args));
        else if (flag == L"--logs-dir") options.root = readValue(index, count, args);
        else throw std::invalid_argument("unrecognized option");
    }
    if (options.origin.empty()) options.origin = originText(environment(L"VESTIGIUM_VICTORIALOGS_URL"));
    if (options.root.empty()) options.root = environment(L"VESTIGIUM_LOGS_DIR");
    if (options.root.empty()) options.root = "logs";
    options.root = std::filesystem::absolute(options.root).lexically_normal().make_preferred();
    return options;
}

// Hold the cursor lock across scans and recover from transient errors in watch mode.
int run(const Options& options) {
    const auto endpoint = vestigium::createInsertUrl(options.origin);
    const vestigium::CheckpointStore checkpoints(options.root, options.origin);
    const auto report = [&checkpoints](const vestigium::ExportDiagnostic& diagnostic) {
        vestigium::recordDiagnostic(checkpoints.directory(), diagnostic);
    };
    const auto send = [&endpoint](std::string body) {
        vestigium::sendBatch(endpoint, std::move(body));
    };
    constexpr auto interval = std::chrono::seconds{5};
    for (;;) {
        try {
            const auto result = vestigium::exportLogs(options.root, checkpoints, send, report);
            if (result.rows != 0 || !options.watch) {
                std::cout << "rows=" << result.rows << " failed_files=" << result.failedFiles << '\n' << std::flush;
            }
            if (!options.watch) return result.failedFiles == 0 ? 0 : 1;
        } catch (const std::exception& error) {
            report({"scan_failed", options.root, error.what()});
            if (!options.watch) return 1;
        }
        std::this_thread::sleep_for(interval);
    }
}

}

int wmain(int argc, wchar_t** argv) {
    try {
        return run(parseOptions(argc, argv));
    } catch (const std::invalid_argument& error) {
        std::cerr << "[vestigium-sink] " << error.what() << '\n'
            << "Usage: vestigium-sink --url <origin> [--watch] [--logs-dir <path>]\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << "[vestigium-sink] " << error.what() << '\n';
        return 1;
    }
}
#endif
