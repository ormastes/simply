cmake_minimum_required(VERSION 3.10)

project(HelloApp LANGUAGES C)

# Options
option(USE_GREETING "Enable custom greeting" ON)

# Compiler settings
set(CC clang)

# Messages
message(STATUS "Configuring ${PROJECT_NAME}...")
message(STATUS "Source dir: ${CMAKE_SOURCE_DIR}")

# Find system tools
find_program(CLANG_PATH clang)

# Build targets
add_executable(hello hello.c)

# If we had a library, link it
# add_library(greet STATIC greet.c)
# target_link_libraries(hello greet)
