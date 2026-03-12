cmake_minimum_required(VERSION 3.15)
project(SoulForgeSynth VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Windows : cible Vista+ pour compatibilité FL Studio ──────────────────────
if(WIN32)
    add_compile_definitions(
        _WIN32_WINNT=0x0601   # Windows 7+
        WINVER=0x0601
        NOMINMAX
    )
    # Force x64 dans FL Studio (Visual Studio uniquement)
    if(CMAKE_GENERATOR MATCHES "Visual Studio")
        set(CMAKE_GENERATOR_PLATFORM x64 CACHE STRING "" FORCE)
    endif()
endif()

# ── macOS : cible 10.13+ (High Sierra), arm64 + x86_64 (Apple Silicon) ───────
if(APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "" FORCE)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "" FORCE)
endif()

# ── JUCE ─────────────────────────────────────────────────────────────────────
# Cloner JUCE :
#   git clone https://github.com/juce-framework/JUCE.git external/JUCE
add_subdirectory(external/JUCE)

# ── Plugin ───────────────────────────────────────────────────────────────────
juce_add_plugin(SoulForgeSynth
    COMPANY_NAME                "SoulForge"
    COMPANY_WEBSITE             ""
    COMPANY_EMAIL               ""
    PLUGIN_MANUFACTURER_CODE    Sfgs     # 4 chars, unique
    PLUGIN_CODE                 Sfsy     # 4 chars, unique
    FORMATS                     VST3 Standalone
    PRODUCT_NAME                "SoulForge Synth"
    BUNDLE_ID                   "com.soulforge.synth"
    IS_SYNTH                    TRUE
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD     TRUE      # copie auto dans le dossier VST3 système
    VST3_CATEGORIES             "Instrument|Synth"
)

juce_generate_juce_header(SoulForgeSynth)

target_sources(SoulForgeSynth PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
)

target_compile_definitions(SoulForgeSynth PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0
    JUCE_DIRECT2D=0
    JUCE_USE_DIRECTWRITE=0
    JUCE_ACCESSIBILITY=0
)

# MinGW cross-compilation : autoriser les casts de pointeur non-stricts
if(MINGW OR CMAKE_CXX_COMPILER MATCHES "mingw")
    target_compile_options(SoulForgeSynth PRIVATE -fpermissive -Wno-error)
endif()

target_link_libraries(SoulForgeSynth
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# Windows system libraries needed for llvm-mingw cross-compilation
if(WIN32 AND CMAKE_CXX_COMPILER MATCHES "clang")
    target_link_libraries(SoulForgeSynth PRIVATE
        -lversion -lws2_32 -ldbghelp -lwinmm -lshlwapi
        -lole32 -loleaut32 -luser32 -lkernel32 -lgdi32
        -ladvapi32 -lshell32 -luuid -lcomctl32 -lcomdlg32
        -limm32 -ldinput8 -ldxguid -ld3d9
        -lwininet -ldwmapi -ldcomp -ldxgi -ld2d1 -ld3d11
        -lksuser -lmfplat -lmf -lmfuuid -lsapi
    )
endif()
