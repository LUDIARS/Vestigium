#pragma once

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <system_error>

namespace vestigium {

// Preserve a Win32 failure code through C++ exception handling.
[[noreturn]] inline void failWindows(const char* operation, DWORD error = GetLastError()) {
    throw std::system_error(static_cast<int>(error), std::system_category(), operation);
}

// Own a Win32 file handle and close it during stack unwinding.
class WindowsHandle {
public:
    // Take ownership of an open handle or propagate the failure to open it.
    WindowsHandle(HANDLE handle, const char* operation) : handle_(handle) {
        if (handle_ == INVALID_HANDLE_VALUE) failWindows(operation);
    }
    ~WindowsHandle() { CloseHandle(handle_); }
    WindowsHandle(const WindowsHandle&) = delete;
    WindowsHandle& operator=(const WindowsHandle&) = delete;

    // Borrow the handle for the lifetime of this owner.
    [[nodiscard]] HANDLE get() const noexcept { return handle_; }

private:
    HANDLE handle_;
};

}
#endif
