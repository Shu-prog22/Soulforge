cmake_minimum_required(VERSION 3.15)
project(SoulForgeSynth VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(VST3SDK "${CMAKE_SOURCE_DIR}/../vst3sdk")

include_directories(
    "${VST3SDK}"
    "${VST3SDK}/pluginterfaces"
    "${VST3SDK}/public.sdk"
)

# ── SDK sources needed ────────────────────────────────────────────────────────
set(SDK_SRCS
    "${VST3SDK}/base/source/baseiids.cpp"
    "${VST3SDK}/base/source/fobject.cpp"
    "${VST3SDK}/base/source/fbuffer.cpp"
    "${VST3SDK}/base/source/fdebug.cpp"
    "${VST3SDK}/base/source/fstreamer.cpp"
    "${VST3SDK}/base/source/fstring.cpp"
    "${VST3SDK}/base/source/timer.cpp"
    "${VST3SDK}/base/source/updatehandler.cpp"
    "${VST3SDK}/base/thread/source/fcondition.cpp"
    "${VST3SDK}/base/thread/source/flock.cpp"
    "${VST3SDK}/pluginterfaces/base/coreiids.cpp"
    "${VST3SDK}/pluginterfaces/base/funknown.cpp"
    "${VST3SDK}/public.sdk/source/main/pluginfactory.cpp"
    "${VST3SDK}/public.sdk/source/main/dllmain.cpp"
    "${VST3SDK}/public.sdk/source/main/moduleinit.cpp"
    "${VST3SDK}/public.sdk/source/common/pluginview.cpp"
    "${VST3SDK}/public.sdk/source/common/commoniids.cpp"
    "${VST3SDK}/pluginterfaces/base/ustring.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstaudioeffect.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstbus.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstcomponent.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstcomponentbase.cpp"
    "${VST3SDK}/public.sdk/source/vst/vsteditcontroller.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstinitiids.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstnoteexpressiontypes.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstparameters.cpp"
    "${VST3SDK}/public.sdk/source/vst/vstpresetfile.cpp"
)

# Filter to only existing files
set(SDK_SRCS_FOUND)
foreach(f ${SDK_SRCS})
    if(EXISTS "${f}")
        list(APPEND SDK_SRCS_FOUND "${f}")
    endif()
endforeach()

add_library(SoulForgeSynth MODULE
    SoulForgeSynth.cpp
    ${SDK_SRCS_FOUND}
)

target_compile_definitions(SoulForgeSynth PRIVATE
    WIN32
    _WIN32_WINNT=0x0601
    WINVER=0x0601
    NOMINMAX
    _CRT_SECURE_NO_WARNINGS
    NDEBUG
    RELEASE
    WINDOWS
)

set_target_properties(SoulForgeSynth PROPERTIES
    PREFIX ""
    SUFFIX ".vst3"
    OUTPUT_NAME "SoulForgeSynth"
)

target_link_libraries(SoulForgeSynth PRIVATE ole32 uuid)
