cmake_minimum_required(VERSION 3.20)
project(simple_external_compression_bridge C)

option(SIMPLE_ZLIB_FETCH "Fetch zlib during configure instead of using a system package" ON)

if(SIMPLE_ZLIB_FETCH)
  include(FetchContent)
  set(ZLIB_BUILD_TESTING OFF CACHE BOOL "" FORCE)
  set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
  FetchContent_Declare(
    zlib
    URL https://github.com/madler/zlib/archive/refs/tags/v1.3.1.tar.gz
  )
  FetchContent_MakeAvailable(zlib)
else()
  find_package(ZLIB REQUIRED)
endif()

if(TARGET ZLIB::ZLIB)
  set(SIMPLE_ZLIB_TARGET ZLIB::ZLIB)
elseif(TARGET zlibstatic)
  set(SIMPLE_ZLIB_TARGET zlibstatic)
elseif(TARGET zlib)
  set(SIMPLE_ZLIB_TARGET zlib)
else()
  message(FATAL_ERROR "Could not resolve a zlib target after configure")
endif()

add_library(simple_zlib_bridge SHARED src/simple_zlib_bridge.c)
target_link_libraries(simple_zlib_bridge PRIVATE ${SIMPLE_ZLIB_TARGET})
target_include_directories(simple_zlib_bridge PRIVATE ${zlib_SOURCE_DIR} ${zlib_BINARY_DIR})
set_target_properties(simple_zlib_bridge PROPERTIES OUTPUT_NAME simple_zlib_bridge)
