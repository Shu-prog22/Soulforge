/*
 * SoulForge Synth — VST3 for Windows (MinGW cross-compile from Linux)
 * Split Processor + Controller approach (avoids vstsinglecomponenteffect macro clash)
 */

#define _USE_MATH_DEFINES
#include <cmath>
#include <cstring>
#include <algorithm>
#include <atomic>
#ifndef M_PI
# define M_PI 3.14159265358979323846
#endif

// ── VST3 SDK ──────────────────────────────────────────────────────────────────
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/vsttypes.h"
#include "pluginterfaces/base/ustring.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "base/source/fstreamer.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

// ── Plugin UIDs ───────────────────────────────────────────────────────────────
static const FUID kProcessorUID(0x12345678u, 0xABCD1234u, 0x9ABCDEF0u, 0x11223344u);
static const FUID kControllerUID(0x87654321u, 0x4321DCBAu, 0x0FEDCBAu, 0x44332211u);

// ── Preset definitions ────────────────────────────────────────────────────────
enum EngineType : int32 { ENG_LEGACY=0,ENG_SCIFI,ENG_VIKINGS,ENG_GYM,ENG_BASS808,ENG_VAPOR,ENG_HORROR,
                          ENG_SAMURAI,ENG_CHERNOBYL,ENG_PIRATES,ENG_TRIBAL,ENG_GUITAR,ENG_BAGPIPES,ENG_EP };

struct PresetDef {
    const char* id, *name, *folder;
    EngineType  engine;
    float atk,rel,p0,p1,p2,p3,p4;
    int legacyType;
};

static const PresetDef BANK[] = {
    // SCIFI  p0=modRatio p1=modIndex p2=lfoFreq p3=lpQ p4=lfoDepth
    {"sf01","LAZER",   "SCIFI",ENG_SCIFI,0.01f,0.8f, 4.f,6.f,1.f,5.f,4.f,0},
    {"sf02","PULSAR",  "SCIFI",ENG_SCIFI,0.01f,1.2f, 3.f,5.f,0.5f,4.f,3.f,0},
    {"sf03","BEAM",    "SCIFI",ENG_SCIFI,0.01f,0.5f, 6.f,8.f,2.f,6.f,5.f,0},
    {"sf04","REACTOR", "SCIFI",ENG_SCIFI,0.02f,1.5f, 2.f,9.f,0.3f,3.f,6.f,0},
    {"sf05","WARP",    "SCIFI",ENG_SCIFI,0.01f,0.7f, 5.f,7.f,1.5f,8.f,3.f,0},
    {"sf06","PLASMA",  "SCIFI",ENG_SCIFI,0.01f,1.0f, 7.f,5.f,0.8f,5.f,4.f,0},
    {"sf07","DRONEPAD","SCIFI",ENG_SCIFI,0.05f,2.0f, 1.5f,12.f,0.2f,2.f,8.f,0},
    {"sf08","SIGNAL",  "SCIFI",ENG_SCIFI,0.01f,0.4f, 8.f,4.f,3.f,7.f,2.f,0},
    {"sf09","PROBE",   "SCIFI",ENG_SCIFI,0.01f,0.9f, 3.5f,6.f,1.f,5.f,5.f,0},
    {"sf10","ORBIT",   "SCIFI",ENG_SCIFI,0.02f,1.8f, 2.5f,8.f,0.4f,4.f,7.f,0},
    {"sf11","SCAN",    "SCIFI",ENG_SCIFI,0.01f,0.6f, 5.5f,5.f,2.f,6.f,3.f,0},
    {"sf12","TACHYON", "SCIFI",ENG_SCIFI,0.01f,0.3f, 9.f,3.f,4.f,8.f,2.f,0},
    {"sf13","NEBULA",  "SCIFI",ENG_SCIFI,0.08f,3.0f, 1.f,15.f,0.1f,2.f,10.f,0},
    {"sf14","QUASAR",  "SCIFI",ENG_SCIFI,0.01f,1.1f, 4.5f,7.f,1.2f,5.f,4.f,0},
    {"sf15","MATRIX",  "SCIFI",ENG_SCIFI,0.01f,0.5f, 6.5f,6.f,2.5f,7.f,3.f,0},
    {"sf16","FLUX",    "SCIFI",ENG_SCIFI,0.01f,0.7f, 3.f,7.f,1.5f,4.f,5.f,0},
    {"sf17","NOVA",    "SCIFI",ENG_SCIFI,0.02f,1.4f, 2.f,10.f,0.5f,3.f,6.f,0},
    {"sf18","RIFT",    "SCIFI",ENG_SCIFI,0.01f,0.8f, 7.5f,5.f,2.f,6.f,4.f,0},
    {"sf19","VECTOR",  "SCIFI",ENG_SCIFI,0.01f,0.4f, 10.f,4.f,3.f,9.f,2.f,0},
    {"sf20","GRID",    "SCIFI",ENG_SCIFI,0.01f,0.6f, 5.f,6.f,1.8f,6.f,3.f,0},
    {"sf21","PORTAL",  "SCIFI",ENG_SCIFI,0.03f,2.0f, 1.5f,14.f,0.3f,2.f,9.f,0},
    {"sf22","CRYSTAL", "SCIFI",ENG_SCIFI,0.01f,0.5f, 8.5f,4.f,3.5f,8.f,2.f,0},
    {"sf23","ECHO_FM", "SCIFI",ENG_SCIFI,0.02f,1.6f, 3.5f,8.f,0.8f,4.f,6.f,0},
    {"sf24","HOLO",    "SCIFI",ENG_SCIFI,0.01f,0.7f, 6.f,5.f,2.f,5.f,4.f,0},
    {"sf25","GLITCH",  "SCIFI",ENG_SCIFI,0.01f,0.3f, 11.f,3.f,5.f,10.f,2.f,0},
    // VIKINGS  p0=detuneCents p1=subGain p2=lpHz p3=sat p4=numOscs
    {"vk01","SHIELD",   "VIKINGS",ENG_VIKINGS,0.02f,1.0f,15.f,0.4f,400.f,0.6f,3.f,0},
    {"vk02","HORN",     "VIKINGS",ENG_VIKINGS,0.01f,0.8f,10.f,0.3f,600.f,0.5f,2.f,0},
    {"vk03","RAID",     "VIKINGS",ENG_VIKINGS,0.01f,0.5f,20.f,0.5f,300.f,0.7f,3.f,0},
    {"vk04","FORGE",    "VIKINGS",ENG_VIKINGS,0.03f,1.5f,8.f,0.6f,200.f,0.8f,3.f,0},
    {"vk05","SAGA",     "VIKINGS",ENG_VIKINGS,0.05f,2.0f,5.f,0.2f,800.f,0.4f,2.f,0},
    {"vk06","THUNDER",  "VIKINGS",ENG_VIKINGS,0.01f,0.7f,25.f,0.6f,250.f,0.9f,3.f,0},
    {"vk07","ODIN",     "VIKINGS",ENG_VIKINGS,0.04f,1.8f,12.f,0.5f,350.f,0.7f,3.f,0},
    {"vk08","MJOLNIR",  "VIKINGS",ENG_VIKINGS,0.01f,0.4f,30.f,0.7f,180.f,1.0f,2.f,0},
    {"vk09","VALHALLA", "VIKINGS",ENG_VIKINGS,0.08f,3.0f,6.f,0.3f,700.f,0.3f,3.f,0},
    {"vk10","RUNE",     "VIKINGS",ENG_VIKINGS,0.02f,1.2f,18.f,0.4f,450.f,0.6f,2.f,0},
    {"vk11","AXEMAN",   "VIKINGS",ENG_VIKINGS,0.01f,0.6f,22.f,0.6f,280.f,0.8f,3.f,0},
    {"vk12","BERSERKER","VIKINGS",ENG_VIKINGS,0.01f,0.3f,35.f,0.8f,150.f,1.2f,2.f,0},
    {"vk13","LONGSHIP", "VIKINGS",ENG_VIKINGS,0.03f,1.6f,9.f,0.4f,500.f,0.5f,3.f,0},
    {"vk14","YMIR",     "VIKINGS",ENG_VIKINGS,0.06f,2.5f,4.f,0.2f,900.f,0.3f,2.f,0},
    {"vk15","SKOLL",    "VIKINGS",ENG_VIKINGS,0.01f,0.7f,16.f,0.5f,380.f,0.7f,3.f,0},
    {"vk16","FENRIR",   "VIKINGS",ENG_VIKINGS,0.01f,0.5f,28.f,0.7f,200.f,1.0f,3.f,0},
    {"vk17","ASGARD",   "VIKINGS",ENG_VIKINGS,0.05f,2.2f,7.f,0.3f,650.f,0.4f,2.f,0},
    {"vk18","LOKI",     "VIKINGS",ENG_VIKINGS,0.02f,1.0f,14.f,0.4f,420.f,0.6f,2.f,0},
    {"vk19","BIFROST",  "VIKINGS",ENG_VIKINGS,0.04f,1.8f,11.f,0.3f,750.f,0.4f,3.f,0},
    {"vk20","EINHERJAR","VIKINGS",ENG_VIKINGS,0.01f,0.6f,23.f,0.6f,260.f,0.9f,3.f,0},
    {"vk21","NORNS",    "VIKINGS",ENG_VIKINGS,0.07f,3.0f,5.f,0.2f,850.f,0.3f,2.f,0},
    {"vk22","FREYJA",   "VIKINGS",ENG_VIKINGS,0.03f,1.4f,10.f,0.4f,480.f,0.5f,2.f,0},
    {"vk23","VOLSUNG",  "VIKINGS",ENG_VIKINGS,0.01f,0.5f,26.f,0.7f,220.f,0.9f,3.f,0},
    {"vk24","HRUNGNIR", "VIKINGS",ENG_VIKINGS,0.01f,0.4f,32.f,0.8f,160.f,1.1f,2.f,0},
    {"vk25","RAGNAROK", "VIKINGS",ENG_VIKINGS,0.01f,0.3f,40.f,1.0f,120.f,1.5f,3.f,0},
    // GYM  p0=wave(0=sq,1=saw) p1=clipAmt p2=boostHz p3=boostDB p4=subMix
    {"gy01","PUMP",    "GYM",ENG_GYM,0.01f,0.5f,0.f,0.6f,200.f,8.f,0.3f,0},
    {"gy02","FLEX",    "GYM",ENG_GYM,0.01f,0.4f,1.f,0.7f,180.f,10.f,0.4f,0},
    {"gy03","LIFT",    "GYM",ENG_GYM,0.01f,0.6f,0.f,0.5f,250.f,6.f,0.2f,0},
    {"gy04","BEAST",   "GYM",ENG_GYM,0.01f,0.3f,1.f,0.9f,150.f,12.f,0.5f,0},
    {"gy05","IRON",    "GYM",ENG_GYM,0.02f,0.7f,0.f,0.6f,300.f,8.f,0.3f,0},
    {"gy06","HUSTLE",  "GYM",ENG_GYM,0.01f,0.5f,1.f,0.8f,170.f,10.f,0.4f,0},
    {"gy07","GRIND",   "GYM",ENG_GYM,0.01f,0.4f,0.f,0.7f,220.f,9.f,0.35f,0},
    {"gy08","RIPPED",  "GYM",ENG_GYM,0.01f,0.3f,1.f,1.0f,140.f,14.f,0.5f,0},
    {"gy09","ALPHA",   "GYM",ENG_GYM,0.02f,0.6f,0.f,0.6f,280.f,7.f,0.25f,0},
    {"gy10","CRUNCH",  "GYM",ENG_GYM,0.01f,0.4f,1.f,0.75f,160.f,11.f,0.4f,0},
    {"gy11","GAINS",   "GYM",ENG_GYM,0.01f,0.5f,0.f,0.65f,240.f,8.f,0.3f,0},
    {"gy12","SHRED",   "GYM",ENG_GYM,0.01f,0.3f,1.f,0.85f,145.f,13.f,0.5f,0},
    {"gy13","POWER",   "GYM",ENG_GYM,0.01f,0.4f,0.f,0.8f,200.f,10.f,0.4f,0},
    {"gy14","BULK",    "GYM",ENG_GYM,0.02f,0.8f,1.f,0.55f,350.f,6.f,0.2f,0},
    {"gy15","HYPE",    "GYM",ENG_GYM,0.01f,0.4f,0.f,0.7f,210.f,9.f,0.35f,0},
    {"gy16","ZONE",    "GYM",ENG_GYM,0.01f,0.5f,1.f,0.65f,175.f,10.f,0.4f,0},
    {"gy17","PUSH",    "GYM",ENG_GYM,0.01f,0.4f,0.f,0.75f,230.f,8.f,0.3f,0},
    {"gy18","MAX",     "GYM",ENG_GYM,0.01f,0.3f,1.f,0.9f,155.f,12.f,0.5f,0},
    {"gy19","FUEL",    "GYM",ENG_GYM,0.02f,0.6f,0.f,0.6f,260.f,7.f,0.25f,0},
    {"gy20","SWEAT",   "GYM",ENG_GYM,0.01f,0.5f,1.f,0.7f,185.f,9.f,0.4f,0},
    {"gy21","RAGE",    "GYM",ENG_GYM,0.01f,0.3f,0.f,0.85f,170.f,11.f,0.45f,0},
    {"gy22","BOSS",    "GYM",ENG_GYM,0.01f,0.4f,1.f,0.8f,165.f,12.f,0.5f,0},
    {"gy23","GRIDIRON","GYM",ENG_GYM,0.01f,0.5f,0.f,0.7f,205.f,9.f,0.35f,0},
    {"gy24","SPRINT",  "GYM",ENG_GYM,0.01f,0.4f,1.f,0.65f,190.f,10.f,0.4f,0},
    {"gy25","CHAMP",   "GYM",ENG_GYM,0.01f,0.3f,0.f,1.0f,145.f,15.f,0.6f,0},
    // BASS808  p0=slideFrom(semi) p1=slideDur(s) p2=dist p3=unused p4=subMix
    {"b801","CLASSIC808","808",ENG_BASS808,0.005f,1.5f,7.f,0.08f,0.7f,0.f,0.3f,0},
    {"b802","TRAP808",   "808",ENG_BASS808,0.005f,2.0f,5.f,0.12f,0.8f,0.f,0.4f,0},
    {"b803","THUD",      "808",ENG_BASS808,0.005f,0.8f,3.f,0.05f,0.5f,0.f,0.2f,0},
    {"b804","BOOM",      "808",ENG_BASS808,0.005f,2.5f,9.f,0.15f,0.9f,0.f,0.5f,0},
    {"b805","SLIDE808",  "808",ENG_BASS808,0.005f,1.8f,6.f,0.10f,0.75f,0.f,0.35f,0},
    {"b806","SUB808",    "808",ENG_BASS808,0.005f,3.0f,4.f,0.06f,0.6f,0.f,0.4f,0},
    {"b807","BOUNCE",    "808",ENG_BASS808,0.005f,1.2f,8.f,0.09f,0.65f,0.f,0.3f,0},
    {"b808","DEEP808",   "808",ENG_BASS808,0.005f,2.2f,12.f,0.18f,0.85f,0.f,0.5f,0},
    {"b809","WOBBLY",    "808",ENG_BASS808,0.005f,1.6f,7.f,0.11f,0.8f,0.f,0.45f,0},
    {"b810","PUNCHY",    "808",ENG_BASS808,0.005f,1.0f,4.f,0.07f,0.55f,0.f,0.25f,0},
    {"b811","LONG808",   "808",ENG_BASS808,0.005f,3.5f,10.f,0.20f,0.9f,0.f,0.5f,0},
    {"b812","SHORT808",  "808",ENG_BASS808,0.005f,0.6f,2.f,0.04f,0.4f,0.f,0.2f,0},
    {"b813","DARK808",   "808",ENG_BASS808,0.005f,2.0f,5.f,0.08f,0.7f,0.f,0.6f,0},
    {"b814","BRIGHT808", "808",ENG_BASS808,0.005f,1.4f,8.f,0.06f,0.5f,0.f,0.15f,0},
    {"b815","SOFT808",   "808",ENG_BASS808,0.005f,1.8f,6.f,0.08f,0.55f,0.f,0.3f,0},
    {"b816","HARD808",   "808",ENG_BASS808,0.005f,1.2f,7.f,0.14f,0.9f,0.f,0.4f,0},
    {"b817","FAT808",    "808",ENG_BASS808,0.005f,2.5f,11.f,0.16f,0.85f,0.f,0.5f,0},
    {"b818","THIN808",   "808",ENG_BASS808,0.005f,1.0f,3.f,0.05f,0.45f,0.f,0.2f,0},
    {"b819","MELLOW808", "808",ENG_BASS808,0.005f,2.2f,4.f,0.07f,0.6f,0.f,0.35f,0},
    {"b820","HYPER808",  "808",ENG_BASS808,0.005f,1.5f,9.f,0.13f,0.8f,0.f,0.4f,0},
    {"b821","WAVE808",   "808",ENG_BASS808,0.005f,1.8f,6.f,0.10f,0.7f,0.f,0.35f,0},
    {"b822","STOMP808",  "808",ENG_BASS808,0.005f,0.9f,5.f,0.09f,0.65f,0.f,0.3f,0},
    {"b823","FLUTTER808","808",ENG_BASS808,0.005f,2.0f,7.f,0.11f,0.75f,0.f,0.4f,0},
    {"b824","STAB808",   "808",ENG_BASS808,0.005f,0.7f,4.f,0.08f,0.5f,0.f,0.25f,0},
    {"b825","ULTRA808",  "808",ENG_BASS808,0.005f,2.5f,13.f,0.22f,0.95f,0.f,0.55f,0},
    // VAPOR  p0=detuneCents p1=lpStart p2=lpEnd p3=sweepTime p4=vibRate
    {"vp01","DRIFT",   "VAPOR",ENG_VAPOR,0.08f,2.5f,10.f,800.f,4000.f,3.f,0.5f,0},
    {"vp02","FLOAT",   "VAPOR",ENG_VAPOR,0.06f,3.0f,8.f,600.f,3500.f,4.f,0.3f,0},
    {"vp03","HAZE",    "VAPOR",ENG_VAPOR,0.10f,4.0f,12.f,500.f,3000.f,5.f,0.4f,0},
    {"vp04","GLIDE",   "VAPOR",ENG_VAPOR,0.07f,2.8f,7.f,900.f,4500.f,3.f,0.6f,0},
    {"vp05","WAVE_VP", "VAPOR",ENG_VAPOR,0.09f,3.5f,9.f,700.f,3800.f,4.f,0.5f,0},
    {"vp06","MIST",    "VAPOR",ENG_VAPOR,0.12f,5.0f,6.f,400.f,2500.f,6.f,0.3f,0},
    {"vp07","BLOOM",   "VAPOR",ENG_VAPOR,0.06f,2.5f,11.f,800.f,4200.f,3.f,0.7f,0},
    {"vp08","PETAL",   "VAPOR",ENG_VAPOR,0.05f,3.0f,5.f,1000.f,5000.f,2.f,0.8f,0},
    {"vp09","SHEEN",   "VAPOR",ENG_VAPOR,0.08f,3.5f,8.f,650.f,3600.f,4.f,0.5f,0},
    {"vp10","SILK",    "VAPOR",ENG_VAPOR,0.07f,4.0f,6.f,750.f,4100.f,3.f,0.4f,0},
    {"vp11","ROSE",    "VAPOR",ENG_VAPOR,0.09f,3.0f,10.f,600.f,3400.f,5.f,0.6f,0},
    {"vp12","MALL",    "VAPOR",ENG_VAPOR,0.10f,4.5f,7.f,500.f,2800.f,6.f,0.4f,0},
    {"vp13","SLOW",    "VAPOR",ENG_VAPOR,0.15f,6.0f,5.f,400.f,2200.f,7.f,0.2f,0},
    {"vp14","PASTEL",  "VAPOR",ENG_VAPOR,0.07f,3.2f,9.f,700.f,3700.f,4.f,0.5f,0},
    {"vp15","LOFI",    "VAPOR",ENG_VAPOR,0.08f,3.8f,8.f,600.f,3200.f,5.f,0.3f,0},
    {"vp16","NEON",    "VAPOR",ENG_VAPOR,0.06f,2.8f,12.f,900.f,4800.f,3.f,0.7f,0},
    {"vp17","CASSETTE","VAPOR",ENG_VAPOR,0.09f,4.2f,7.f,550.f,3000.f,5.f,0.4f,0},
    {"vp18","POOL",    "VAPOR",ENG_VAPOR,0.11f,5.0f,6.f,450.f,2600.f,6.f,0.3f,0},
    {"vp19","CRUISE",  "VAPOR",ENG_VAPOR,0.07f,3.5f,9.f,720.f,3900.f,4.f,0.6f,0},
    {"vp20","CITY",    "VAPOR",ENG_VAPOR,0.06f,2.5f,11.f,850.f,4300.f,3.f,0.8f,0},
    {"vp21","PINK",    "VAPOR",ENG_VAPOR,0.08f,3.0f,8.f,680.f,3600.f,4.f,0.5f,0},
    {"vp22","CHROME",  "VAPOR",ENG_VAPOR,0.07f,3.5f,10.f,600.f,3400.f,4.f,0.4f,0},
    {"vp23","VINTAGE", "VAPOR",ENG_VAPOR,0.10f,4.5f,7.f,500.f,2900.f,6.f,0.3f,0},
    {"vp24","FOREVER", "VAPOR",ENG_VAPOR,0.12f,6.0f,5.f,350.f,2000.f,8.f,0.2f,0},
    {"vp25","DREAM_V", "VAPOR",ENG_VAPOR,0.08f,4.0f,9.f,650.f,3700.f,5.f,0.5f,0},
    // HORROR  p0=modRatio p1=driftAmt p2=lpHz p3=lpQ p4=bitSteps
    {"ho01","STALK",   "HORROR",ENG_HORROR,0.01f,2.0f,1.010f,5.f,400.f,8.f,16.f,0},
    {"ho02","LURK",    "HORROR",ENG_HORROR,0.02f,3.0f,1.007f,8.f,300.f,10.f,8.f,0},
    {"ho03","CRAWL",   "HORROR",ENG_HORROR,0.01f,1.5f,1.015f,4.f,500.f,6.f,32.f,0},
    {"ho04","DREAD",   "HORROR",ENG_HORROR,0.03f,4.0f,1.005f,12.f,250.f,12.f,8.f,0},
    {"ho05","CREAK",   "HORROR",ENG_HORROR,0.01f,1.0f,1.020f,3.f,600.f,5.f,64.f,0},
    {"ho06","SHADOW",  "HORROR",ENG_HORROR,0.02f,2.5f,1.012f,6.f,350.f,9.f,16.f,0},
    {"ho07","WHISPER", "HORROR",ENG_HORROR,0.04f,5.0f,1.003f,15.f,200.f,14.f,4.f,0},
    {"ho08","MOAN",    "HORROR",ENG_HORROR,0.01f,2.0f,1.018f,5.f,450.f,7.f,16.f,0},
    {"ho09","WAIL",    "HORROR",ENG_HORROR,0.01f,3.5f,1.009f,10.f,280.f,11.f,8.f,0},
    {"ho10","SHIVER",  "HORROR",ENG_HORROR,0.02f,2.0f,1.013f,5.f,400.f,8.f,32.f,0},
    {"ho11","CHILL",   "HORROR",ENG_HORROR,0.03f,3.0f,1.006f,9.f,320.f,10.f,8.f,0},
    {"ho12","HAUNT",   "HORROR",ENG_HORROR,0.02f,4.0f,1.004f,14.f,220.f,13.f,4.f,0},
    {"ho13","DECAY",   "HORROR",ENG_HORROR,0.01f,2.5f,1.016f,5.f,380.f,8.f,16.f,0},
    {"ho14","INFEST",  "HORROR",ENG_HORROR,0.01f,1.5f,1.022f,4.f,550.f,6.f,64.f,0},
    {"ho15","RITUAL",  "HORROR",ENG_HORROR,0.03f,3.5f,1.008f,10.f,270.f,11.f,8.f,0},
    {"ho16","TOMB",    "HORROR",ENG_HORROR,0.04f,5.0f,1.003f,16.f,180.f,15.f,4.f,0},
    {"ho17","VOID",    "HORROR",ENG_HORROR,0.01f,2.0f,1.011f,6.f,420.f,8.f,16.f,0},
    {"ho18","SPECTER", "HORROR",ENG_HORROR,0.02f,3.0f,1.007f,9.f,300.f,10.f,8.f,0},
    {"ho19","ABYSS",   "HORROR",ENG_HORROR,0.04f,6.0f,1.002f,18.f,160.f,16.f,4.f,0},
    {"ho20","GLOOM",   "HORROR",ENG_HORROR,0.03f,4.0f,1.005f,12.f,240.f,12.f,8.f,0},
    {"ho21","SHRIEK",  "HORROR",ENG_HORROR,0.01f,0.8f,1.025f,3.f,700.f,5.f,128.f,0},
    {"ho22","TORMENT", "HORROR",ENG_HORROR,0.02f,3.5f,1.009f,10.f,290.f,11.f,8.f,0},
    {"ho23","CURSE",   "HORROR",ENG_HORROR,0.03f,4.5f,1.004f,14.f,210.f,13.f,4.f,0},
    {"ho24","OMEN",    "HORROR",ENG_HORROR,0.02f,2.8f,1.010f,7.f,360.f,9.f,16.f,0},
    {"ho25","OBLIVION","HORROR",ENG_HORROR,0.04f,7.0f,1.001f,20.f,140.f,18.f,2.f,0},
    // Legacy PADS
    {"pad_space", "SPACE", "PADS",ENG_LEGACY,0.12f,3.0f,0,0,0,0,0,0},
    {"pad_choir", "CHOIR", "PADS",ENG_LEGACY,0.10f,2.5f,0,0,0,0,0,0},
    {"pad_breath","BREATH","PADS",ENG_LEGACY,0.08f,2.0f,0,0,0,0,0,0},
    {"pad_dream", "DREAM", "PADS",ENG_LEGACY,0.09f,2.5f,0,0,0,0,0,0},
    {"pad_glass", "GLASS", "PADS",ENG_LEGACY,0.05f,1.5f,0,0,0,0,0,0},
    // Legacy BASS
    {"bass_deep","DEEP","BASS",ENG_LEGACY,0.01f,0.5f,0,0,0,0,0,1},
    {"bass_stab","STAB","BASS",ENG_LEGACY,0.01f,0.3f,0,0,0,0,0,1},
    {"bass_soft","SOFT","BASS",ENG_LEGACY,0.02f,0.8f,0,0,0,0,0,1},
    {"bass_grit","GRIT","BASS",ENG_LEGACY,0.01f,0.4f,0,0,0,0,0,1},
    {"bass_sub", "SUB", "BASS",ENG_LEGACY,0.01f,0.6f,0,0,0,0,0,1},
    // SAMURAI  p0=pluckDecay p1=harmMix p2=Q
    {"sm01","KATANA",  "SAMURAI",ENG_SAMURAI,0.001f,0.3f, 0.15f,0.35f, 8.f,0,0,0},
    {"sm02","SHAMISEN","SAMURAI",ENG_SAMURAI,0.001f,0.5f, 0.30f,0.20f, 5.f,0,0,0},
    {"sm03","KOTO",    "SAMURAI",ENG_SAMURAI,0.001f,0.7f, 0.45f,0.15f,3.5f,0,0,0},
    {"sm04","TAIKO",   "SAMURAI",ENG_SAMURAI,0.001f,0.2f, 0.08f,0.45f,12.f,0,0,0},
    {"sm05","BIWA",    "SAMURAI",ENG_SAMURAI,0.001f,0.6f, 0.35f,0.25f, 6.f,0,0,0},
    {"sm06","TSUGARU", "SAMURAI",ENG_SAMURAI,0.001f,0.4f, 0.20f,0.30f,7.5f,0,0,0},
    {"sm07","NINJA",   "SAMURAI",ENG_SAMURAI,0.001f,0.2f, 0.10f,0.40f,10.f,0,0,0},
    {"sm08","RONIN",   "SAMURAI",ENG_SAMURAI,0.002f,0.8f, 0.50f,0.18f, 4.f,0,0,0},
    {"sm09","SHOGUN",  "SAMURAI",ENG_SAMURAI,0.001f,0.6f, 0.25f,0.35f, 9.f,0,0,0},
    {"sm10","SAKURA",  "SAMURAI",ENG_SAMURAI,0.001f,0.8f, 0.55f,0.12f,2.5f,0,0,0},
    {"sm11","FUJI",    "SAMURAI",ENG_SAMURAI,0.003f,0.7f, 0.40f,0.22f,5.5f,0,0,0},
    {"sm12","GEISHA",  "SAMURAI",ENG_SAMURAI,0.001f,0.9f, 0.60f,0.10f, 2.f,0,0,0},
    {"sm13","BUSHIDO", "SAMURAI",ENG_SAMURAI,0.001f,0.3f, 0.12f,0.42f,11.f,0,0,0},
    {"sm14","SEPPUKU", "SAMURAI",ENG_SAMURAI,0.002f,0.5f, 0.28f,0.30f, 7.f,0,0,0},
    {"sm15","IKEBANA", "SAMURAI",ENG_SAMURAI,0.003f,1.0f, 0.65f,0.08f,1.8f,0,0,0},
    // CHERNOBYL  p0=bitSteps p1=noiseAmt p2=saturation
    {"ch01","REACTOR", "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.5f,  5.f,0.10f,3.0f,0,0,0},
    {"ch02","FALLOUT", "CHERNOBYL",ENG_CHERNOBYL,0.002f,0.8f,  8.f,0.18f,2.5f,0,0,0},
    {"ch03","MELTDOWN","CHERNOBYL",ENG_CHERNOBYL,0.001f,0.4f,  3.f,0.08f,4.0f,0,0,0},
    {"ch04","CORE",    "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.6f,  6.f,0.15f,3.5f,0,0,0},
    {"ch05","STEAM",   "CHERNOBYL",ENG_CHERNOBYL,0.010f,1.0f, 12.f,0.25f,2.0f,0,0,0},
    {"ch06","ROENTGEN","CHERNOBYL",ENG_CHERNOBYL,0.001f,0.3f,  4.f,0.05f,5.0f,0,0,0},
    {"ch07","PRIPYAT", "CHERNOBYL",ENG_CHERNOBYL,0.005f,1.2f, 10.f,0.30f,1.5f,0,0,0},
    {"ch08","GAMMA",   "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.4f,  2.f,0.04f,6.0f,0,0,0},
    {"ch09","ISOTOPE", "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.5f,  7.f,0.12f,3.8f,0,0,0},
    {"ch10","FISSION", "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.3f,  4.f,0.06f,5.5f,0,0,0},
    {"ch11","HEX",     "CHERNOBYL",ENG_CHERNOBYL,0.002f,0.7f, 11.f,0.28f,1.8f,0,0,0},
    {"ch12","RADIUM",  "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.4f,  6.f,0.14f,4.2f,0,0,0},
    {"ch13","STATIC",  "CHERNOBYL",ENG_CHERNOBYL,0.001f,0.2f,  3.f,0.35f,2.5f,0,0,0},
    {"ch14","GHOST_C", "CHERNOBYL",ENG_CHERNOBYL,0.005f,1.5f, 14.f,0.40f,1.2f,0,0,0},
    {"ch15","DECAY_C", "CHERNOBYL",ENG_CHERNOBYL,0.003f,0.9f,  9.f,0.22f,2.2f,0,0,0},
    // PIRATES  p0=detuneCents p1=vibRate p2=vibDepth
    {"pi01","ACCORDION","PIRATES",ENG_PIRATES,0.04f,0.5f,22.f,5.5f,0.015f,0,0,0},
    {"pi02","SHANTY",   "PIRATES",ENG_PIRATES,0.02f,0.6f,18.f,4.8f,0.012f,0,0,0},
    {"pi03","GROG",     "PIRATES",ENG_PIRATES,0.01f,0.4f,28.f,6.2f,0.020f,0,0,0},
    {"pi04","JOLLY RGR","PIRATES",ENG_PIRATES,0.03f,0.5f,25.f,5.0f,0.018f,0,0,0},
    {"pi05","TREASURE", "PIRATES",ENG_PIRATES,0.05f,0.8f,15.f,4.2f,0.010f,0,0,0},
    {"pi06","ANCHOR",   "PIRATES",ENG_PIRATES,0.02f,0.6f,20.f,5.8f,0.014f,0,0,0},
    {"pi07","RUM",      "PIRATES",ENG_PIRATES,0.01f,0.3f,30.f,7.0f,0.025f,0,0,0},
    {"pi08","PARROT",   "PIRATES",ENG_PIRATES,0.03f,0.7f,12.f,3.5f,0.008f,0,0,0},
    {"pi09","GALLEON",  "PIRATES",ENG_PIRATES,0.06f,0.9f,24.f,5.2f,0.016f,0,0,0},
    {"pi10","CUTLASS",  "PIRATES",ENG_PIRATES,0.01f,0.4f,32.f,6.8f,0.022f,0,0,0},
    {"pi11","PLANK",    "PIRATES",ENG_PIRATES,0.04f,0.7f,16.f,4.5f,0.011f,0,0,0},
    {"pi12","CORSAIR",  "PIRATES",ENG_PIRATES,0.02f,0.5f,26.f,5.6f,0.017f,0,0,0},
    {"pi13","KRAKEN",   "PIRATES",ENG_PIRATES,0.08f,1.2f,35.f,4.0f,0.013f,0,0,0},
    {"pi14","SIREN",    "PIRATES",ENG_PIRATES,0.05f,0.8f,10.f,3.2f,0.007f,0,0,0},
    {"pi15","BUCCANEER","PIRATES",ENG_PIRATES,0.03f,0.6f,20.f,6.0f,0.019f,0,0,0},
    // TRIBAL  p0=formantHz p1=punch
    {"tr01","SHAMAN",  "TRIBAL",ENG_TRIBAL,0.001f,0.4f, 800.f,3.5f,0,0,0,0},
    {"tr02","BONGO",   "TRIBAL",ENG_TRIBAL,0.001f,0.2f,1200.f,5.0f,0,0,0,0},
    {"tr03","DJEMBE",  "TRIBAL",ENG_TRIBAL,0.001f,0.3f, 950.f,4.0f,0,0,0,0},
    {"tr04","CONGA",   "TRIBAL",ENG_TRIBAL,0.001f,0.25f,1400.f,4.5f,0,0,0,0},
    {"tr05","TALKING", "TRIBAL",ENG_TRIBAL,0.001f,0.35f, 600.f,3.0f,0,0,0,0},
    {"tr06","RITUAL",  "TRIBAL",ENG_TRIBAL,0.002f,0.5f, 700.f,2.5f,0,0,0,0},
    {"tr07","TOTEM",   "TRIBAL",ENG_TRIBAL,0.001f,0.4f, 500.f,3.8f,0,0,0,0},
    {"tr08","FIRE DNC","TRIBAL",ENG_TRIBAL,0.001f,0.3f,1100.f,6.0f,0,0,0,0},
    {"tr09","SPIRIT",  "TRIBAL",ENG_TRIBAL,0.003f,0.6f, 400.f,2.0f,0,0,0,0},
    {"tr10","WARRIOR", "TRIBAL",ENG_TRIBAL,0.001f,0.2f,1600.f,7.0f,0,0,0,0},
    {"tr11","EARTH",   "TRIBAL",ENG_TRIBAL,0.002f,0.5f, 650.f,3.2f,0,0,0,0},
    {"tr12","SKY",     "TRIBAL",ENG_TRIBAL,0.002f,0.7f, 350.f,1.8f,0,0,0,0},
    {"tr13","RAIN",    "TRIBAL",ENG_TRIBAL,0.001f,0.4f, 850.f,3.5f,0,0,0,0},
    {"tr14","THUNDER", "TRIBAL",ENG_TRIBAL,0.001f,0.3f,1800.f,8.0f,0,0,0,0},
    {"tr15","MOON",    "TRIBAL",ENG_TRIBAL,0.003f,0.8f, 300.f,1.5f,0,0,0,0},
    // CURIOSITY (SCIFI engine)  p0=modRatio p1=modIndex p2=lfoFreq p3=lpQ p4=lfoDepth
    {"cu01","MARS",    "CURIOSITY",ENG_SCIFI,0.3f, 2.0f,2.5f, 6.0f,0.15f,3.f, 4.f,0},
    {"cu02","ROVER",   "CURIOSITY",ENG_SCIFI,0.2f, 1.5f,3.0f, 4.0f,0.20f,4.f, 3.f,0},
    {"cu03","SIGNAL",  "CURIOSITY",ENG_SCIFI,0.01f,0.8f,4.0f, 3.0f,1.00f,8.f, 3.f,0},
    {"cu04","PROBE",   "CURIOSITY",ENG_SCIFI,0.1f, 1.5f,2.0f, 8.0f,0.30f,4.f, 5.f,0},
    {"cu05","ORBIT",   "CURIOSITY",ENG_SCIFI,0.5f, 2.5f,1.5f,10.0f,0.10f,2.f, 7.f,0},
    {"cu06","COSMOS",  "CURIOSITY",ENG_SCIFI,1.0f, 3.0f,1.2f,12.0f,0.08f,2.f, 8.f,0},
    {"cu07","LANDING", "CURIOSITY",ENG_SCIFI,0.01f,1.2f,3.5f, 5.0f,0.80f,6.f, 4.f,0},
    {"cu08","DUST DEVI","CURIOSITY",ENG_SCIFI,0.2f,1.8f,4.5f, 4.5f,0.25f,5.f, 3.f,0},
    {"cu09","CANYON",  "CURIOSITY",ENG_SCIFI,0.4f, 2.2f,2.0f, 7.0f,0.15f,3.f, 5.f,0},
    {"cu10","BEACON",  "CURIOSITY",ENG_SCIFI,0.001f,0.6f,6.0f,2.0f,2.00f,12.f,5.f,0},
    {"cu11","ANTENNA", "CURIOSITY",ENG_SCIFI,0.05f,1.0f,5.0f, 3.5f,0.50f,7.f, 4.f,0},
    {"cu12","SURFACE", "CURIOSITY",ENG_SCIFI,0.3f, 2.5f,1.8f, 8.0f,0.12f,3.f, 6.f,0},
    {"cu13","ROCK_CU", "CURIOSITY",ENG_SCIFI,0.2f, 2.0f,3.2f, 5.0f,0.22f,4.f, 3.f,0},
    {"cu14","CRATER",  "CURIOSITY",ENG_SCIFI,0.5f, 2.8f,1.0f, 6.0f,0.08f,2.f, 4.f,0},
    {"cu15","SAMPLE_C","CURIOSITY",ENG_SCIFI,0.1f, 1.5f,2.8f, 6.0f,0.30f,5.f, 4.f,0},
    // X-FILES (HORROR engine)  p0=modRatio p1=driftAmt p2=lpHz p3=lpQ p4=bitSteps
    {"xf01","MULDER",  "XFILES",ENG_HORROR,0.5f, 2.5f,1.005f,5.f, 2000.f,2.f,16.f,0},
    {"xf02","SCULLY",  "XFILES",ENG_HORROR,0.3f, 2.0f,1.008f,8.f, 3000.f,1.5f,20.f,0},
    {"xf03","ALIEN",   "XFILES",ENG_HORROR,0.1f, 1.5f,1.025f,4.f, 2500.f,3.f,10.f,0},
    {"xf04","UFO",     "XFILES",ENG_HORROR,0.2f, 2.0f,1.012f,6.f, 4000.f,1.f,18.f,0},
    {"xf05","CIGARETTE","XFILES",ENG_HORROR,0.8f,3.5f,1.003f,12.f,1500.f,2.f,22.f,0},
    {"xf06","AREA 51", "XFILES",ENG_HORROR,2.0f, 5.0f,1.001f,16.f, 800.f,1.f,28.f,0},
    {"xf07","CONSPIR", "XFILES",ENG_HORROR,1.0f, 4.0f,1.006f,10.f,1200.f,2.f,18.f,0},
    {"xf08","ABDUCTION","XFILES",ENG_HORROR,0.05f,1.2f,1.040f,4.f,3500.f,4.f,8.f,0},
    {"xf09","HYBRID",  "XFILES",ENG_HORROR,0.4f, 3.0f,1.009f,9.f, 1800.f,2.5f,14.f,0},
    {"xf10","TRUST NONE","XFILES",ENG_HORROR,1.5f,4.5f,1.002f,14.f,900.f,1.f,24.f,0},
    {"xf11","BOUNTY",  "XFILES",ENG_HORROR,0.6f, 3.5f,1.011f,8.f, 1400.f,3.f,12.f,0},
    {"xf12","LONE GUN","XFILES",ENG_HORROR,0.3f, 2.5f,1.015f,7.f, 2200.f,2.f,16.f,0},
    {"xf13","TRUTH",   "XFILES",ENG_HORROR,1.2f, 4.0f,1.004f,10.f,1000.f,2.f,20.f,0},
    {"xf14","BLACK OIL","XFILES",ENG_HORROR,2.0f,5.5f,1.001f,18.f, 500.f,1.f,30.f,0},
    {"xf15","SYNDICATE","XFILES",ENG_HORROR,1.0f,3.8f,1.007f,9.f, 1600.f,2.f,16.f,0},
    // FLUTES (LEGACY sine engine)
    {"fl01","CONCERT", "FLUTES",ENG_LEGACY,0.06f,1.5f,0,0,0,0,0,0},
    {"fl02","SILVER",  "FLUTES",ENG_LEGACY,0.04f,1.2f,0,0,0,0,0,0},
    {"fl03","SHAKUHA", "FLUTES",ENG_LEGACY,0.08f,1.0f,0,0,0,0,0,0},
    {"fl04","BAMBOO",  "FLUTES",ENG_LEGACY,0.07f,1.2f,0,0,0,0,0,0},
    {"fl05","PAN FLUT","FLUTES",ENG_LEGACY,0.05f,1.5f,0,0,0,0,0,0},
    {"fl06","TIN WHIS","FLUTES",ENG_LEGACY,0.03f,0.8f,0,0,0,0,0,0},
    {"fl07","ALTO",    "FLUTES",ENG_LEGACY,0.07f,1.3f,0,0,0,0,0,0},
    {"fl08","BASS FL", "FLUTES",ENG_LEGACY,0.08f,1.8f,0,0,0,0,0,0},
    {"fl09","PICCOLO", "FLUTES",ENG_LEGACY,0.04f,0.9f,0,0,0,0,0,0},
    {"fl10","IRISH",   "FLUTES",ENG_LEGACY,0.03f,0.7f,0,0,0,0,0,0},
    {"fl11","BREATHY", "FLUTES",ENG_LEGACY,0.05f,1.4f,0,0,0,0,0,0},
    {"fl12","DARK FL", "FLUTES",ENG_LEGACY,0.08f,1.6f,0,0,0,0,0,0},
    {"fl13","OCARINA", "FLUTES",ENG_LEGACY,0.05f,1.2f,0,0,0,0,0,0},
    {"fl14","CRYSTAL", "FLUTES",ENG_LEGACY,0.04f,1.5f,0,0,0,0,0,0},
    {"fl15","MELLOW",  "FLUTES",ENG_LEGACY,0.06f,1.8f,0,0,0,0,0,0},
    // GUITARS  p0=filterOpen p1=filterClose p2=filterTime p3=distAmount p4=bodyDecay
    {"gt01","STRAT",   "GUITARS",ENG_GUITAR,0.001f,0.35f,6000.f, 800.f,0.12f,1.5f,0.25f,0},
    {"gt02","TELE",    "GUITARS",ENG_GUITAR,0.001f,0.30f,8000.f,1000.f,0.08f,1.2f,0.18f,0},
    {"gt03","LES PAUL","GUITARS",ENG_GUITAR,0.001f,0.45f,4000.f, 600.f,0.15f,2.5f,0.30f,0},
    {"gt04","ACOUSTIC","GUITARS",ENG_GUITAR,0.001f,0.40f,7000.f,1200.f,0.10f,1.0f,0.28f,0},
    {"gt05","NYLON",   "GUITARS",ENG_GUITAR,0.001f,0.55f,5000.f, 900.f,0.14f,0.8f,0.35f,0},
    {"gt06","JAZZ",    "GUITARS",ENG_GUITAR,0.002f,0.50f,3000.f, 500.f,0.20f,3.0f,0.35f,0},
    {"gt07","METAL",   "GUITARS",ENG_GUITAR,0.001f,0.25f,7000.f, 700.f,0.08f,4.0f,0.15f,0},
    {"gt08","SLIDE",   "GUITARS",ENG_GUITAR,0.005f,0.60f,5500.f, 800.f,0.18f,2.0f,0.40f,0},
    {"gt09","FUNK",    "GUITARS",ENG_GUITAR,0.001f,0.20f,9000.f,1500.f,0.06f,1.5f,0.12f,0},
    {"gt10","BLUES",   "GUITARS",ENG_GUITAR,0.001f,0.45f,4500.f, 700.f,0.14f,2.2f,0.28f,0},
    {"gt11","CLEAN",   "GUITARS",ENG_GUITAR,0.001f,0.30f,10000.f,1500.f,0.06f,0.9f,0.22f,0},
    {"gt12","CRUNCH",  "GUITARS",ENG_GUITAR,0.001f,0.25f,6000.f, 600.f,0.10f,3.5f,0.18f,0},
    {"gt13","WAH",     "GUITARS",ENG_GUITAR,0.001f,0.35f,8000.f, 400.f,0.25f,1.8f,0.22f,0},
    {"gt14","12 STR",  "GUITARS",ENG_GUITAR,0.001f,0.45f,6000.f,1000.f,0.12f,1.2f,0.30f,0},
    {"gt15","STEEL",   "GUITARS",ENG_GUITAR,0.001f,0.35f,7500.f, 900.f,0.10f,1.6f,0.20f,0},
    // BAGPIPES  p0=pulseWidth p1=droneGain p2=nasalQ p3=vibRate p4=vibDepth
    {"bp01","HIGHLAND","BAGPIPES",ENG_BAGPIPES,0.02f,2.0f,0.22f,0.35f,2.5f,6.0f,0.008f,0},
    {"bp02","UILLEANN","BAGPIPES",ENG_BAGPIPES,0.03f,2.0f,0.18f,0.28f,2.0f,5.0f,0.006f,0},
    {"bp03","DRONE",   "BAGPIPES",ENG_BAGPIPES,0.05f,4.0f,0.30f,0.60f,1.5f,4.0f,0.004f,0},
    {"bp04","MARCH",   "BAGPIPES",ENG_BAGPIPES,0.01f,1.5f,0.20f,0.30f,3.0f,7.0f,0.010f,0},
    {"bp05","LAMENT",  "BAGPIPES",ENG_BAGPIPES,0.06f,3.0f,0.25f,0.40f,2.2f,4.5f,0.005f,0},
    {"bp06","REEL",    "BAGPIPES",ENG_BAGPIPES,0.01f,1.2f,0.15f,0.25f,3.5f,8.0f,0.012f,0},
    {"bp07","BRAW",    "BAGPIPES",ENG_BAGPIPES,0.02f,2.0f,0.28f,0.45f,2.8f,6.5f,0.009f,0},
    {"bp08","PIBROCH", "BAGPIPES",ENG_BAGPIPES,0.04f,2.5f,0.32f,0.50f,2.5f,5.5f,0.007f,0},
    {"bp09","STRATHSPY","BAGPIPES",ENG_BAGPIPES,0.01f,1.8f,0.18f,0.32f,3.2f,7.5f,0.011f,0},
    {"bp10","JIG",     "BAGPIPES",ENG_BAGPIPES,0.01f,1.0f,0.12f,0.20f,4.0f,9.0f,0.015f,0},
    {"bp11","REBEL",   "BAGPIPES",ENG_BAGPIPES,0.02f,2.0f,0.26f,0.38f,2.8f,6.0f,0.009f,0},
    {"bp12","PASTORAL","BAGPIPES",ENG_BAGPIPES,0.04f,3.0f,0.22f,0.55f,2.0f,4.0f,0.005f,0},
    {"bp13","WARLIKE", "BAGPIPES",ENG_BAGPIPES,0.01f,1.5f,0.18f,0.25f,3.8f,8.5f,0.013f,0},
    {"bp14","CELTIC",  "BAGPIPES",ENG_BAGPIPES,0.03f,2.2f,0.24f,0.35f,2.4f,5.8f,0.008f,0},
    {"bp15","ANCIENT", "BAGPIPES",ENG_BAGPIPES,0.05f,3.5f,0.35f,0.65f,1.8f,3.5f,0.004f,0},
    // JOLA EP  p0=tremoloRate p1=tremoloDepth p2=warmth p3=epDecayTime p4=sustainLevel
    {"ep01","RHODES",  "JOLA EP",ENG_EP,0.002f,2.5f,3.0f,0.08f,1.8f,1.5f,0.20f,0},
    {"ep02","SUITCASE","JOLA EP",ENG_EP,0.002f,2.8f,3.5f,0.10f,2.0f,1.8f,0.18f,0},
    {"ep03","WURLY",   "JOLA EP",ENG_EP,0.001f,2.0f,4.0f,0.06f,1.5f,1.2f,0.22f,0},
    {"ep04","STAGE EP","JOLA EP",ENG_EP,0.002f,3.0f,2.5f,0.09f,2.2f,2.0f,0.19f,0},
    {"ep05","JAZZ EP", "JOLA EP",ENG_EP,0.003f,3.5f,2.0f,0.07f,2.5f,2.5f,0.16f,0},
    {"ep06","BRIGHT EP","JOLA EP",ENG_EP,0.001f,2.0f,5.0f,0.05f,1.2f,1.0f,0.25f,0},
    {"ep07","DARK EP", "JOLA EP",ENG_EP,0.003f,3.5f,2.0f,0.12f,3.0f,3.0f,0.12f,0},
    {"ep08","FUNKY EP","JOLA EP",ENG_EP,0.001f,1.5f,6.0f,0.04f,1.8f,1.5f,0.30f,0},
    {"ep09","GOSPEL EP","JOLA EP",ENG_EP,0.002f,2.5f,3.0f,0.08f,2.0f,2.0f,0.22f,0},
    {"ep10","LO-FI EP","JOLA EP",ENG_EP,0.003f,2.0f,3.5f,0.15f,1.5f,1.5f,0.25f,0},
    {"ep11","BELL EP", "JOLA EP",ENG_EP,0.001f,3.5f,4.5f,0.03f,1.0f,0.8f,0.28f,0},
    {"ep12","SOFT EP", "JOLA EP",ENG_EP,0.003f,3.0f,2.5f,0.06f,1.8f,1.5f,0.18f,0},
    {"ep13","SOUL EP", "JOLA EP",ENG_EP,0.002f,2.8f,3.0f,0.09f,2.0f,2.2f,0.20f,0},
    {"ep14","ELECTRIC","JOLA EP",ENG_EP,0.001f,2.2f,4.0f,0.07f,1.6f,1.8f,0.24f,0},
    {"ep15","WARM EP", "JOLA EP",ENG_EP,0.003f,3.2f,2.8f,0.10f,2.3f,2.5f,0.18f,0},
};
static const int NUM_PRESETS = (int)(sizeof(BANK)/sizeof(BANK[0]));
static const int NUM_VOICES  = 16;

// ── DSP ───────────────────────────────────────────────────────────────────────
struct BQ { // Biquad LP
    float b0=1,b1=0,b2=0,a1=0,a2=0,x1=0,x2=0,y1=0,y2=0;
    void set(float f,float q,float sr){
        float w=2.f*(float)M_PI*f/sr,cw=cosf(w),sw=sinf(w),al=sw/(2.f*q),n=1.f+al;
        b0=(1.f-cw)*.5f/n; b1=(1.f-cw)/n; b2=b0;
        a1=-2.f*cw/n; a2=(1.f-al)/n;
    }
    float p(float x){float y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=x;y2=y1;y1=y;return y;}
    void r(){x1=x2=y1=y2=0.f;}
};
struct OP { float z=0.f; float p(float x,float c){z+=c*(x-z);return z;} void r(){z=0.f;} };
static inline float tA(float x){if(x>3)return 1;if(x<-3)return -1;float q=x*x;return x*(27+q)/(27+9*q);}
static inline float hC(float x,float t){return x>t?t:x<-t?-t:x;}
static inline float bC(float x,float s){return s<2?x:floorf(x*s+.5f)/s;}
static inline float n2f(int n){return 440.f*powf(2.f,(n-69)/12.f);}

struct Voice {
    bool active=false,rel=false; int note=-1,pidx=0;
    float freq=440,ph[3]={},mp=0,lp=0,env=0,ev=0,rr=0,t=0;
    float sf=0,sd=0,st=0; // slide freq, dur samples, target
    BQ bq; OP op;
    void reset(){active=rel=false;note=-1;ph[0]=ph[1]=ph[2]=0;mp=lp=0;env=0;t=0;sf=sd=st=0;bq.r();op.r();}
};

// ── Shared state (processor writes, also used by controller) ──────────────────
struct SharedState {
    std::atomic<float> vol{0.75f},atk{0.01f},rls{0.08f},flt{1.0f},rev{0.2f},cho{0.0f};
    std::atomic<int>   pre{0};
};

// ──────────────────────────────────────────────────────────────────────────────
// Processor
// ──────────────────────────────────────────────────────────────────────────────
class SFProcessor : public AudioEffect
{
public:
    SFProcessor() { setControllerClass(kControllerUID); }
    ~SFProcessor() override = default;

    static FUnknown* createInstance(void*) { return (IAudioProcessor*)new SFProcessor; }

    tresult PLUGIN_API initialize(FUnknown* ctx) override {
        tresult r = AudioEffect::initialize(ctx);
        if (r != kResultOk) return r;
        addAudioInput( STR16("In"),  SpeakerArr::kStereo);
        addAudioOutput(STR16("Out"), SpeakerArr::kStereo);
        addEventInput(STR16("MIDI"),1);
        return kResultOk;
    }

    tresult PLUGIN_API setBusArrangements(SpeakerArrangement* in,int32 ni,SpeakerArrangement* out,int32 no) override {
        if(ni==1&&no==1&&in[0]==SpeakerArr::kStereo&&out[0]==SpeakerArr::kStereo) return kResultTrue;
        return kResultFalse;
    }
    tresult PLUGIN_API setupProcessing(ProcessSetup& s) override { sr=(float)s.sampleRate; return AudioEffect::setupProcessing(s); }
    tresult PLUGIN_API setActive(TBool b) override { if(!b) for(auto&v:V)v.reset(); return kResultOk; }

    tresult PLUGIN_API process(ProcessData& d) override {
        if(d.inputParameterChanges) {
            int32 n=d.inputParameterChanges->getParameterCount();
            for(int32 i=0;i<n;i++){
                auto*q=d.inputParameterChanges->getParameterData(i); if(!q)continue;
                int32 np=q->getPointCount(),off; ParamValue v;
                if(q->getPoint(np-1,off,v)==kResultOk) setP(q->getParameterId(),(float)v);
            }
        }
        if(d.inputEvents){
            int32 n=d.inputEvents->getEventCount();
            for(int32 i=0;i<n;i++){
                Event e; d.inputEvents->getEvent(i,e);
                if(e.type==Event::kNoteOnEvent&&e.noteOn.velocity>0) nOn(e.noteOn.pitch,(float)e.noteOn.velocity/127.f);
                else if(e.type==Event::kNoteOffEvent) nOff(e.noteOff.pitch);
                else if(e.type==Event::kNoteOnEvent&&e.noteOn.velocity==0) nOff(e.noteOn.pitch);
            }
        }
        if(!d.outputs||d.numOutputs==0) return kResultOk;
        float**out=d.outputs[0].channelBuffers32; int32 n=d.numSamples;
        for(int32 s=0;s<n;s++){out[0][s]=0;out[1][s]=0;}
        float v=st.vol;
        for(auto&vv:V){if(!vv.active)continue;rV(vv,out[0],out[1],n);}
        for(int32 s=0;s<n;s++){out[0][s]*=v;out[1][s]*=v;}
        return kResultOk;
    }

    tresult PLUGIN_API setState(IBStream* s) override {
        if(!s) return kResultFalse;
        IBStreamer is(s,kLittleEndian); int32 ver; is.readInt32(ver);
        if(ver>=1){float v;int32 p;
            is.readFloat(v);st.vol=v; is.readFloat(v);st.atk=v;
            is.readFloat(v);st.rls=v; is.readFloat(v);st.flt=v;
            is.readFloat(v);st.rev=v; is.readFloat(v);st.cho=v;
            is.readInt32(p);st.pre=p;}
        return kResultOk;
    }
    tresult PLUGIN_API getState(IBStream* s) override {
        if(!s) return kResultFalse;
        IBStreamer os(s,kLittleEndian);
        os.writeInt32(1);
        os.writeFloat(st.vol); os.writeFloat(st.atk); os.writeFloat(st.rls);
        os.writeFloat(st.flt); os.writeFloat(st.rev); os.writeFloat(st.cho);
        os.writeInt32(st.pre);
        return kResultOk;
    }

    SharedState st;

private:
    float sr=44100.f;
    Voice V[NUM_VOICES];

    void setP(ParamID id,float v){
        switch(id){case 0:st.vol=v;break;case 1:st.atk=v;break;case 2:st.rls=v;break;
            case 3:st.flt=v;break;case 4:st.rev=v;break;case 5:st.cho=v;break;
            case 6:st.pre=std::min((int)(v*(NUM_PRESETS-1)+.5f),NUM_PRESETS-1);break;}
    }
    void nOn(int nt,float){
        Voice*vv=nullptr;
        for(auto&x:V)if(!x.active){vv=&x;break;}
        if(!vv)vv=&V[0];
        vv->reset(); vv->active=true; vv->note=nt;
        vv->freq=n2f(nt); vv->pidx=st.pre;
        const PresetDef&p=BANK[vv->pidx];
        float atk=std::max(p.atk,st.atk*2.f*p.atk);
        float rls=std::max(p.rel,st.rls*5.f*p.rel);
        vv->ev=1.f/(atk*sr); vv->rr=1.f/(rls*sr);
        if(p.engine==ENG_BASS808){
            vv->sf=vv->freq*powf(2.f,p.p0/12.f);
            vv->sd=p.p1*sr; vv->st=vv->freq;
        }
        if(p.engine==ENG_VAPOR)  vv->bq.set(p.p1,0.7f,sr);
        if(p.engine==ENG_GUITAR) vv->bq.set(p.p0,0.7f,sr); // init to filterOpen
    }
    void nOff(int nt){
        for(auto&x:V) if(x.active&&!x.rel&&x.note==nt){x.rel=true;}
    }
    void rV(Voice&v,float*L,float*R,int32 n){
        const PresetDef&p=BANK[v.pidx];
        float inv=1.f/sr, lHz=200.f*powf(90.f,(float)st.flt);
        for(int32 s=0;s<n;s++){
            if(!v.rel){if(v.env<1.f)v.env=std::min(1.f,v.env+v.ev);}
            else{v.env-=v.rr;if(v.env<=0.f){v.active=false;return;}}
            float smp=0;
            switch(p.engine){
                case ENG_SCIFI:     smp=rSCIFI(v,p,inv); break;
                case ENG_VIKINGS:   smp=rVIK(v,p,inv);   break;
                case ENG_GYM:       smp=rGYM(v,p,inv);   break;
                case ENG_BASS808:   smp=r808(v,p,inv);   break;
                case ENG_VAPOR:     smp=rVAP(v,p,inv);   break;
                case ENG_HORROR:    smp=rHOR(v,p,inv);   break;
                case ENG_SAMURAI:   smp=rSAM(v,p,inv);   break;
                case ENG_CHERNOBYL: smp=rCHE(v,p,inv);   break;
                case ENG_PIRATES:   smp=rPIR(v,p,inv);   break;
                case ENG_TRIBAL:    smp=rTRI(v,p,inv);   break;
                case ENG_GUITAR:    smp=rGTR(v,p,inv);   break;
                case ENG_BAGPIPES:  smp=rBAG(v,p,inv);   break;
                case ENG_EP:        smp=rEP(v,p,inv);    break;
                default:            smp=rLEG(v,p,inv);   break;
            }
            smp=v.op.p(smp,std::min(1.f,lHz*inv*6.28f));
            smp*=v.env*.25f; L[s]+=smp; R[s]+=smp; v.t+=1.f;
        }
    }
    float rSCIFI(Voice&v,const PresetDef&p,float inv){
        v.lp+=p.p2*inv; if(v.lp>1)v.lp-=1;
        float lf=sinf(v.lp*2*(float)M_PI), di=p.p1+lf*p.p4;
        v.mp+=v.freq*p.p0*inv; if(v.mp>1)v.mp-=1;
        float md=sinf(v.mp*2*(float)M_PI)*di*v.freq;
        v.ph[0]+=(v.freq+md)*inv; if(v.ph[0]>1)v.ph[0]-=1;
        float out=sinf(v.ph[0]*2*(float)M_PI);
        v.bq.set(v.freq*4+200,p.p3,sr); return v.bq.p(out);
    }
    float rVIK(Voice&v,const PresetDef&p,float inv){
        float df=powf(2.f,p.p0/1200);
        v.ph[0]+=v.freq*inv;    if(v.ph[0]>1)v.ph[0]-=1;
        v.ph[1]+=v.freq*df*inv; if(v.ph[1]>1)v.ph[1]-=1;
        float o=(2*v.ph[0]-1)+(2*v.ph[1]-1);
        if((int)p.p4>=3){v.ph[2]+=v.freq/df*inv;if(v.ph[2]>1)v.ph[2]-=1;o+=(2*v.ph[2]-1);o/=3;}else o/=2;
        v.mp+=v.freq*.5f*inv; if(v.mp>1)v.mp-=1;
        o=tA((o+sinf(v.mp*2*(float)M_PI)*p.p1)*p.p3);
        v.bq.set(p.p2,0.7f,sr); return v.bq.p(o);
    }
    float rGYM(Voice&v,const PresetDef&p,float inv){
        v.ph[0]+=v.freq*inv; if(v.ph[0]>1)v.ph[0]-=1;
        float m=p.p0<.5f?(v.ph[0]<.5f?1.f:-1.f):(2*v.ph[0]-1);
        m=hC(m*(1+p.p1*3),1.f);
        v.mp+=v.freq*.5f*inv; if(v.mp>1)v.mp-=1;
        float sub=sinf(v.mp*2*(float)M_PI)*p.p4;
        v.bq.set(3000,0.6f,sr); return v.bq.p(m+sub);
    }
    float r808(Voice&v,const PresetDef&p,float inv){
        float cf=v.freq;
        if(v.sd>0){float t=std::min(1.f,v.t/v.sd);cf=v.sf*powf(std::max(v.st/std::max(v.sf,1.f),.001f),t);}
        v.ph[0]+=cf*inv; if(v.ph[0]>1)v.ph[0]-=1;
        float o=tA(sinf(v.ph[0]*2*(float)M_PI)*(1+p.p2*4));
        v.mp+=cf*.5f*inv; if(v.mp>1)v.mp-=1;
        o+=sinf(v.mp*2*(float)M_PI)*p.p4;
        v.bq.set(800,0.8f,sr); return v.bq.p(o);
    }
    float rVAP(Voice&v,const PresetDef&p,float inv){
        float df=powf(2.f,p.p0/1200);
        v.lp+=p.p4*inv; if(v.lp>1)v.lp-=1;
        float vib=1+sinf(v.lp*2*(float)M_PI)*.002f;
        v.ph[0]+=v.freq*vib*inv;    if(v.ph[0]>1)v.ph[0]-=1;
        v.ph[1]+=v.freq*df*vib*inv; if(v.ph[1]>1)v.ph[1]-=1;
        v.ph[2]+=v.freq/df*vib*inv; if(v.ph[2]>1)v.ph[2]-=1;
        float o=(2*v.ph[0]-1+2*v.ph[1]-1+2*v.ph[2]-1)/3;
        float t=std::min(1.f,v.t/(p.p3*sr));
        v.bq.set(p.p1+t*(p.p2-p.p1),.7f,sr); return v.bq.p(o);
    }
    float rHOR(Voice&v,const PresetDef&p,float inv){
        v.lp+=.05f*inv; if(v.lp>1)v.lp-=1;
        float dr=sinf(v.lp*2*(float)M_PI)*p.p1;
        v.ph[0]+=v.freq*inv;      if(v.ph[0]>1)v.ph[0]-=1;
        v.ph[1]+=v.freq*p.p0*inv; if(v.ph[1]>1)v.ph[1]-=1;
        float o=(sinf(v.ph[0]*2*(float)M_PI)+sinf(v.ph[1]*2*(float)M_PI+dr))*.5f;
        o=bC(o,p.p4); v.bq.set(p.p2,p.p3,sr); return v.bq.p(o);
    }
    // ── New engines ───────────────────────────────────────────────────────────
    float rSAM(Voice&v,const PresetDef&p,float inv){ // SAMURAI pluck
        float pd=expf(-v.t*inv/std::max(p.p0,.001f));
        v.ph[0]+=v.freq*inv;    if(v.ph[0]>1)v.ph[0]-=1;
        v.ph[1]+=v.freq*2*inv;  if(v.ph[1]>1)v.ph[1]-=1;
        float body=v.ph[0]<.5f?4*v.ph[0]-1:3-4*v.ph[0];
        float harm=v.ph[1]<.5f?4*v.ph[1]-1:3-4*v.ph[1];
        float o=(body+harm*p.p1)*pd;
        v.bq.set(v.freq*8+200,p.p2,sr); return v.bq.p(o);
    }
    float rCHE(Voice&v,const PresetDef&p,float inv){ // CHERNOBYL bitcrush+noise
        v.ph[0]+=v.freq*inv; if(v.ph[0]>1)v.ph[0]-=1;
        float sq=v.ph[0]<.5f?1.f:-1.f;
        float s=p.p0; float cr=s>1?floorf(sq*s+.5f)/s:sq;
        v.mp+=1; if(v.mp>1e7f)v.mp=0;
        float noise=sinf(v.mp*127.1f+v.ph[0]*311.7f)*p.p1;
        float o=tA((cr*(1-p.p1*.5f)+noise)*p.p2);
        v.bq.set(v.freq*5,.7f,sr); return v.bq.p(o)*.55f;
    }
    float rPIR(Voice&v,const PresetDef&p,float inv){ // PIRATES 3 saws + vibrato
        v.lp+=p.p1*inv; if(v.lp>1)v.lp-=1;
        float df=powf(2.f,p.p0/1200);
        float o=0;
        float freqs[3]={v.freq/df,v.freq,v.freq*df};
        for(int i=0;i<3;i++){
            float lv=sinf((v.lp+i*.33f)*2*(float)M_PI)*p.p2;
            v.ph[i]+=freqs[i]*(1+lv)*inv; if(v.ph[i]>1)v.ph[i]-=1;
            o+=1-2*v.ph[i];
        }
        v.bq.set(v.freq*2.5f,3.f,sr); return v.bq.p(o*.28f);
    }
    float rTRI(Voice&v,const PresetDef&p,float inv){ // TRIBAL click+formant
        float ct=v.t*inv;
        float click=0;
        if(ct<.018f){
            v.ph[1]+=v.freq*5*inv; if(v.ph[1]>1)v.ph[1]-=1;
            click=sinf(v.ph[1]*2*(float)M_PI)*expf(-ct*350)*p.p1*.5f;
        }
        v.ph[0]+=v.freq*inv; if(v.ph[0]>1)v.ph[0]-=1;
        float body=v.ph[0]<.5f?4*v.ph[0]-1:3-4*v.ph[0];
        v.bq.set(p.p0,3.5f,sr); return v.bq.p((body+click)*.45f);
    }
    float rGTR(Voice&v,const PresetDef&p,float inv){ // GUITAR filter sweep + pluck
        float pd=expf(-v.t*inv/std::max(p.p4,.001f));
        float t=std::min(1.f,v.t*inv/std::max(p.p2,.001f));
        float fc=p.p0+t*(p.p1-p.p0);
        v.ph[0]+=v.freq*inv; if(v.ph[0]>1)v.ph[0]-=1;
        float o=tA((1-2*v.ph[0])*p.p3);
        v.bq.set(fc,.7f,sr); return v.bq.p(o)*pd;
    }
    float rBAG(Voice&v,const PresetDef&p,float inv){ // BAGPIPES Fourier pulse+drone
        v.lp+=p.p3*inv; if(v.lp>1)v.lp-=1;
        float vib=1+sinf(v.lp*2*(float)M_PI)*p.p4;
        float pw=p.p0; float pulse=0;
        v.ph[0]+=v.freq*vib*inv; if(v.ph[0]>1)v.ph[0]-=1;
        for(int n=1;n<=6;n++){
            float c=sinf(n*(float)M_PI*pw)/(n*(float)M_PI)*2;
            pulse+=c*sinf(n*v.ph[0]*2*(float)M_PI);
        }
        v.mp+=v.freq*.5f*inv; if(v.mp>1)v.mp-=1;
        float drone=sinf(v.mp*2*(float)M_PI)*p.p1;
        float o=pulse+drone;
        v.bq.set(3200,p.p2,sr); return v.bq.p(o)*.42f;
    }
    float rEP(Voice&v,const PresetDef&p,float inv){ // JOLA EP rhodes-style
        v.lp+=p.p0*inv; if(v.lp>1)v.lp-=1;
        float trem=1-p.p1+p.p1*(.5f+.5f*sinf(v.lp*2*(float)M_PI));
        float ep=p.p4+(1-p.p4)*expf(-v.t*inv/std::max(p.p3*.5f,.001f));
        v.ph[0]+=v.freq*inv; if(v.ph[0]>1)v.ph[0]-=1;
        v.ph[1]+=v.freq*inv; if(v.ph[1]>1)v.ph[1]-=1;
        float o=sinf(v.ph[0]*2*(float)M_PI)*.7f
               +(v.ph[1]<.5f?4*v.ph[1]-1:3-4*v.ph[1])*.3f;
        o=tA(o*p.p2);
        if(v.t*inv<.012f){
            float ce=expf(-v.t*inv*600);
            v.ph[2]+=v.freq*5*inv; if(v.ph[2]>1)v.ph[2]-=1;
            o+=(v.ph[2]<.5f?1.f:-1.f)*ce*.12f;
        }
        v.bq.set(1200,.9f,sr); return v.bq.p(o)*ep*trem;
    }

    float rLEG(Voice&v,const PresetDef&p,float inv){
        if(p.legacyType==1){
            v.ph[0]+=v.freq*inv; if(v.ph[0]>1)v.ph[0]-=1;
            v.mp+=v.freq*.5f*inv; if(v.mp>1)v.mp-=1;
            float o=(2*v.ph[0]-1)+sinf(v.mp*2*(float)M_PI)*.4f;
            v.bq.set(600,.7f,sr); return v.bq.p(o);
        } else {
            v.ph[0]+=v.freq*inv;       if(v.ph[0]>1)v.ph[0]-=1;
            v.ph[1]+=v.freq*1.002f*inv; if(v.ph[1]>1)v.ph[1]-=1;
            v.ph[2]+=v.freq*.998f*inv;  if(v.ph[2]>1)v.ph[2]-=1;
            float o=(sinf(v.ph[0]*2*(float)M_PI)+sinf(v.ph[1]*2*(float)M_PI)+sinf(v.ph[2]*2*(float)M_PI))/3;
            v.bq.set(3000,.6f,sr); return v.bq.p(o);
        }
    }
};

// ──────────────────────────────────────────────────────────────────────────────
// Controller
// ──────────────────────────────────────────────────────────────────────────────
class SFController : public EditControllerEx1
{
public:
    static FUnknown* createInstance(void*) { return (IEditController*)new SFController; }

    tresult PLUGIN_API initialize(FUnknown* ctx) override {
        tresult r = EditControllerEx1::initialize(ctx);
        if (r != kResultOk) return r;
        parameters.addParameter(STR16("Volume"), STR16(""), 0, 0.75, ParameterInfo::kCanAutomate, 0);
        parameters.addParameter(STR16("Attack"), STR16(""), 0, 0.01, ParameterInfo::kCanAutomate, 1);
        parameters.addParameter(STR16("Release"),STR16(""), 0, 0.08, ParameterInfo::kCanAutomate, 2);
        parameters.addParameter(STR16("Filter"), STR16(""), 0, 1.0,  ParameterInfo::kCanAutomate, 3);
        parameters.addParameter(STR16("Reverb"), STR16(""), 0, 0.2,  ParameterInfo::kCanAutomate, 4);
        parameters.addParameter(STR16("Chorus"), STR16(""), 0, 0.0,  ParameterInfo::kCanAutomate, 5);
        parameters.addParameter(STR16("Preset"), STR16(""), NUM_PRESETS-1, 0, ParameterInfo::kIsList, 6);
        return kResultOk;
    }

    tresult PLUGIN_API setComponentState(IBStream* state) override {
        if(!state) return kResultFalse;
        IBStreamer s(state,kLittleEndian); int32 ver; s.readInt32(ver);
        if(ver>=1){float v;int32 p;
            s.readFloat(v); setParamNormalized(0,(ParamValue)v);
            s.readFloat(v); setParamNormalized(1,(ParamValue)v);
            s.readFloat(v); setParamNormalized(2,(ParamValue)v);
            s.readFloat(v); setParamNormalized(3,(ParamValue)v);
            s.readFloat(v); setParamNormalized(4,(ParamValue)v);
            s.readFloat(v); setParamNormalized(5,(ParamValue)v);
            s.readInt32(p); setParamNormalized(6,(ParamValue)p/(NUM_PRESETS-1));
        }
        return kResultOk;
    }

    tresult PLUGIN_API getParamStringByValue(ParamID id, ParamValue v, String128 str) override {
        if(id==6){
            int idx=std::min((int)(v*(NUM_PRESETS-1)+.5f),NUM_PRESETS-1);
            UString128(BANK[idx].name).copyTo(str,128);
            return kResultOk;
        }
        return EditControllerEx1::getParamStringByValue(id,v,str);
    }

    IPlugView* PLUGIN_API createView(FIDString) override { return nullptr; }
};

// ── Factory ───────────────────────────────────────────────────────────────────
BEGIN_FACTORY_DEF("SoulForge",
                  "https://soulforge.io",
                  "mailto:contact@soulforge.io")

    DEF_CLASS2(INLINE_UID_FROM_FUID(kProcessorUID),
               PClassInfo::kManyInstances,
               kVstAudioEffectClass,
               "SoulForge Synth",
               Vst::kDistributable,
               "Instrument|Synth",
               "0.1.0",
               kVstVersionString,
               SFProcessor::createInstance)

    DEF_CLASS2(INLINE_UID_FROM_FUID(kControllerUID),
               PClassInfo::kManyInstances,
               kVstComponentControllerClass,
               "SoulForge Synth Controller",
               0, "", "0.1.0",
               kVstVersionString,
               SFController::createInstance)

END_FACTORY
