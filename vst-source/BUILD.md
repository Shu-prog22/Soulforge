# SoulForge Synth — Guide de build VST3

## Prérequis

### Windows
- Visual Studio 2022 (Community suffit) avec "Desktop C++"
- CMake 3.15+
- Git

### macOS
- Xcode 13+
- CMake 3.15+
- Git

---

## 1. Cloner JUCE

```bash
cd /chemin/vers/vst-source
git clone https://github.com/juce-framework/JUCE.git external/JUCE
```

---

## 2. Build Windows (FL Studio)

```bat
mkdir build-win
cd build-win
cmake .. -G "Visual Studio 17 2022" -A x64
cmake --build . --config Release
```

Le fichier `.vst3` sera copié automatiquement dans :
```
C:\Program Files\Common Files\VST3\SoulForge Synth.vst3
```

Dans FL Studio : **Options → Manage plugins → Scan** puis cherche "SoulForge Synth".

---

## 2b. Build Windows (ligne de commande sans VS)

```bat
mkdir build-win && cd build-win
cmake .. -G "Ninja" -DCMAKE_BUILD_TYPE=Release
cmake --build .
```

---

## 3. Build macOS (FL Studio Mac)

```bash
mkdir build-mac && cd build-mac
cmake .. -G "Xcode"
cmake --build . --config Release
```

Ou en ligne de commande (Universal Binary arm64 + x86_64) :

```bash
mkdir build-mac && cd build-mac
cmake .. -DCMAKE_BUILD_TYPE=Release \
         -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
         -DCMAKE_OSX_DEPLOYMENT_TARGET="10.13"
cmake --build .
```

Le `.vst3` sera installé dans :
```
~/Library/Audio/Plug-Ins/VST3/SoulForge Synth.vst3
```

Dans FL Studio Mac : **Options → Manage plugins → Scan**.

---

## Structure des fichiers

```
vst-source/
├── CMakeLists.txt
├── BUILD.md
├── external/
│   └── JUCE/          ← git clone ici
└── src/
    ├── PluginProcessor.h    ← Moteurs ENGINES + BANK
    ├── PluginProcessor.cpp  ← Synthèse audio + 150+ presets
    ├── PluginEditor.h       ← Interface graphique
    └── PluginEditor.cpp     ← Rendu UI + preset browser
```

---

## Architecture des moteurs

| Engine   | Technique                              | Dossier FL  |
|----------|----------------------------------------|-------------|
| SCIFI    | FM synthesis (carrier + modulator)     | SCI-FI      |
| VIKINGS  | 3 saws désaccordés + sub + tanh sat    | VIKINGS     |
| GYM      | Square/saw + hard clip + EQ            | GYM         |
| BASS808  | Sine + pitch slide + tanh distortion   | 808         |
| VAPOR    | Saws lents + LP sweep + vibrato        | VAPOR       |
| HORROR   | Near-unison dissonance + bitcrush      | HORROR      |
| Legacy   | Detuned ensemble (PADS, BASS, GHIBLI…) | PADS/BASS/… |

---

## Ajouter un preset

Dans `PluginProcessor.cpp`, fonction `buildBank()` :

```cpp
// Exemple SCIFI
sf("mon_id", "MON NOM", 0xff00ffff,
   /*atk*/0.01f, /*rel*/1.0f,
   /*modRatio*/4.0f, /*modIndex*/6.0f, /*lfoFreq*/1.0f, /*lpQ*/5.0f, /*lfoDepth*/4.0f);
```

---

## Notes FL Studio

- FL Studio charge les VST3 **64-bit uniquement** (Windows et Mac)
- Le build Release est requis (Debug peut être trop lent)
- Sur Mac Apple Silicon, le build Universal Binary (`arm64;x86_64`) couvre les deux architectures
- Pour voir le plugin dans FL : **Mixer → Slot → More plugins** ou **Add → More plugins**
