#pragma once

#include <string>

namespace vestigium {
// Validate the destination and add the VictoriaLogs JSONL query settings.
std::string createInsertUrl(const std::string& origin);
// Send to the endpoint returned by createInsertUrl. Wait for the full successful response.
void sendBatch(const std::string& endpoint, std::string body);
}
