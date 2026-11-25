#include "timestamp.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cmath>
#include <format>
#include <string_view>

namespace vestigium {
namespace {

using namespace std::chrono;
constexpr auto maxEpoch = 8'640'000'000'000'000.0;

int decimal(std::string_view text) {
    if (text.empty() || text.find_first_not_of("0123456789") != std::string_view::npos) return -1;
    int result = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), result);
    return error == std::errc{} && end == text.data() + text.size() ? result : -1;
}

std::optional<minutes> zoneOffset(std::string_view zone) {
    if (zone == "Z") return minutes{0};
    if (zone.size() != 6 || zone[3] != ':' || (zone[0] != '+' && zone[0] != '-')) return {};
    const auto hour = decimal(zone.substr(1, 2));
    const auto minute = decimal(zone.substr(4, 2));
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return {};
    const auto total = hours{hour} + minutes{minute};
    return zone[0] == '-' ? -total : total;
}

std::optional<milliseconds> suffix(std::string_view text) {
    if (!text.starts_with('.')) {
        if (const auto zone = zoneOffset(text)) {
            return -*zone;
        }
        return {};
    }
    const auto fraction = text.substr(1);
    const auto end = fraction.find_first_not_of("0123456789");
    if (end == 0 || end == std::string_view::npos) return {};
    const auto zone = zoneOffset(fraction.substr(end));
    if (!zone) return {};
    const auto digits = fraction.substr(0, (std::min)(end, std::size_t{3}));
    constexpr int scale[] = {100, 10, 1};
    return milliseconds{decimal(digits) * scale[digits.size() - 1]} - *zone;
}

std::optional<sys_days> datePart(std::string_view text) {
    const auto yyyy = decimal(text.substr(0, 4));
    const auto mm = decimal(text.substr(5, 2));
    const auto dd = decimal(text.substr(8, 2));
    if (yyyy < 0 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return {};
    const auto first = sys_days{year{yyyy} / month{static_cast<unsigned>(mm)} / 1};
    return first + days{dd - 1};
}

std::optional<milliseconds> clockPart(std::string_view text) {
    const auto hh = decimal(text.substr(11, 2));
    const auto min = decimal(text.substr(14, 2));
    const auto sec = decimal(text.substr(17, 2));
    const auto sub = suffix(text.substr(19));
    if (hh < 0 || hh > 24 || min < 0 || min > 59 || sec < 0 || sec > 59 || !sub) return {};
    if (hh == 24 && (min != 0 || sec != 0 || sub->count() % 1000 != 0)) return {};
    return hours{hh} + minutes{min} + seconds{sec} + *sub;
}

std::optional<sys_time<milliseconds>> parseInstant(std::string_view text) {
    if (text.size() < 20 || text[4] != '-' || text[7] != '-' || text[10] != 'T'
        || text[13] != ':' || text[16] != ':') return {};
    const auto date = datePart(text);
    const auto clock = clockPart(text);
    if (!date || !clock) return {};
    return *date + *clock;
}

std::string printInstant(sys_time<milliseconds> time) {
    const auto date = floor<days>(time);
    const auto seconds = floor<std::chrono::seconds>(time);
    // chrono::year is limited to 16 bits. Reduce by complete Gregorian cycles first.
    constexpr auto cycle = days{146097};
    const auto cycles = date.time_since_epoch() / cycle;
    const year_month_day calendar{date - cycles * cycle};
    const auto yyyy = static_cast<int>(calendar.year()) + cycles * 400;
    const auto yearText = yyyy < 0 || yyyy > 9999 ? std::format("{:+07}", yyyy) : std::format("{:04}", yyyy);
    return std::format("{}-{:02}-{:02}T{:%T}.{:03}Z", yearText,
        static_cast<unsigned>(calendar.month()), static_cast<unsigned>(calendar.day()),
        hh_mm_ss{seconds - date}, (time - seconds).count());
}

}

std::optional<std::string> instant(const portus::Json& value) {
    if (value.is_string()) {
        if (const auto time = parseInstant(value.as_string())) {
            return printInstant(*time);
        }
    } else if (value.is_number()) {
        const auto ms = value.as_number();
        if (std::isfinite(ms) && std::abs(ms) <= maxEpoch) {
            return printInstant(sys_time<milliseconds>{milliseconds{static_cast<milliseconds::rep>(ms)}});
        }
    }
    return {};
}

}
