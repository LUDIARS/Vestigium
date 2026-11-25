#pragma once

#include <string>

namespace vestigium {
// Validate the destination and add the VictoriaLogs JSONL query settings.
std::string createInsertUrl(const std::string& origin);
// Return only after Portus reads a successful response in full.
void sendBatch(const std::string& origin, std::string body);
}
