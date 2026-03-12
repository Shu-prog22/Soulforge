#pragma once
#include <JuceHeader.h>
#include <vector>
#include <map>
#include <array>
#include <cmath>

// ─────────────────────────────────────────────────────────────────────────────
// Engine types — mirrors the JS ENGINES object
// ─────────────────────────────────────────────────────────────────────────────
enum class EngineType { Legacy, SCIFI, VIKINGS, GYM, BASS808, VAPOR, HORROR,
                        SAMURAI, CHERNOBYL, PIRATES, TRIBAL, GUITAR, BAGPIPES, JOLA_EP };

// ─────────────────────────────────────────────────────────────────────────────
// Preset parameters — one struct covers all engines
// ─────────────────────────────────────────────────────────────────────────────
struct PresetParams
{
    juce::String    id, name, folder;
    juce::Colour    colour  { 0xff888888 };
    float           atk     { 0.01f };
    float           rel     { 1.0f  };
    EngineType      engine  { EngineType::Legacy };

    // ── SCIFI (FM) ───────────────────────────────────────────────────────────
    float modRatio   { 3.5f };
    float modIndex   { 4.0f };
    float lfoFreq    { 0.8f };
    float lpQ        { 5.0f };
    float lfoDepth   { 3.0f };

    // ── VIKINGS ──────────────────────────────────────────────────────────────
    float detuneCents { 15.0f };
    float subGain     { 0.35f };
    float vikLpHz     { 400.0f };
    float saturation  { 2.0f  };
    int   waves       { 3     };

    // ── GYM ──────────────────────────────────────────────────────────────────
    int   gymWave     { 0    };   // 0=square 1=sawtooth
    float clipAmount  { 0.7f };
    float boostHz     { 2000.f };
    float boostDB     { 8.0f  };
    float gymSub      { 0.0f  };

    // ── BASS808 ───────────────────────────────────────────────────────────────
    float slideFrom   { 2.0f  };
    float slideDur    { 0.08f };
    float distAmount  { 2.5f  };
    float slideTarget { 1.0f  };
    float b8Sub       { 0.0f  };

    // ── VAPOR ─────────────────────────────────────────────────────────────────
    float lpStartHz   { 800.f  };
    float lpEndHz     { 3000.f };
    float sweepTime   { 1.5f   };
    float vapVibRate  { 0.3f   };
    int   vapWave     { 0      }; // 0=saw 1=triangle 2=sine

    // ── HORROR ────────────────────────────────────────────────────────────────
    float horModRatio  { 1.013f };
    float driftAmount  { 0.02f  };
    float horLpHz      { 2000.f };
    float horLpQ       { 2.0f   };
    int   bitSteps     { 12     };

    // ── LEGACY (PADS, BASS, GHIBLI …) ────────────────────────────────────────
    int   legWave      { 0      }; // 0=sine 1=triangle 2=saw 3=square
    float legDetune    { 8.0f   }; // cents
    float legLpHz      { 2000.f };
    float legLpQ       { 0.7f   };
    float legSubGain   { 0.0f   };

    // ── SAMURAI (pluck boisé) ─────────────────────────────────────────────────
    float pluckDecay   { 0.35f  }; // pluck body decay time
    float harmMix      { 0.25f  }; // 2nd harmonic mix
    // (reuses lpQ from SCIFI for resonance)

    // ── CHERNOBYL (bitcrush + noise) ──────────────────────────────────────────
    float noiseAmt     { 0.12f  }; // white noise mix
    // (reuses bitSteps from HORROR, saturation from VIKINGS)

    // ── PIRATES (accordion + vibrato) ─────────────────────────────────────────
    float vibRate      { 5.2f   }; // vibrato LFO rate in Hz
    float vibDepth     { 0.012f }; // vibrato depth (freq ratio)
    // (reuses detuneCents from VIKINGS, lpQ from SCIFI for bandpass Q)

    // ── TRIBAL (percussive formant) ────────────────────────────────────────────
    float formantHz    { 900.f  }; // formant bandpass center
    float punch        { 4.0f   }; // click punch gain

    // ── GUITAR (pluck + filter envelope) ──────────────────────────────────────
    int   guitWave     { 0      }; // 0=sawtooth 1=square
    float filterOpen   { 5000.f }; // filter cutoff at note-on
    float filterClose  { 700.f  }; // filter cutoff after filterTime
    float filterTime   { 0.10f  }; // LP sweep duration (seconds)
    float bodyDecay    { 0.20f  }; // pluck body amplitude decay
    // (reuses distAmount from BASS808, detuneCents/subGain from VIKINGS, lpQ for filterQ)

    // ── BAGPIPES (Fourier pulse chanter + sine drone) ──────────────────────────
    float pulseWidth   { 0.22f  }; // pulse width 0..1
    float droneGain    { 0.35f  }; // drone sine gain
    float droneLPHz    { 280.f  }; // drone LP cutoff (unused in basic impl.)
    float bagVibDepth  { 0.008f }; // vibrato depth (freq ratio)
    // (reuses lfoFreq from SCIFI for vibrato rate, lpQ for nasal Q)

    // ── JOLA_EP (Rhodes-style electric piano) ─────────────────────────────────
    float tremoloRate  { 3.0f   }; // tremolo LFO rate in Hz
    float tremoloDepth { 0.08f  }; // tremolo amplitude depth
    float clickAmount  { 0.15f  }; // key-click transient gain
    float epDecayTime  { 1.5f   }; // EP internal decay to sustain
    float sustainLevel { 0.20f  }; // EP sustain level (0..1)
    float warmth       { 1.8f   }; // tape warmth saturation drive
    // (reuses legLpHz/legLpQ for filter, detuneCents for chorus)
};

// ─────────────────────────────────────────────────────────────────────────────
// Folder metadata
// ─────────────────────────────────────────────────────────────────────────────
struct FolderInfo
{
    juce::String label;
    juce::Colour colour;
};

// ─────────────────────────────────────────────────────────────────────────────
// Simple biquad lowpass (Direct Form II)
// ─────────────────────────────────────────────────────────────────────────────
struct BiquadLP
{
    double b0{1}, b1{0}, b2{0}, a1{0}, a2{0};
    double x1{0}, x2{0}, y1{0}, y2{0};

    void setCoeffs(double cutoff, double sampleRate, double Q)
    {
        double w0    = juce::MathConstants<double>::twoPi * cutoff / sampleRate;
        double cosw0 = std::cos(w0);
        double alpha = std::sin(w0) / (2.0 * Q);
        double a0    = 1.0 + alpha;
        b0 = (1.0 - cosw0) * 0.5 / a0;
        b1 = (1.0 - cosw0)       / a0;
        b2 = b0;
        a1 = (-2.0 * cosw0)      / a0;
        a2 = (1.0 - alpha)       / a0;
    }

    double process(double x)
    {
        double y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2;
        x2 = x1; x1 = x;
        y2 = y1; y1 = y;
        return y;
    }
    void reset() { x1=x2=y1=y2=0.0; }
};

// ─────────────────────────────────────────────────────────────────────────────
// SynthSound — required by JUCE Synthesiser
// ─────────────────────────────────────────────────────────────────────────────
struct SynthSound : public juce::SynthesiserSound
{
    bool appliesToNote    (int) override { return true; }
    bool appliesToChannel (int) override { return true; }
};

// ─────────────────────────────────────────────────────────────────────────────
// SynthVoice
// ─────────────────────────────────────────────────────────────────────────────
class SynthVoice : public juce::SynthesiserVoice
{
public:
    SynthVoice();

    void setCurrentPreset (const PresetParams* p) { currentPreset = p; }

    bool canPlaySound (juce::SynthesiserSound* s) override { return dynamic_cast<SynthSound*>(s) != nullptr; }

    void startNote (int midiNote, float velocity,
                    juce::SynthesiserSound*, int) override;

    void stopNote  (float velocity, bool allowTailOff) override;

    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}

    void renderNextBlock (juce::AudioBuffer<float>& buffer,
                          int startSample, int numSamples) override;

    void prepareToPlay (double sr, int /*blockSize*/)
    {
        sampleRate = sr;
        filter.reset();
        droneFilter.reset();
    }

private:
    // ── state ────────────────────────────────────────────────────────────────
    const PresetParams* currentPreset { nullptr };
    double  sampleRate  { 44100.0 };
    double  freq        { 440.0   };
    double  time        { 0.0     };   // seconds since note-on

    // Phases (up to 5 oscillators + LFO + drift)
    std::array<double, 5> phase  {};
    double  lfoPhase    { 0.0 };
    double  driftPhase  { 0.0 };

    // Envelope
    double  envGain     { 0.0 };
    bool    noteOn      { false };
    bool    releasing   { false };
    double  releaseGain { 0.0  }; // gain at moment of release

    // Filters
    BiquadLP filter;
    BiquadLP droneFilter;   // used by BAGPIPES drone
    int  filterUpdateCounter { 0 };

    // BASS808: pitch slide
    double currentFreq  { 0.0 };
    double targetFreq   { 0.0 };

    // ── per-engine render ────────────────────────────────────────────────────
    double renderSCIFI    ();
    double renderVIKINGS  ();
    double renderGYM      ();
    double renderBASS808  ();
    double renderVAPOR    ();
    double renderHORROR   ();
    double renderLegacy   ();
    double renderSAMURAI  ();
    double renderCHERNOBYL();
    double renderPIRATES  ();
    double renderTRIBAL   ();
    double renderGUITAR   ();
    double renderBAGPIPES ();
    double renderJOLA_EP  ();

    // ── helpers ──────────────────────────────────────────────────────────────
    double sawSample    (double ph) const { return 1.0 - 2.0 * ph; }
    double squareSample (double ph) const { return ph < 0.5 ? 1.0 : -1.0; }
    double triSample    (double ph) const { return ph < 0.5 ? 4.0*ph - 1.0 : 3.0 - 4.0*ph; }
    double advPhase     (double& ph, double f) const;

    double tanh_approx  (double x) const
    {
        // fast tanh approximation
        double x2 = x*x;
        return x * (27.0 + x2) / (27.0 + 9.0*x2);
    }

    double softclip (double x, double amount) const
    {
        double driven = x * amount;
        return tanh_approx(driven) / std::max(tanh_approx(amount), 0.001);
    }

    double bitcrush (double x, int steps) const
    {
        if (steps <= 0) return x;
        double s = (double)steps;
        return std::round(x * s) / s;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// AudioProcessor
// ─────────────────────────────────────────────────────────────────────────────
class SoulForgeSynthAudioProcessor : public juce::AudioProcessor
{
public:
    SoulForgeSynthAudioProcessor();
    ~SoulForgeSynthAudioProcessor() override = default;

    // ── AudioProcessor interface ──────────────────────────────────────────────
    void prepareToPlay  (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock   (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool   acceptsMidi()  const override { return true;  }
    bool   producesMidi() const override { return false; }
    bool   isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 2.0; }

    int  getNumPrograms()    override { return (int)bank.size(); }
    int  getCurrentProgram() override { return currentProgram; }
    void setCurrentProgram (int index) override;
    const juce::String getProgramName (int index) override;
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    // ── Public data ───────────────────────────────────────────────────────────
    std::vector<PresetParams>                   bank;
    std::map<juce::String, FolderInfo>          folders;
    std::vector<juce::String>                   folderOrder;

    juce::AudioProcessorValueTreeState apvts;

    int currentProgram { 0 };

private:
    static constexpr int NUM_VOICES = 16;

    juce::Synthesiser synth;

    // DSP chain (reverb + chorus applied globally after synth)
    juce::dsp::Reverb     reverb;
    juce::dsp::Chorus<float> chorus;

    void buildBank();
    void addPreset (const juce::String& folder,
                    const PresetParams& p);

    static juce::AudioProcessorValueTreeState::ParameterLayout createParams();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SoulForgeSynthAudioProcessor)
};
