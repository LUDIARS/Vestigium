#pragma once

#include "augur/contract_runtime.hpp"

#include <string>

namespace contracts {
inline const auto insert_url_checks = augur::predicates(
    [](const std::string&) { return true; },
    [](const std::string& url, const std::string&) {
        return (url.starts_with("https://") || url.starts_with("http://"))
            && url.ends_with("/insert/jsonline?_time_field=_time&_msg_field=_msg&_stream_fields=service%2Ckind")
            && url.find('@') == std::string::npos;
    });
}
