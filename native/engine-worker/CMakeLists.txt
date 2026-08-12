cmake_minimum_required(VERSION 3.24)
project(frameos-engine-worker VERSION 0.1.0 LANGUAGES CXX)

include(CTest)
include(GNUInstallDirs)

option(FRAMEOS_WITH_MLT "Build with dynamically linked MLT/MLT++ support" OFF)

add_executable(frameos-engine-worker src/main.cpp)
target_compile_features(frameos-engine-worker PRIVATE cxx_std_20)
target_compile_definitions(frameos-engine-worker PRIVATE FRAMEOS_WORKER_VERSION="${PROJECT_VERSION}")

if(MSVC)
  target_compile_options(frameos-engine-worker PRIVATE /W4 /permissive- /EHsc)
else()
  target_compile_options(frameos-engine-worker PRIVATE -Wall -Wextra -Wpedantic -Wconversion)
endif()

if(FRAMEOS_WITH_MLT)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(MLT REQUIRED IMPORTED_TARGET mlt++-7)
  target_link_libraries(frameos-engine-worker PRIVATE PkgConfig::MLT)
  target_compile_definitions(frameos-engine-worker PRIVATE FRAMEOS_WITH_MLT=1)
endif()

install(TARGETS frameos-engine-worker RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(
  FILES
    "${CMAKE_CURRENT_SOURCE_DIR}/../../LICENSE"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../third-party/distribution-allowlist.yml"
  DESTINATION share/frameos
)

if(BUILD_TESTING)
  add_test(NAME worker-health COMMAND $<TARGET_FILE:frameos-engine-worker> health)
  set_tests_properties(
    worker-health
    PROPERTIES PASS_REGULAR_EXPRESSION "\"status\":\"ok\""
  )
  add_test(
    NAME worker-capability-contract
    COMMAND $<TARGET_FILE:frameos-engine-worker> capabilities
  )
  set_tests_properties(
    worker-capability-contract
    PROPERTIES PASS_REGULAR_EXPRESSION "\"id\":\"engine.mlt\""
  )
  add_test(
    NAME worker-proxy-capability
    COMMAND $<TARGET_FILE:frameos-engine-worker> capabilities
  )
  set_tests_properties(
    worker-proxy-capability
    PROPERTIES PASS_REGULAR_EXPRESSION "\"id\":\"asset.proxy.create\""
  )
  add_test(
    NAME worker-thumbnail-capability
    COMMAND $<TARGET_FILE:frameos-engine-worker> capabilities
  )
  set_tests_properties(
    worker-thumbnail-capability
    PROPERTIES PASS_REGULAR_EXPRESSION "\"id\":\"asset.thumbnail.create\""
  )
  add_test(
    NAME worker-waveform
    COMMAND $<TARGET_FILE:frameos-engine-worker> waveform-self-test
  )
  set_tests_properties(
    worker-waveform
    PROPERTIES PASS_REGULAR_EXPRESSION "\"status\":\"completed\""
  )
endif()

set(CPACK_PACKAGE_NAME "frameos-engine-worker")
set(CPACK_PACKAGE_VENDOR "FrameOS")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Isolated FrameOS MLT media worker")
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/../../LICENSE")
set(
  CPACK_PACKAGE_FILE_NAME
  "frameos-engine-worker-${PROJECT_VERSION}-${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}"
)
if(WIN32)
  set(CPACK_GENERATOR "ZIP")
else()
  set(CPACK_GENERATOR "TGZ")
endif()
include(CPack)
