cmake_minimum_required(VERSION 4.2)
project(VestigiumSink LANGUAGES CXX)

find_package(Lorica 0.1 CONFIG REQUIRED)
set(PORTUS_SOURCE_DIR "" CACHE PATH "Provisioned Portus cpp source directory")
if(NOT TARGET portus::portus)
    if(NOT EXISTS "${PORTUS_SOURCE_DIR}/CMakeLists.txt")
        message(FATAL_ERROR "Set PORTUS_SOURCE_DIR to the provisioned Portus cpp directory")
    endif()
    set(PORTUS_BUILD_TESTS OFF)
    set(PORTUS_BUILD_EXAMPLES OFF)
    add_subdirectory("${PORTUS_SOURCE_DIR}" portus)
    lorica_harden_target(portus)
endif()

add_library(vestigium_sink_core STATIC
    src/batch.cpp
    src/checkpoint_key.cpp
    src/record.cpp
    src/sources.cpp
    src/timestamp.cpp
    src/victoria_http.cpp)
target_include_directories(vestigium_sink_core PUBLIC include)
target_compile_features(vestigium_sink_core PUBLIC cxx_std_23)
set_target_properties(vestigium_sink_core PROPERTIES CXX_EXTENSIONS OFF)
target_link_libraries(vestigium_sink_core PUBLIC portus::portus PRIVATE Lorica::boundary)
lorica_harden_target(vestigium_sink_core)

include(CTest)
if(BUILD_TESTING)
    add_executable(vestigium_sink_tests tests/sink_test.cpp)
    target_link_libraries(vestigium_sink_tests PRIVATE vestigium_sink_core)
    lorica_harden_target(vestigium_sink_tests)
    add_test(NAME vestigium_sink_tests COMMAND vestigium_sink_tests)
endif()
