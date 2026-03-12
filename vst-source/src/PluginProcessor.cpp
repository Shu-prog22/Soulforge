#include "PluginProcessor.h"
#include "PluginEditor.h"

using namespace juce;

// ═════════════════════════════════════════════════════════════════════════════
// SynthVoice — implementation
// ═════════════════════════════════════════════════════════════════════════════

SynthVoice::SynthVoice()
{
    phase.fill(0.0);
}

double SynthVoice::advPhase(double& ph, double f) const
{
    ph += f / sampleRate;
    while (ph >= 1.0) ph -= 1.0;
    return ph;
}

void SynthVoice::startNote(int midiNote, float /*velocity*/,
                            SynthesiserSound*, int)
{
    freq         = 440.0 * std::pow(2.0, (midiNote - 69) / 12.0);
    currentFreq  = freq;
    targetFreq   = freq;
    time         = 0.0;
    noteOn       = true;
    releasing    = false;
    envGain      = 0.0;
    lfoPhase     = 0.0;
    driftPhase   = 0.0;
    phase.fill(0.0);
    filter.reset();
    droneFilter.reset();
    filterUpdateCounter = 0;

    // BASS808: start slide
    if (currentPreset && currentPreset->engine == EngineType::BASS808)
    {
        currentFreq = freq * currentPreset->slideFrom;
        targetFreq  = freq * currentPreset->slideTarget;
    }
}

void SynthVoice::stopNote(float, bool allowTailOff)
{
    if (allowTailOff)
    {
        releasing    = true;
        releaseGain  = envGain;
    }
    else
    {
        clearCurrentNote();
        noteOn    = false;
        releasing = false;
        envGain   = 0.0;
    }
}

void SynthVoice::renderNextBlock(AudioBuffer<float>& buffer,
                                  int startSample, int numSamples)
{
    if (!isVoiceActive()) return;
    if (!currentPreset)   return;

    const double attackTime  = (double)currentPreset->atk;
    const double releaseTime = (double)currentPreset->rel;
    const double invAttack   = attackTime > 0.0 ? 1.0 / (attackTime  * sampleRate) : 1.0;
    const double invRelease  = releaseTime> 0.0 ? 1.0 / (releaseTime * sampleRate) : 1.0;

    auto* leftData  = buffer.getWritePointer(0, startSample);
    auto* rightData = buffer.getNumChannels() > 1
                    ? buffer.getWritePointer(1, startSample) : nullptr;

    for (int i = 0; i < numSamples; ++i)
    {
        // ── Envelope ──────────────────────────────────────────────────────────
        if (!releasing)
        {
            if (envGain < 1.0)
                envGain = jmin(1.0, envGain + invAttack);
        }
        else
        {
            envGain -= invRelease * releaseGain;
            if (envGain <= 0.0)
            {
                envGain = 0.0;
                clearCurrentNote();
                noteOn    = false;
                releasing = false;
                return;
            }
        }

        // ── BASS808 pitch slide ───────────────────────────────────────────────
        if (currentPreset->engine == EngineType::BASS808)
        {
            if (currentFreq > targetFreq)
            {
                double slideSamples = currentPreset->slideDur * sampleRate;
                double step = (currentFreq - targetFreq) / jmax(slideSamples, 1.0);
                currentFreq = jmax(targetFreq, currentFreq - step);
            }
        }

        // ── Synthesis ─────────────────────────────────────────────────────────
        double sample = 0.0;
        switch (currentPreset->engine)
        {
            case EngineType::SCIFI:     sample = renderSCIFI();     break;
            case EngineType::VIKINGS:   sample = renderVIKINGS();   break;
            case EngineType::GYM:       sample = renderGYM();       break;
            case EngineType::BASS808:   sample = renderBASS808();   break;
            case EngineType::VAPOR:     sample = renderVAPOR();     break;
            case EngineType::HORROR:    sample = renderHORROR();    break;
            case EngineType::SAMURAI:   sample = renderSAMURAI();   break;
            case EngineType::CHERNOBYL: sample = renderCHERNOBYL(); break;
            case EngineType::PIRATES:   sample = renderPIRATES();   break;
            case EngineType::TRIBAL:    sample = renderTRIBAL();    break;
            case EngineType::GUITAR:    sample = renderGUITAR();    break;
            case EngineType::BAGPIPES:  sample = renderBAGPIPES();  break;
            case EngineType::JOLA_EP:   sample = renderJOLA_EP();   break;
            default:                    sample = renderLegacy();    break;
        }

        // ── Filter update (every 16 samples) ─────────────────────────────────
        if (++filterUpdateCounter >= 16)
        {
            filterUpdateCounter = 0;

            double cutoff = freq * 4.0;
            double Q      = 0.7;

            if (currentPreset->engine == EngineType::SCIFI)
            {
                double lfoVal = std::sin(lfoPhase * MathConstants<double>::twoPi);
                cutoff = freq * (3.0 + lfoVal * currentPreset->lfoDepth);
                Q      = currentPreset->lpQ;
            }
            else if (currentPreset->engine == EngineType::VIKINGS)
            {
                cutoff = currentPreset->vikLpHz;
                Q      = 0.8;
            }
            else if (currentPreset->engine == EngineType::HORROR)
            {
                cutoff = currentPreset->horLpHz;
                Q      = currentPreset->horLpQ;
            }
            else if (currentPreset->engine == EngineType::VAPOR)
            {
                double t     = jmin(time / currentPreset->sweepTime, 1.0);
                cutoff       = currentPreset->lpStartHz + t * (currentPreset->lpEndHz - currentPreset->lpStartHz);
                Q            = 1.2;
            }
            else if (currentPreset->engine == EngineType::Legacy)
            {
                cutoff = currentPreset->legLpHz;
                Q      = currentPreset->legLpQ;
            }
            else if (currentPreset->engine == EngineType::SAMURAI)
            {
                // Resonant LP closes after a short time (pluck brightness)
                double t = jmin(time / 0.12, 1.0);
                cutoff   = 6000.0 * std::exp(-t * 2.5) + freq * 1.5;
                Q        = currentPreset->lpQ;
            }
            else if (currentPreset->engine == EngineType::CHERNOBYL)
            {
                cutoff = freq * 5.0;
                Q      = 0.7;
            }
            else if (currentPreset->engine == EngineType::PIRATES)
            {
                // Bandpass-like: LP with high Q centred around freq*2
                cutoff = freq * 2.5;
                Q      = currentPreset->lpQ;
            }
            else if (currentPreset->engine == EngineType::TRIBAL)
            {
                cutoff = currentPreset->formantHz;
                Q      = 3.5;
            }
            else if (currentPreset->engine == EngineType::GUITAR)
            {
                double t = jmin(time / jmax((double)currentPreset->filterTime, 0.001), 1.0);
                cutoff   = currentPreset->filterOpen
                         + t * (currentPreset->filterClose - currentPreset->filterOpen);
                Q        = currentPreset->lpQ;
            }
            else if (currentPreset->engine == EngineType::BAGPIPES)
            {
                cutoff = 3200.0; // brightness / nasalness
                Q      = currentPreset->lpQ;
                // Update drone filter (sawtooth at freq/2)
                double droneCut = jlimit(20.0, sampleRate * 0.45,
                                         (double)currentPreset->droneLPHz);
                droneFilter.setCoeffs(droneCut, sampleRate, 0.7);
            }
            else if (currentPreset->engine == EngineType::JOLA_EP)
            {
                cutoff = currentPreset->legLpHz;
                Q      = currentPreset->legLpQ;
            }

            cutoff = jlimit(20.0, sampleRate * 0.45, cutoff);
            filter.setCoeffs(cutoff, sampleRate, jmax(Q, 0.1));
        }

        double filtered = filter.process(sample) * envGain;
        filtered = jlimit(-1.0, 1.0, filtered);

        float outSample = (float)filtered;
        leftData[i] += outSample;
        if (rightData) rightData[i] += outSample;

        time += 1.0 / sampleRate;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINES — C++ translation of the JS ENGINES object
// ─────────────────────────────────────────────────────────────────────────────

double SynthVoice::renderSCIFI()
{
    const auto& p = *currentPreset;

    double modFreq = freq * p.modRatio;
    double t       = jmin(time / 0.6, 1.0);
    double mi      = p.modIndex * (1.0 - t * 0.75);

    double modSample = std::sin(phase[1] * MathConstants<double>::twoPi);
    double phDev     = modSample * mi;

    double carrier = std::sin(phase[0] * MathConstants<double>::twoPi + phDev);

    advPhase(phase[0], freq);
    advPhase(phase[1], modFreq);
    advPhase(lfoPhase, p.lfoFreq);

    return carrier * 0.55;
}

double SynthVoice::renderVIKINGS()
{
    const auto& p = *currentPreset;

    double out = 0.0;
    double offsets[3] = { -p.detuneCents, 0.0, p.detuneCents };
    int    numOsc     = jlimit(1, 3, p.waves);

    for (int i = 0; i < numOsc; ++i)
    {
        double cents = (numOsc == 1) ? 0.0 : (numOsc == 2 ? offsets[i == 0 ? 0 : 2] : offsets[i]);
        double f = freq * std::pow(2.0, cents / 1200.0);
        out += sawSample(phase[i]);
        advPhase(phase[i], f);
    }
    out *= 0.30;

    // sub sine
    double sub = std::sin(phase[3] * MathConstants<double>::twoPi) * p.subGain;
    advPhase(phase[3], freq * 0.5);
    out += sub;

    // tanh saturation
    return tanh_approx(out * p.saturation) / jmax(tanh_approx(p.saturation), 0.001) * 0.85;
}

double SynthVoice::renderGYM()
{
    const auto& p = *currentPreset;

    double wave = (p.gymWave == 0) ? squareSample(phase[0]) : sawSample(phase[0]);
    advPhase(phase[0], freq);

    // hard clip
    double clipped = jlimit((double)-p.clipAmount, (double)p.clipAmount, wave * 2.0) / (double)p.clipAmount * 0.85;

    // sub
    if (p.gymSub > 0.0f)
    {
        double sub = std::sin(phase[1] * MathConstants<double>::twoPi) * p.gymSub;
        advPhase(phase[1], freq * 0.5);
        clipped += sub;
    }
    return clipped * 0.50;
}

double SynthVoice::renderBASS808()
{
    const auto& p = *currentPreset;

    double sample = std::sin(phase[0] * MathConstants<double>::twoPi);
    advPhase(phase[0], currentFreq);

    // distortion
    double driven = softclip(sample, p.distAmount) * 0.82;

    // sub
    if (p.b8Sub > 0.0f)
    {
        double sub = std::sin(phase[1] * MathConstants<double>::twoPi) * p.b8Sub;
        advPhase(phase[1], currentFreq * 0.5);
        driven += sub;
    }
    return driven * 0.88;
}

double SynthVoice::renderVAPOR()
{
    const auto& p = *currentPreset;

    // LFO vibrato per voice (slow)
    double offsets[3] = { -(double)p.detuneCents, 0.0, (double)p.detuneCents };
    double out = 0.0;

    for (int i = 0; i < 3; ++i)
    {
        double lfoVal = std::sin(phase[3 + (i == 0 ? 0 : i)] * MathConstants<double>::twoPi);
        // Use lfoPhase variants per voice
        double vibrHz = p.vapVibRate + i * 0.06;
        double cents  = offsets[i];
        double f = freq * std::pow(2.0, cents / 1200.0) * (1.0 + lfoVal * 0.004);
        double sample = 0.0;
        switch (p.vapWave)
        {
            case 0: sample = sawSample(phase[i]); break;
            case 1: sample = triSample(phase[i]); break;
            default: sample = std::sin(phase[i] * MathConstants<double>::twoPi); break;
        }
        out += sample;
        advPhase(phase[i], f);
        advPhase(phase[3 + i], vibrHz);
    }
    return out * 0.25;
}

double SynthVoice::renderHORROR()
{
    const auto& p = *currentPreset;

    // drift LFO (very slow, 0.12 Hz)
    double driftVal = std::sin(driftPhase * MathConstants<double>::twoPi) * p.driftAmount;
    advPhase(driftPhase, 0.12);

    // osc 1: sawtooth + drift
    double f1 = freq * (1.0 + driftVal);
    double s1 = sawSample(phase[0]);
    advPhase(phase[0], f1);

    // osc 2: slightly detuned (near-unison dissonance)
    double f2 = freq * p.horModRatio;
    double s2 = sawSample(phase[1]) * 0.35;
    advPhase(phase[1], f2);

    // bitcrusher on osc 1
    double crushed = bitcrush(s1, p.bitSteps) * 0.45;

    return (crushed + s2) * 0.7;
}

double SynthVoice::renderLegacy()
{
    const auto& p = *currentPreset;

    // 3 detuned oscillators
    double offsets[3] = { -(double)p.legDetune, 0.0, (double)p.legDetune };
    double out = 0.0;

    for (int i = 0; i < 3; ++i)
    {
        double f = freq * std::pow(2.0, offsets[i] / 1200.0);
        double s = 0.0;
        switch (p.legWave)
        {
            case 0: s = std::sin(phase[i] * MathConstants<double>::twoPi); break;
            case 1: s = triSample(phase[i]);   break;
            case 2: s = sawSample(phase[i]);   break;
            case 3: s = squareSample(phase[i]); break;
        }
        out += s;
        advPhase(phase[i], f);
    }

    // optional sub
    if (p.legSubGain > 0.0f)
    {
        double sub = std::sin(phase[4] * MathConstants<double>::twoPi) * p.legSubGain;
        advPhase(phase[4], freq * 0.5);
        out += sub;
    }

    return out * 0.18;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMURAI — pluck boisé (triangle + 2nd harmonic, pluck envelope)
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderSAMURAI()
{
    const auto& p = *currentPreset;

    double pluckEnv = std::exp(-time / jmax((double)p.pluckDecay, 0.001));

    // Triangle body
    double body = triSample(phase[0]);
    advPhase(phase[0], freq);

    // 2nd harmonic "snap"
    double harm = triSample(phase[1]) * p.harmMix;
    advPhase(phase[1], freq * 2.0);

    return (body + harm) * pluckEnv * 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHERNOBYL — square + bitcrusher + noise
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderCHERNOBYL()
{
    const auto& p = *currentPreset;

    double osc = squareSample(phase[0]);
    advPhase(phase[0], freq);

    // Bitcrusher
    double crushed = bitcrush(osc, p.bitSteps);

    // Pseudo-noise via fast hash counter
    driftPhase += 1.0;
    if (driftPhase > 1.0e9) driftPhase = 0.0;
    double noise = std::sin(driftPhase * 127.1 + phase[0] * 311.7) * p.noiseAmt;

    double mixed = crushed * (1.0 - p.noiseAmt * 0.5) + noise;
    return softclip(mixed, p.saturation) * 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIRATES — 3 detuned saws + per-osc vibrato LFO
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderPIRATES()
{
    const auto& p = *currentPreset;

    double offsets[3] = { -(double)p.detuneCents, 0.0, (double)p.detuneCents };
    double out = 0.0;

    for (int i = 0; i < 3; ++i)
    {
        double lfoVal = std::sin((lfoPhase + i * 0.33) * MathConstants<double>::twoPi);
        double f      = freq * std::pow(2.0, offsets[i] / 1200.0) * (1.0 + lfoVal * p.vibDepth);
        out += sawSample(phase[i]);
        advPhase(phase[i], f);
    }
    advPhase(lfoPhase, p.vibRate);

    return out * 0.28;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIBAL — click transient + triangle body, formant LP
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderTRIBAL()
{
    const auto& p = *currentPreset;

    // Short click at start (sine at freq*5)
    double click = 0.0;
    if (time < 0.018)
    {
        double cEnv = std::exp(-time * 350.0);
        click = std::sin(phase[1] * MathConstants<double>::twoPi) * cEnv * p.punch * 0.5;
        advPhase(phase[1], freq * 5.0);
    }

    // Triangle body
    double body = triSample(phase[0]);
    advPhase(phase[0], freq);

    return (body + click) * 0.45;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUITAR — sawtooth/square + filter envelope + pluck decay
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderGUITAR()
{
    const auto& p = *currentPreset;

    // Pluck amplitude decay
    double pluckEnv = std::exp(-time / jmax((double)p.bodyDecay, 0.001));

    // Main oscillator
    double osc = (p.guitWave == 0) ? sawSample(phase[0]) : squareSample(phase[0]);
    advPhase(phase[0], freq);

    // Optional detuned chorus oscillator
    if (p.detuneCents > 0.0f)
    {
        double f2 = freq * std::pow(2.0, (double)p.detuneCents / 1200.0);
        osc += sawSample(phase[1]) * 0.28;
        advPhase(phase[1], f2);
        osc *= 0.85;
    }

    // Soft saturation
    osc = softclip(osc, p.distAmount);

    // Optional sub
    if (p.subGain > 0.0f)
    {
        double sub = std::sin(phase[2] * MathConstants<double>::twoPi) * p.subGain;
        advPhase(phase[2], freq * 0.5);
        osc += sub;
    }

    return osc * pluckEnv * 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────
// BAGPIPES — Fourier-series pulse chanter + sine drone
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderBAGPIPES()
{
    const auto& p = *currentPreset;

    // Vibrato LFO (lfoFreq = vibratoRate)
    double lfoVal  = std::sin(lfoPhase * MathConstants<double>::twoPi);
    double vibMod  = 1.0 + lfoVal * p.bagVibDepth;
    advPhase(lfoPhase, p.lfoFreq);

    // Fourier-series pulse (8 harmonics)
    double pw    = jlimit(0.05, 0.95, (double)p.pulseWidth);
    double pulse = 0.0;
    for (int n = 1; n <= 8; ++n)
    {
        double coeff = std::sin(n * MathConstants<double>::pi * pw)
                     / (n * MathConstants<double>::pi) * 2.0;
        pulse += coeff * std::sin(n * phase[0] * MathConstants<double>::twoPi);
    }
    advPhase(phase[0], freq * vibMod);

    // Sine drone at freq/2, filtered through droneFilter
    double rawDrone     = std::sin(driftPhase * MathConstants<double>::twoPi);
    double filteredDrone = droneFilter.process(rawDrone) * p.droneGain;
    advPhase(driftPhase, freq * 0.5);

    return (pulse + filteredDrone) * 0.42;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOLA_EP — Rhodes-style electric piano (sine+tri, tremolo, click, chorus)
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderJOLA_EP()
{
    const auto& p = *currentPreset;

    // Internal EP envelope (fast decay to sustain level)
    double dt    = jmax((double)p.epDecayTime, 0.001);
    double epEnv = p.sustainLevel + (1.0 - p.sustainLevel) * std::exp(-time / (dt * 0.5));

    // Tremolo LFO
    double lfoVal    = std::sin(lfoPhase * MathConstants<double>::twoPi);
    double tremoloMod = 1.0 - p.tremoloDepth + p.tremoloDepth * (0.5 + 0.5 * lfoVal);
    advPhase(lfoPhase, p.tremoloRate);

    // Sine (70%) + Triangle (30%) core
    double sinePart = std::sin(phase[0] * MathConstants<double>::twoPi) * 0.70;
    double triPart  = triSample(phase[1]) * 0.30;
    advPhase(phase[0], freq);
    advPhase(phase[1], freq);

    // Chorus detuned sines (±detuneCents)
    if (p.detuneCents > 0.0f)
    {
        double f2  = freq * std::pow(2.0,  (double)p.detuneCents / 1200.0);
        double f3  = freq * std::pow(2.0, -(double)p.detuneCents / 1200.0);
        sinePart += std::sin(phase[2] * MathConstants<double>::twoPi) * 0.22;
        sinePart += std::sin(phase[3] * MathConstants<double>::twoPi) * 0.22;
        advPhase(phase[2], f2);
        advPhase(phase[3], f3);
        sinePart *= 0.65;
    }

    double mixed = sinePart + triPart;

    // Tape warmth (soft saturation)
    mixed = softclip(mixed, p.warmth);

    // Key-click transient
    if (time < 0.012)
    {
        double clickEnv = std::exp(-time * 600.0);
        double click    = squareSample(phase[4]) * clickEnv * p.clickAmount;
        advPhase(phase[4], freq * 5.0);
        mixed += click;
    }

    return mixed * epEnv * tremoloMod * 0.50;
}

// ═════════════════════════════════════════════════════════════════════════════
// SoulForgeSynthAudioProcessor
// ═════════════════════════════════════════════════════════════════════════════

juce::AudioProcessorValueTreeState::ParameterLayout
SoulForgeSynthAudioProcessor::createParams()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    params.push_back(std::make_unique<AudioParameterFloat>(
        "volume", "Volume", 0.0f, 1.0f, 0.75f));
    params.push_back(std::make_unique<AudioParameterFloat>(
        "attack",  "Attack",  0.001f, 3.0f, 0.01f));
    params.push_back(std::make_unique<AudioParameterFloat>(
        "release", "Release", 0.05f,  6.0f, 1.0f));
    params.push_back(std::make_unique<AudioParameterFloat>(
        "filter",  "Filter",  0.0f,   1.0f, 0.7f));
    params.push_back(std::make_unique<AudioParameterFloat>(
        "reverb",  "Reverb",  0.0f,   1.0f, 0.2f));
    params.push_back(std::make_unique<AudioParameterFloat>(
        "chorus",  "Chorus",  0.0f,   1.0f, 0.18f));
    params.push_back(std::make_unique<AudioParameterInt>(
        "preset",  "Preset",  0, 999, 0));

    return { params.begin(), params.end() };
}

SoulForgeSynthAudioProcessor::SoulForgeSynthAudioProcessor()
    : AudioProcessor(BusesProperties()
                         .withOutput("Output", AudioChannelSet::stereo(), true))
    , apvts(*this, nullptr, "STATE", createParams())
{
    synth.addSound(new SynthSound());
    for (int i = 0; i < NUM_VOICES; ++i)
        synth.addVoice(new SynthVoice());

    buildBank();
}

void SoulForgeSynthAudioProcessor::addPreset(const String& folder, const PresetParams& p)
{
    PresetParams copy = p;
    copy.folder = folder;
    bank.push_back(copy);
}

// ─────────────────────────────────────────────────────────────────────────────
// BANK — all 450+ presets
// Structured as: addPreset("FOLDER_KEY", { params });
// ─────────────────────────────────────────────────────────────────────────────
void SoulForgeSynthAudioProcessor::buildBank()
{
    folderOrder = { "PADS","BASS","GHIBLI","DS","SCIFI","VIKINGS","GYM","BASS808","VAPOR","HORROR",
                    "SAMURAI","CHERNOBYL","PIRATES","TRIBAL","CURIOSITY","XFILES",
                    "FLUTES","GUITARS","BAGPIPES","JOLA_EP" };

    folders["PADS"]      = { "PADS",      Colour(0xffe03030) };
    folders["BASS"]      = { "BASS",      Colour(0xffe04040) };
    folders["GHIBLI"]    = { "GHIBLI",    Colour(0xff4caf50) };
    folders["DS"]        = { "DS",        Colour(0xffe040fb) };
    folders["SCIFI"]     = { "SCI-FI",    Colour(0xff00e5ff) };
    folders["VIKINGS"]   = { "VIKINGS",   Colour(0xff8b4513) };
    folders["GYM"]       = { "GYM",       Colour(0xffff6600) };
    folders["BASS808"]   = { "808",       Colour(0xffff3300) };
    folders["VAPOR"]     = { "VAPOR",     Colour(0xffff44cc) };
    folders["HORROR"]    = { "HORROR",    Colour(0xff880000) };
    folders["SAMURAI"]   = { "SAMURAI",   Colour(0xffcc2200) };
    folders["CHERNOBYL"] = { "CHERNOBYL", Colour(0xff33ff00) };
    folders["PIRATES"]   = { "PIRATES",   Colour(0xffcc8800) };
    folders["TRIBAL"]    = { "TRIBAL",    Colour(0xffcc6600) };
    folders["CURIOSITY"] = { "CURIOSITY", Colour(0xffcc4400) };
    folders["XFILES"]    = { "X-FILES",   Colour(0xff4444aa) };
    folders["FLUTES"]    = { "FLUTES",    Colour(0xffaaddff) };
    folders["GUITARS"]   = { "GUITARS",   Colour(0xffcc8844) };
    folders["BAGPIPES"]  = { "BAGPIPES",  Colour(0xff00aa44) };
    folders["JOLA_EP"]   = { "JOLA EP",   Colour(0xffcc8833) };

    // ── PADS (legacy engine — sine/triangle detuned) ──────────────────────────
    auto pad = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                   int wave, float det, float lp, float Q, float sub = 0.0f)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=wave; p.legDetune=det;
        p.legLpHz=lp; p.legLpQ=Q; p.legSubGain=sub;
        addPreset("PADS", p);
    };
    //           id        name       colour      atk   rel  wave det  lp    Q    sub
    pad("bleed","BLEED",  0xffe03030, 0.4f, 2.0f, 2, 12,  800,  0.7f);
    pad("void", "VOID",   0xff6030e0, 2.5f, 3.0f, 0,  6,  400,  0.5f);
    pad("frost","FROST",  0xff30b0e0, 0.2f, 1.5f, 1,  8, 2000,  0.8f);
    pad("ember","EMBER",  0xffe07030, 0.3f, 1.8f, 2, 10, 1200,  0.6f);
    pad("lunar","LUNAR",  0xffc0a0ff, 0.8f, 2.5f, 1,  5,  600,  0.5f);
    pad("ghost","GHOST",  0xffe0e0e0, 1.0f, 3.0f, 0,  4, 3000,  1.2f);
    pad("neon", "NEON",   0xffff44ff, 0.1f, 1.2f, 2, 14, 4000,  1.5f);
    pad("aura", "AURA",   0xff88aaff, 0.6f, 2.8f, 1,  7, 1000,  0.6f);
    pad("dusk", "DUSK",   0xffff8833, 1.2f, 3.5f, 0,  9,  700,  0.5f);
    pad("dawn", "DAWN",   0xffffffaa, 1.5f, 4.0f, 1,  5,  900,  0.5f);
    pad("haze", "HAZE",   0xffccbbff, 1.8f, 4.5f, 2, 14,  500,  0.4f);
    pad("silk", "SILK",   0xffffeeff, 0.6f, 2.8f, 1,  4, 1500,  0.7f);
    pad("steel","STEEL",  0xffaaaacc, 0.05f,1.5f, 2,  6, 3500,  1.8f);
    pad("cave", "CAVE",   0xff334455, 0.5f, 2.5f, 0,  8,  500,  0.5f);
    pad("cloud","CLOUD",  0xffcceeff, 2.5f, 5.0f, 1, 20,  300,  0.4f);
    pad("fire", "FIRE",   0xffff4400, 0.2f, 1.8f, 2, 16, 2500,  1.0f);
    pad("ice",  "ICE",    0xffaaddff, 0.3f, 2.2f, 0,  5, 5000,  2.0f);
    pad("dark", "DARK",   0xff110011, 1.0f, 3.5f, 3,  8,  300,  0.4f, 0.3f);
    pad("warm", "WARM",   0xffddaa66, 0.4f, 2.0f, 1,  6, 1800,  0.6f);
    pad("deep", "DEEP",   0xff2233aa, 0.6f, 3.0f, 0,  4,  250,  0.4f, 0.5f);

    // ── BASS (legacy — saw / square with sub) ─────────────────────────────────
    auto bass = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                    int wave, float det, float lp, float Q, float sub = 0.0f)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=wave; p.legDetune=det;
        p.legLpHz=lp; p.legLpQ=Q; p.legSubGain=sub;
        addPreset("BASS", p);
    };
    bass("sub808","808",   0xffe04040, 0.005f,2.5f, 0, 0,  400, 0.5f, 0.3f);
    bass("sub",   "SUB",   0xffa060ff, 0.01f, 1.2f, 0, 0,  300, 0.4f, 0.5f);
    bass("acid",  "ACID",  0xffc0ff30, 0.002f,0.5f, 2, 0, 2000, 8.0f);
    bass("growl", "GROWL", 0xff805000, 0.008f,1.0f, 3, 5, 1200, 3.0f, 0.2f);
    bass("reese", "REESE", 0xff4060d0, 0.01f, 1.2f, 2, 8, 1500, 0.7f);
    bass("wobble","WOBBLE",0xff60a0e0, 0.005f,0.8f, 2, 5, 1800, 4.0f);
    bass("pluck", "PLUCK", 0xffe0c060, 0.001f,0.8f, 1, 0, 3000, 0.5f);
    bass("moog",  "MOOG",  0xffff6020, 0.01f, 1.0f, 2, 0, 1000, 2.0f, 0.2f);
    bass("fuzz",  "FUZZ",  0xffcc2020, 0.002f,0.6f, 3, 0, 2000, 1.0f, 0.3f);
    bass("punch", "PUNCH", 0xffff4000, 0.001f,0.5f, 0, 0,  800, 0.5f, 0.4f);
    bass("orbit", "ORBIT", 0xff8040ff, 0.005f,0.9f, 0, 0, 1200, 0.6f, 0.3f);
    bass("tape",  "TAPE",  0xffc08050, 0.015f,1.0f, 2, 4,  900, 0.6f);
    bass("harm",  "HARM",  0xff40e080, 0.01f, 1.5f, 0, 0, 4000, 0.5f);
    bass("funk",  "FUNK",  0xffffcc00, 0.003f,0.7f, 3, 0, 3000, 6.0f, 0.2f);
    bass("metal", "METAL", 0xff80a0c0, 0.005f,1.0f, 2, 7, 2500, 1.5f, 0.2f);
    bass("glitch","GLITCH",0xff00ffcc, 0.001f,0.5f, 2,10, 3000, 1.0f);
    bass("mono",  "MONO",  0xffe0e0a0, 0.01f, 0.8f, 2, 0, 1800, 0.7f, 0.25f);
    bass("piano", "PIANO", 0xfff0d080, 0.002f,1.5f, 1, 0, 4000, 0.5f);
    bass("dist",  "DIST",  0xff800020, 0.002f,0.6f, 2, 0, 2000, 0.5f, 0.3f);
    bass("stack", "STACK", 0xffc0a0e0, 0.004f,0.8f, 2,10, 2500, 1.0f, 0.3f);
    bass("deep",  "DEEP",  0xff2040a0, 0.05f, 2.5f, 0, 0,  200, 0.4f, 0.6f);
    bass("trap",  "TRAP",  0xffcc2040, 0.003f,3.0f, 0, 0,  600, 0.4f, 0.2f);
    bass("wind",  "WIND",  0xffa0c0d0, 0.002f,0.7f, 1, 0, 2000, 0.5f);
    bass("hum",   "HUM",   0xff6080c0, 0.003f,1.1f, 3, 5, 1800, 0.7f);
    bass("anlog", "ANLOG", 0xffd4a040, 0.008f,1.0f, 2, 0, 1400, 0.8f);

    // ── GHIBLI (legacy — sine/triangle, gentle filter) ────────────────────────
    auto gh = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  int wave, float det, float lp, float Q)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=wave; p.legDetune=det;
        p.legLpHz=lp; p.legLpQ=Q;
        addPreset("GHIBLI", p);
    };
    gh("gh_musicbox","MUSIC BOX", 0xfff0e0a0, 0.001f,1.8f, 0, 0, 8000, 0.5f);
    gh("gh_flute",   "FLUTE",     0xffa0d0ff, 0.06f, 1.2f, 0, 2, 5000, 0.4f);
    gh("gh_accord",  "ACCORDION", 0xffe08040, 0.03f, 0.9f, 2, 8, 4000, 0.5f);
    gh("gh_celesta", "CELESTA",   0xffd0e8ff, 0.001f,2.2f, 0, 0, 9000, 0.4f);
    gh("gh_harp",    "HARP",      0xffc8f0b0, 0.001f,1.5f, 0, 2, 7000, 0.4f);
    gh("gh_strings", "STRINGS",   0xfff0c0b0, 0.25f, 2.0f, 2, 12,3000, 0.5f);
    gh("gh_oboe",    "OBOE",      0xffd0a060, 0.04f, 0.8f, 2, 0, 5000, 0.5f);
    gh("gh_bells",   "BELLS",     0xffb0e0ff, 0.001f,3.0f, 0, 0,10000, 0.4f);
    gh("gh_horn",    "HORN",      0xffe8c060, 0.12f, 1.0f, 1, 0, 2500, 0.6f);
    gh("gh_marimba", "MARIMBA",   0xffc0a060, 0.001f,0.9f, 1, 0, 5000, 0.4f);
    gh("gh_koto",    "KOTO",      0xfff0d0a0, 0.001f,1.3f, 0, 0, 6000, 0.4f);
    gh("gh_shaku",   "SHAKUHACHI",0xffb0c880, 0.08f, 1.0f, 0, 3, 4000, 0.4f);
    gh("gh_kalimba", "KALIMBA",   0xffe0b880, 0.001f,1.4f, 0, 0, 5000, 0.4f);
    gh("gh_lullaby", "LULLABY",   0xffd0c8f0, 0.4f,  2.5f, 1, 6, 2500, 0.4f);
    gh("gh_totoro",  "TOTORO",    0xff80a060, 0.05f, 2.0f, 1, 0, 1500, 0.6f);
    gh("gh_chime",   "CHIME",     0xffc0f0e0, 0.001f,2.8f, 0, 4, 8000, 0.4f);
    gh("gh_sprite",  "SPRITE",    0xfff0e0ff, 0.001f,1.6f, 0, 0,14000, 0.4f);
    gh("gh_meadow",  "MEADOW",    0xffa8d890, 0.5f,  3.0f, 1, 8, 2000, 0.4f);

    // ── DS (legacy — square/triangle, chiptune-ish) ───────────────────────────
    auto ds = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  int wave, float det, float lp, float Q)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=wave; p.legDetune=det;
        p.legLpHz=lp; p.legLpQ=Q;
        addPreset("DS", p);
    };
    ds("ds_chip",   "CHIP",    0xffff4444, 0.001f,0.5f, 3, 8, 6000, 0.5f);
    ds("ds_pulse",  "PULSE",   0xffff8800, 0.001f,0.5f, 3, 0, 5000, 0.5f);
    ds("ds_tri8",   "TRI8",    0xff44aaff, 0.001f,0.8f, 1, 0, 3000, 0.4f);
    ds("ds_poke",   "POKE",    0xffffcc00, 0.002f,1.2f, 0, 0, 7000, 0.4f);
    ds("ds_mario",  "MARIO",   0xffff2200, 0.001f,0.4f, 3, 8, 5000, 0.5f);
    ds("ds_zelda",  "ZELDA",   0xff44dd44, 0.008f,0.9f, 3, 4, 5000, 0.5f);
    ds("ds_kirby",  "KIRBY",   0xffff88cc, 0.001f,0.7f, 0, 0, 4000, 0.4f);
    ds("ds_dung",   "DUNGEON", 0xff6644aa, 0.05f, 1.5f, 3, 0, 1500, 1.5f);
    ds("ds_battle", "BATTLE",  0xffcc2200, 0.001f,0.6f, 3, 0, 4000, 0.5f);
    ds("ds_crystal","CRYSTAL", 0xffaaddff, 0.001f,1.8f, 0, 0, 9000, 0.4f);
    ds("ds_echo",   "ECHO",    0xff88ccff, 0.001f,1.0f, 3, 0, 4000, 0.5f);
    ds("ds_bass8",  "BASS8",   0xffaa44ff, 0.001f,0.7f, 1, 0, 1500, 0.5f);
    ds("ds_warp",   "WARP",    0xff00ffcc, 0.001f,0.8f, 3, 0, 4000, 0.5f);
    ds("ds_noise",  "NOISE",   0xffcccccc, 0.001f,0.4f, 3, 0, 5000, 2.0f);
    ds("ds_star",   "STAR",    0xffffee44, 0.001f,1.4f, 0, 0,10000, 0.4f);

    // ── SCI-FI (FM engine) ────────────────────────────────────────────────────
    auto sf = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  float modR, float modI, float lfoF, float lpQ_, float lfoD)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::SCIFI;
        p.modRatio=modR; p.modIndex=modI; p.lfoFreq=lfoF; p.lpQ=lpQ_; p.lfoDepth=lfoD;
        addPreset("SCIFI", p);
    };
    sf("sf_laser",     "LASER",       0xff00ffff, 0.001f,0.5f,  7.0f, 8.0f, 3.0f,  8.f, 5.f);
    sf("sf_hyper",     "HYPERSPACE",  0xff0088ff, 0.3f,  2.5f,  2.0f,12.0f, 0.1f,  3.f, 8.f);
    sf("sf_android",   "ANDROID",     0xff44ffcc, 0.02f, 1.0f,  3.5f, 3.0f, 0.8f,  5.f, 3.f);
    sf("sf_plasma",    "PLASMA",      0xffff44ff, 0.001f,0.7f,  5.0f, 6.0f, 4.0f,  9.f, 6.f);
    sf("sf_void",      "VOID",        0xff220033, 0.5f,  3.0f,  1.5f,15.0f, 0.05f, 2.f,12.f);
    sf("sf_wormhole",  "WORMHOLE",    0xff6600cc, 0.1f,  2.0f,  0.5f, 4.0f, 0.3f,  4.f, 2.f);
    sf("sf_cyber",     "CYBERPUNK",   0xffff0066, 0.005f,0.8f,  4.0f, 5.0f, 2.0f,  7.f, 4.f);
    sf("sf_matrix",    "MATRIX",      0xff00ff44, 0.001f,0.6f,  7.1f, 3.0f, 1.5f,  6.f, 3.f);
    sf("sf_ion",       "ION",         0xff88ccff, 0.01f, 1.2f,  2.5f, 8.0f, 0.6f,  5.f, 5.f);
    sf("sf_quantum",   "QUANTUM",     0xffaaffee, 0.2f,  1.8f,  3.0f,10.0f, 0.4f,  4.f, 7.f);
    sf("sf_singul",    "SINGULARITY", 0xffff8800, 1.0f,  3.5f,  0.25f,6.0f, 0.02f, 1.f, 4.f);
    sf("sf_nebula",    "NEBULA",      0xffcc44ff, 0.6f,  3.0f,  1.01f,20.f, 0.15f, 2.f,10.f);
    sf("sf_galactic",  "GALACTIC",    0xff4444ff, 0.1f,  2.2f,  6.0f, 4.0f, 0.25f, 4.f, 3.f);
    sf("sf_binary",    "BINARY",      0xffffffff, 0.001f,0.4f,  8.0f, 2.0f, 5.0f, 10.f, 4.f);
    sf("sf_electron",  "ELECTRON",    0xffffff00, 0.001f,0.6f,  5.5f, 7.0f, 3.5f,  8.f, 5.f);
    sf("sf_cosmos",    "COSMOS",      0xff000088, 0.8f,  4.0f,  2.0f, 5.0f, 0.08f, 2.f, 6.f);
    sf("sf_photon",    "PHOTON",      0xffffffcc, 0.001f,0.3f, 10.0f, 3.0f, 6.0f, 12.f, 6.f);
    sf("sf_neutron",   "NEUTRON",     0xff888888, 0.05f, 1.5f,  1.5f, 8.0f, 0.7f,  6.f, 4.f);
    sf("sf_quasar",    "QUASAR",      0xffff6600, 0.3f,  2.8f,  4.5f, 9.0f, 0.2f,  5.f, 7.f);
    sf("sf_reactor",   "REACTOR",     0xff00ff00, 0.02f, 1.0f,  7.0f, 5.0f, 1.2f, 14.f, 5.f);
    sf("sf_warp",      "WARP",        0xff88ffff, 0.001f,0.9f,  2.8f, 7.0f, 2.5f,  7.f, 5.f);
    sf("sf_starfield", "STARFIELD",   0xffccccff, 0.4f,  3.5f,  3.7f, 4.0f, 0.12f, 3.f, 3.f);
    sf("sf_darkmatter","DARK MATTER", 0xff111133, 1.5f,  4.0f,  1.2f,12.0f, 0.03f, 1.f, 9.f);
    sf("sf_pulsar",    "PULSAR",      0xffff00aa, 0.001f,0.8f,  9.0f, 4.0f, 8.0f, 10.f, 5.f);
    sf("sf_tachyon",   "TACHYON",     0xffff4444, 0.001f,0.4f, 12.0f, 2.0f,10.0f, 15.f, 7.f);

    // ── VIKINGS (detuned saws engine) ─────────────────────────────────────────
    auto vk = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  float det, float sub, float lp, float sat, int w)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::VIKINGS;
        p.detuneCents=det; p.subGain=sub; p.vikLpHz=lp; p.saturation=sat; p.waves=w;
        addPreset("VIKINGS", p);
    };
    vk("vk_odin",     "ODIN",      0xff2244aa, 0.1f, 2.0f, 20,0.50f,280,3.0f,3);
    vk("vk_thor",     "THOR",      0xff4488ff, 0.02f,1.2f, 12,0.40f,500,2.5f,3);
    vk("vk_valhalla", "VALHALLA",  0xffffcc44, 0.3f, 2.5f, 25,0.45f,200,2.0f,3);
    vk("vk_berserk",  "BERSERKER", 0xffcc2200, 0.001f,0.8f,10,0.30f,600,4.0f,3);
    vk("vk_longship", "LONGSHIP",  0xff8888aa, 0.15f,1.5f, 15,0.35f,400,2.0f,3);
    vk("vk_mjolnir",  "MJOLNIR",  0xffaaaacc, 0.001f,0.9f, 8,0.55f,350,3.5f,3);
    vk("vk_rune",     "RUNE",      0xff884422, 0.08f,1.8f,  5,0.30f,800,1.5f,2);
    vk("vk_glacier",  "GLACIER",   0xffaaddff, 0.6f, 3.0f, 30,0.60f,180,1.5f,3);
    vk("vk_axeman",   "AXEMAN",    0xffcc4400, 0.005f,0.7f,10,0.25f,600,3.0f,3);
    vk("vk_elder",    "ELDER",     0xff886644, 0.2f, 2.0f,  8,0.40f,300,1.8f,3);
    vk("vk_saga",     "SAGA",      0xffcc9944, 0.1f, 1.5f, 12,0.35f,500,2.2f,3);
    vk("vk_frost",    "FROST",     0xffcceeff, 0.3f, 2.2f, 18,0.20f,200,1.2f,3);
    vk("vk_wolf",     "WOLF",      0xff666666, 0.01f,1.0f, 14,0.45f,400,3.5f,3);
    vk("vk_raven",    "RAVEN",     0xff222222, 0.05f,1.5f, 10,0.30f,250,2.5f,2);
    vk("vk_shield",   "SHIELD",    0xff8888cc, 0.02f,1.0f,  6,0.35f,450,2.8f,3);
    vk("vk_horn",     "HORN",      0xffcc8844, 0.15f,1.8f,  8,0.50f,500,1.8f,2);
    vk("vk_fjord",    "FJORD",     0xff446688, 0.4f, 2.8f, 20,0.65f,180,1.5f,3);
    vk("vk_blood",    "BLOODLUST", 0xff880000, 0.001f,0.6f,10,0.20f,600,5.0f,3);
    vk("vk_allfather","ALLFATHER", 0xff4400aa, 0.2f, 2.5f, 18,0.55f,350,2.5f,3);
    vk("vk_yggdrasil","YGGDRASIL", 0xff226622, 0.5f, 3.5f, 22,0.45f,400,2.0f,3);
    vk("vk_iron",     "IRON",      0xff888888, 0.001f,0.7f, 5,0.30f,500,6.0f,3);
    vk("vk_norseman", "NORSEMAN",  0xffaa6622, 0.05f,1.2f, 12,0.40f,400,2.8f,3);
    vk("vk_valkyrie", "VALKYRIE",  0xffffaacc, 0.1f, 1.5f,  8,0.20f,800,1.5f,2);
    vk("vk_mead",     "MEAD",      0xffddaa22, 0.12f,1.8f, 10,0.45f,600,2.0f,3);
    vk("vk_conquest", "CONQUEST",  0xffff2200, 0.001f,0.5f,15,0.25f,700,7.0f,3);

    // ── GYM (square/saw + clip) ───────────────────────────────────────────────
    auto gy = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  int wave, float clip, float bHz, float bDB, float sub)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::GYM;
        p.gymWave=wave; p.clipAmount=clip; p.boostHz=bHz; p.boostDB=bDB; p.gymSub=sub;
        addPreset("GYM", p);
    };
    gy("gy_pump",    "PUMP",     0xffff4400, 0.001f,0.5f, 0,0.70f,2000,8.f, 0.20f);
    gy("gy_crunch",  "CRUNCH",   0xffcc3300, 0.001f,0.4f, 1,0.60f,1800,10.f,0.00f);
    gy("gy_beast",   "BEAST",    0xff880000, 0.002f,0.6f, 0,0.50f,2500,12.f,0.30f);
    gy("gy_sweat",   "SWEAT",    0xffff8844, 0.001f,0.4f, 0,0.80f,1500,6.f, 0.10f);
    gy("gy_iron",    "IRON",     0xff666666, 0.001f,0.5f, 0,0.55f,3000,8.f, 0.00f);
    gy("gy_prework", "PREWORK",  0xffff0000, 0.001f,0.3f, 0,0.40f,3500,14.f,0.00f);
    gy("gy_arena",   "ARENA",    0xffffaa00, 0.005f,0.7f, 1,0.65f,2200,9.f, 0.25f);
    gy("gy_titan",   "TITAN",    0xffaa4400, 0.01f, 0.8f, 0,0.45f,1200,10.f,0.40f);
    gy("gy_warrior", "WARRIOR",  0xffcc2200, 0.001f,0.5f, 0,0.60f,2800,10.f,0.15f);
    gy("gy_power",   "POWER",    0xffff6600, 0.001f,0.6f, 0,0.75f,1600,7.f, 0.30f);
    gy("gy_rush",    "RUSH",     0xffff2244, 0.001f,0.3f, 1,0.50f,4000,12.f,0.00f);
    gy("gy_grind",   "GRIND",    0xff884422, 0.002f,0.5f, 1,0.60f,2600,9.f, 0.00f);
    gy("gy_fury",    "FURY",     0xffff0044, 0.001f,0.4f, 0,0.35f,3200,15.f,0.00f);
    gy("gy_strength","STRENGTH", 0xff884400, 0.01f, 1.0f, 0,0.55f,1000,8.f, 0.50f);
    gy("gy_reps",    "REPS",     0xffff8800, 0.001f,0.4f, 0,0.70f,2000,10.f,0.10f);
    gy("gy_gains",   "GAINS",    0xffffcc00, 0.005f,0.6f, 0,0.65f,800, 8.f, 0.60f);
    gy("gy_core",    "CORE",     0xffcc6600, 0.001f,0.5f, 0,0.60f,1800,9.f, 0.20f);
    gy("gy_endure",  "ENDURANCE",0xff886644, 0.05f, 1.5f, 1,0.65f,1500,7.f, 0.20f);
    gy("gy_tempo",   "TEMPO",    0xffff6633, 0.001f,0.4f, 0,0.70f,2400,8.f, 0.10f);
    gy("gy_flex",    "FLEX",     0xffff9900, 0.001f,0.3f, 0,0.45f,3800,12.f,0.00f);
    gy("gy_peak",    "PEAK",     0xffff3300, 0.001f,0.4f, 1,0.55f,2000,11.f,0.00f);
    gy("gy_hustle",  "HUSTLE",   0xffcc4400, 0.001f,0.5f, 0,0.60f,2200,9.f, 0.15f);
    gy("gy_grind2",  "GRIND II", 0xff882200, 0.001f,0.4f, 0,0.50f,2800,11.f,0.00f);
    gy("gy_champ",   "CHAMPION", 0xffffdd00, 0.01f, 0.8f, 1,0.65f,1600,8.f, 0.35f);
    gy("gy_overdrive","OVERDRIVE",0xffff0000,0.001f,0.3f, 0,0.30f,4500,18.f,0.00f);

    // ── BASS808 (sine slide + distortion) ─────────────────────────────────────
    auto b8 = [&](const char* id, const char* name, uint32 col, float rel,
                  float slideF, float slideDu, float dist, float target, float sub)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=0.005f; p.rel=rel;
        p.engine=EngineType::BASS808;
        p.slideFrom=slideF; p.slideDur=slideDu; p.distAmount=dist;
        p.slideTarget=target; p.b8Sub=sub;
        addPreset("BASS808", p);
    };
    b8("b8_atlanta", "ATLANTA",  0xffff2200, 2.5f, 2.2f,0.06f,2.5f,1.00f,0.0f);
    b8("b8_houston", "HOUSTON",  0xffee3300, 3.0f, 2.5f,0.10f,2.0f,1.00f,0.0f);
    b8("b8_memphis", "MEMPHIS",  0xffcc2200, 2.8f, 1.8f,0.07f,3.5f,0.90f,0.0f);
    b8("b8_chicago", "CHICAGO",  0xffff4400, 2.0f, 3.0f,0.04f,2.0f,1.00f,0.0f);
    b8("b8_detroit", "DETROIT",  0xffaa1100, 2.2f, 2.0f,0.06f,4.5f,1.00f,0.0f);
    b8("b8_london",  "LONDON",   0xff8888aa, 2.0f, 2.0f,0.08f,2.0f,1.10f,0.0f);
    b8("b8_paris",   "PARIS",    0xffaaaacc, 2.5f, 1.5f,0.09f,1.5f,1.00f,0.0f);
    b8("b8_tokyo",   "TOKYO",    0xffff4488, 1.8f, 2.8f,0.03f,2.2f,1.00f,0.0f);
    b8("b8_cloud",   "CLOUD",    0xffaaccff, 4.5f, 2.0f,0.12f,2.0f,0.98f,0.0f);
    b8("b8_dark",    "DARK",     0xff330011, 3.0f, 1.6f,0.08f,5.0f,0.85f,0.0f);
    b8("b8_bright",  "BRIGHT",   0xffff8844, 2.0f, 2.0f,0.06f,1.8f,1.15f,0.0f);
    b8("b8_fat",     "FAT",      0xffcc4400, 2.5f, 2.0f,0.08f,6.0f,1.00f,0.3f);
    b8("b8_clean",   "CLEAN",    0xffffffff, 2.0f, 2.0f,0.07f,0.8f,1.00f,0.0f);
    b8("b8_trap_a",  "TRAP A",   0xffff2233, 2.2f, 2.1f,0.07f,2.5f,1.00f,0.0f);
    b8("b8_trap_b",  "TRAP B",   0xffee1122, 2.8f, 2.4f,0.09f,2.8f,0.95f,0.0f);
    b8("b8_trap_c",  "TRAP C",   0xffdd0011, 1.8f, 3.2f,0.05f,2.2f,1.00f,0.0f);
    b8("b8_trap_d",  "TRAP D",   0xffcc0000, 3.2f, 1.9f,0.11f,2.0f,0.92f,0.0f);
    b8("b8_trap_e",  "TRAP E",   0xffbb1111, 2.4f, 2.3f,0.06f,4.0f,1.00f,0.0f);
    b8("b8_trap_f",  "TRAP F",   0xffaa2222, 2.0f, 2.6f,0.05f,1.8f,1.10f,0.0f);
    b8("b8_trap_g",  "TRAP G",   0xff993333, 3.5f, 2.0f,0.14f,2.5f,0.88f,0.0f);
    b8("b8_trap_h",  "TRAP H",   0xff884444, 2.2f, 2.0f,0.07f,2.5f,1.00f,0.5f);
    b8("b8_trap_i",  "TRAP I",   0xff774455, 2.0f, 4.0f,0.04f,3.0f,1.00f,0.0f);
    b8("b8_trap_j",  "TRAP J",   0xff664466, 2.5f, 1.4f,0.10f,1.5f,0.97f,0.0f);
    b8("b8_bounce",  "BOUNCE",   0xffff6644, 1.5f, 3.5f,0.03f,2.5f,1.05f,0.0f);
    b8("b8_slap",    "SLAP",     0xffff4422, 1.2f, 5.0f,0.02f,3.0f,1.00f,0.0f);

    // ── VAPOR (slow LP sweep pads) ─────────────────────────────────────────────
    auto vp = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  float det, float lpS, float lpE, float sw, float vibR, int wave)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::VAPOR;
        p.detuneCents=det; p.lpStartHz=lpS; p.lpEndHz=lpE;
        p.sweepTime=sw; p.vapVibRate=vibR; p.vapWave=wave;
        addPreset("VAPOR", p);
    };
    vp("vp_mall",   "MALL",    0xffff88dd, 1.0f,3.0f,  8,  600,2500,1.5f,0.25f,0);
    vp("vp_sunset", "SUNSET",  0xffff8844, 1.2f,3.5f,  6,  800,3000,2.0f,0.20f,0);
    vp("vp_neon",   "NEON",    0xffff00ff, 0.5f,2.5f, 10, 1200,4000,1.0f,0.35f,0);
    vp("vp_city",   "CITY",    0xff8844ff, 0.8f,2.8f, 12,  500,2000,1.8f,0.18f,0);
    vp("vp_dream",  "DREAM",   0xffaa88ff, 1.5f,4.0f,  5,  400,1500,2.5f,0.15f,1);
    vp("vp_retro",  "RETRO",   0xffff4488, 0.6f,2.5f,  9,  700,2800,1.2f,0.30f,0);
    vp("vp_tape",   "TAPE",    0xffcc8844, 0.4f,2.0f, 15,  500,1800,1.5f,0.40f,0);
    vp("vp_float",  "FLOAT",   0xff88ccff, 2.0f,4.5f,  4,  300,1200,3.0f,0.12f,2);
    vp("vp_gloss",  "GLOSS",   0xffffccee, 0.3f,2.0f,  7, 1500,5000,0.8f,0.28f,0);
    vp("vp_pink",   "PINK",    0xffff88bb, 0.8f,3.0f,  6,  900,3200,1.5f,0.22f,1);
    vp("vp_aqua",   "AQUA",    0xff44ffdd, 1.0f,3.2f,  8,  700,2600,1.8f,0.18f,0);
    vp("vp_chrome", "CHROME",  0xffcccccc, 0.4f,2.2f,  5, 2000,6000,0.6f,0.32f,0);
    vp("vp_prism",  "PRISM",   0xffffffff, 0.6f,2.8f, 11,  800,3500,1.3f,0.25f,0);
    vp("vp_dusk",   "DUSK",    0xffff6644, 1.2f,3.8f,  7,  400,1600,2.2f,0.16f,0);
    vp("vp_dawn",   "DAWN",    0xffffeeaa, 1.5f,4.0f,  5,  500,2000,2.5f,0.14f,1);
    vp("vp_haze",   "HAZE",    0xffccbbff, 1.8f,4.5f, 14,  300,1100,3.0f,0.10f,0);
    vp("vp_glow",   "GLOW",    0xffffff88, 0.7f,2.5f,  8, 1000,3800,1.0f,0.30f,0);
    vp("vp_echo",   "ECHO",    0xff88aaff, 0.5f,3.5f, 12,  600,2200,2.0f,0.20f,0);
    vp("vp_mist",   "MIST",    0xffddeeff, 2.0f,5.0f, 18,  200, 800,3.5f,0.08f,2);
    vp("vp_silk",   "SILK",    0xffffeeff, 0.6f,2.8f,  4,  800,2800,1.5f,0.22f,1);
    vp("vp_marble", "MARBLE",  0xffeeddcc, 0.4f,2.2f,  6, 1200,4000,1.0f,0.28f,0);
    vp("vp_cloud",  "CLOUD",   0xffcceeff, 2.5f,5.0f, 20,  200, 700,4.0f,0.06f,2);
    vp("vp_drift",  "DRIFT",   0xffaabbdd, 1.5f,4.2f,  9,  400,1500,2.8f,0.12f,0);
    vp("vp_velvet", "VELVET",  0xffcc88aa, 0.8f,3.0f,  5,  700,2400,1.6f,0.20f,1);
    vp("vp_luxe",   "LUXE",    0xffddaa66, 0.5f,2.5f,  7, 1100,3600,1.2f,0.26f,0);

    // ── HORROR (near-unison dissonance + bitcrush) ────────────────────────────
    auto ho = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  float modR, float drift, float lp, float Q, int bits)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::HORROR;
        p.horModRatio=modR; p.driftAmount=drift; p.horLpHz=lp; p.horLpQ=Q; p.bitSteps=bits;
        addPreset("HORROR", p);
    };
    ho("ho_terror",  "TERROR",    0xffff0000, 0.001f,1.5f, 1.013f,0.025f,2000,3.f, 8);
    ho("ho_dread",   "DREAD",     0xff440000, 1.0f, 3.0f,  1.007f,0.040f,1200,2.f,16);
    ho("ho_crypt",   "CRYPT",     0xff332211, 0.3f, 2.5f,  1.020f,0.015f, 800,4.f, 6);
    ho("ho_ghost",   "GHOST",     0xffeeeeff, 0.5f, 3.5f,  1.002f,0.060f,3000,1.f,20);
    ho("ho_shadow",  "SHADOW",    0xff222222, 0.2f, 2.0f,  1.018f,0.020f,1500,2.f,10);
    ho("ho_scream",  "SCREAM",    0xffff2200, 0.001f,0.8f, 1.050f,0.050f,5000,6.f, 4);
    ho("ho_blood",   "BLOOD",     0xff880000, 0.001f,1.2f, 1.023f,0.030f,1800,3.f, 7);
    ho("ho_curse",   "CURSE",     0xff441100, 0.6f, 3.0f,  1.009f,0.045f, 900,2.f,14);
    ho("ho_demon",   "DEMON",     0xff660000, 0.1f, 2.0f,  1.031f,0.035f,2500,4.f, 5);
    ho("ho_void",    "VOID",      0xff000011, 2.0f, 5.0f,  1.001f,0.070f, 600,1.f,24);
    ho("ho_abyss",   "ABYSS",     0xff001133, 1.5f, 4.0f,  1.004f,0.055f, 700,1.f,18);
    ho("ho_omen",    "OMEN",      0xff333300, 0.4f, 2.8f,  1.015f,0.028f,1000,2.f,12);
    ho("ho_stalk",   "STALK",     0xff223300, 0.05f,1.5f,  1.011f,0.022f,1600,3.f, 9);
    ho("ho_creep",   "CREEP",     0xff334400, 0.3f, 2.2f,  1.017f,0.032f,1300,2.f,11);
    ho("ho_doom",    "DOOM",      0xff110000, 0.8f, 3.5f,  1.006f,0.048f, 800,2.f,15);
    ho("ho_grave",   "GRAVE",     0xff444433, 0.5f, 3.0f,  1.014f,0.025f,1100,2.f,10);
    ho("ho_ritual",  "RITUAL",    0xff553300, 0.4f, 2.5f,  1.025f,0.038f,1400,3.f, 8);
    ho("ho_plague",  "PLAGUE",    0xff336600, 0.6f, 3.0f,  1.019f,0.042f,1000,2.f, 7);
    ho("ho_madness", "MADNESS",   0xff664422, 0.001f,1.0f, 1.055f,0.080f,4000,7.f, 3);
    ho("ho_specter", "SPECTER II",0xffccccdd, 1.0f, 4.0f,  1.003f,0.065f,2500,1.f,20);
    ho("ho_asylum",  "ASYLUM",    0xffaaaaaa, 0.2f, 2.5f,  1.029f,0.033f,1700,3.f, 6);
    ho("ho_decay",   "DECAY",     0xff445522, 0.7f, 3.5f,  1.010f,0.050f, 900,2.f,13);
    ho("ho_hunt",    "HUNT",      0xff334422, 0.05f,1.8f,  1.022f,0.028f,2000,3.f, 9);
    ho("ho_nightmare","NIGHTMARE",0xff221133, 0.8f, 3.5f,  1.008f,0.058f,1000,2.f,16);
    ho("ho_darkness","DARKNESS",  0xff000000, 2.0f, 5.0f,  1.001f,0.080f, 400,1.f,28);

    // ── SAMURAI (pluck boisé engine) ──────────────────────────────────────────
    // params: id, name, col, atk, rel, pluckDecay, harmMix, lpQ(resonance)
    auto sam = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, float decay, float harm, float Q)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::SAMURAI;
        p.pluckDecay=decay; p.harmMix=harm; p.lpQ=Q;
        addPreset("SAMURAI", p);
    };
    //              id            name        colour      atk    rel    decay  harm   Q
    sam("sm_katana",  "KATANA",   0xffcc2200, 0.001f,0.3f, 0.15f,0.35f, 8.0f);
    sam("sm_shamisen","SHAMISEN", 0xffaa6600, 0.001f,0.5f, 0.30f,0.20f, 5.0f);
    sam("sm_koto",    "KOTO",     0xffeebb88, 0.001f,0.7f, 0.45f,0.15f, 3.5f);
    sam("sm_taiko",   "TAIKO",    0xff882200, 0.001f,0.2f, 0.08f,0.45f,12.0f);
    sam("sm_biwa",    "BIWA",     0xff663300, 0.001f,0.6f, 0.35f,0.25f, 6.0f);
    sam("sm_tsugaru", "TSUGARU",  0xffff4400, 0.001f,0.4f, 0.20f,0.30f, 7.5f);
    sam("sm_ninja",   "NINJA",    0xff222222, 0.001f,0.2f, 0.10f,0.40f,10.0f);
    sam("sm_ronin",   "RONIN",    0xff444444, 0.002f,0.8f, 0.50f,0.18f, 4.0f);
    sam("sm_shogun",  "SHOGUN",   0xff4400aa, 0.001f,0.6f, 0.25f,0.35f, 9.0f);
    sam("sm_sakura",  "SAKURA",   0xffffaacc, 0.001f,0.8f, 0.55f,0.12f, 2.5f);
    sam("sm_fuji",    "FUJI",     0xff8888ff, 0.003f,0.7f, 0.40f,0.22f, 5.5f);
    sam("sm_geisha",  "GEISHA",   0xffff88bb, 0.001f,0.9f, 0.60f,0.10f, 2.0f);
    sam("sm_bushido", "BUSHIDO",  0xffcc4400, 0.001f,0.3f, 0.12f,0.42f,11.0f);
    sam("sm_seppuku", "SEPPUKU",  0xff550000, 0.002f,0.5f, 0.28f,0.30f, 7.0f);
    sam("sm_ikebana", "IKEBANA",  0xff88cc66, 0.003f,1.0f, 0.65f,0.08f, 1.8f);

    // ── CHERNOBYL (bitcrush + noise engine) ───────────────────────────────────
    // params: id, name, col, atk, rel, bitSteps, noiseAmt, saturation
    auto che = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, int bits, float noise, float sat)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::CHERNOBYL;
        p.bitSteps=bits; p.noiseAmt=noise; p.saturation=sat;
        addPreset("CHERNOBYL", p);
    };
    //              id            name        colour      atk    rel   bits noise  sat
    che("ch_reactor","REACTOR",   0xff33ff00, 0.001f,0.5f,  5,0.10f,3.0f);
    che("ch_fallout","FALLOUT",   0xff55aa00, 0.002f,0.8f,  8,0.18f,2.5f);
    che("ch_meltdown","MELTDOWN", 0xffaa2200, 0.001f,0.4f,  3,0.08f,4.0f);
    che("ch_core",   "CORE",      0xff00ff44, 0.001f,0.6f,  6,0.15f,3.5f);
    che("ch_steam",  "STEAM",     0xff888888, 0.010f,1.0f, 12,0.25f,2.0f);
    che("ch_roentgn","ROENTGEN",  0xff22cc00, 0.001f,0.3f,  4,0.05f,5.0f);
    che("ch_pripyat","PRIPYAT",   0xff446600, 0.005f,1.2f, 10,0.30f,1.5f);
    che("ch_gamma",  "GAMMA",     0xffaaff00, 0.001f,0.4f,  2,0.04f,6.0f);
    che("ch_decay",  "DECAY",     0xff334400, 0.003f,0.9f,  9,0.22f,2.2f);
    che("ch_isotope","ISOTOPE",   0xff00cc44, 0.001f,0.5f,  7,0.12f,3.8f);
    che("ch_fission","FISSION",   0xffff4400, 0.001f,0.3f,  4,0.06f,5.5f);
    che("ch_hex",    "HEX",       0xff226600, 0.002f,0.7f, 11,0.28f,1.8f);
    che("ch_radium", "RADIUM",    0xff33ff88, 0.001f,0.4f,  6,0.14f,4.2f);
    che("ch_static", "STATIC",    0xffaaaaaa, 0.001f,0.2f,  3,0.35f,2.5f);
    che("ch_ghost",  "GHOST",     0xffccffcc, 0.005f,1.5f, 14,0.40f,1.2f);

    // ── PIRATES (accordion + vibrato engine) ──────────────────────────────────
    // params: id, name, col, atk, rel, detuneCents, vibRate, vibDepth, lpQ
    auto pir = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, float det, float vibR, float vibD, float Q)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::PIRATES;
        p.detuneCents=det; p.vibRate=vibR; p.vibDepth=vibD; p.lpQ=Q;
        addPreset("PIRATES", p);
    };
    //              id            name        colour      atk    rel   det   vibR  vibD   Q
    pir("pi_accord", "ACCORDION", 0xffcc8800, 0.04f,0.5f, 22,5.5f,0.015f,3.0f);
    pir("pi_shanty", "SHANTY",    0xff884400, 0.02f,0.6f, 18,4.8f,0.012f,2.5f);
    pir("pi_grog",   "GROG",      0xffcc4400, 0.01f,0.4f, 28,6.2f,0.020f,4.0f);
    pir("pi_jolly",  "JOLLY RGR", 0xffff2200, 0.03f,0.5f, 25,5.0f,0.018f,3.5f);
    pir("pi_treasur","TREASURE",  0xffffcc00, 0.05f,0.8f, 15,4.2f,0.010f,2.0f);
    pir("pi_anchor", "ANCHOR",    0xff446688, 0.02f,0.6f, 20,5.8f,0.014f,3.0f);
    pir("pi_rum",    "RUM",       0xff884422, 0.01f,0.3f, 30,7.0f,0.025f,5.0f);
    pir("pi_parrot", "PARROT",    0xff22aa44, 0.03f,0.7f, 12,3.5f,0.008f,1.8f);
    pir("pi_galleon","GALLEON",   0xff8844aa, 0.06f,0.9f, 24,5.2f,0.016f,2.8f);
    pir("pi_cutlass","CUTLASS",   0xffaa2200, 0.01f,0.4f, 32,6.8f,0.022f,4.5f);
    pir("pi_plank",  "PLANK",     0xff664422, 0.04f,0.7f, 16,4.5f,0.011f,2.2f);
    pir("pi_corsair","CORSAIR",   0xff220088, 0.02f,0.5f, 26,5.6f,0.017f,3.2f);
    pir("pi_buccan", "BUCCANEER", 0xff882200, 0.03f,0.6f, 20,6.0f,0.019f,3.8f);
    pir("pi_kraken", "KRAKEN",    0xff002244, 0.08f,1.2f, 35,4.0f,0.013f,2.0f);
    pir("pi_siren",  "SIREN",     0xff88aaff, 0.05f,0.8f, 10,3.2f,0.007f,1.5f);

    // ── TRIBAL (percussive formant engine) ────────────────────────────────────
    // params: id, name, col, atk, rel, formantHz, punch
    auto tri_p = [&](const char* id, const char* name, uint32 col,
                     float atk, float rel, float fHz, float pk)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::TRIBAL;
        p.formantHz=fHz; p.punch=pk;
        addPreset("TRIBAL", p);
    };
    //               id            name        colour      atk    rel    fHz    pk
    tri_p("tr_shaman", "SHAMAN",   0xffcc6600, 0.001f,0.4f,  800,3.5f);
    tri_p("tr_bongo",  "BONGO",    0xffaa4400, 0.001f,0.2f, 1200,5.0f);
    tri_p("tr_djembe", "DJEMBE",   0xff884400, 0.001f,0.3f,  950,4.0f);
    tri_p("tr_conga",  "CONGA",    0xff663300, 0.001f,0.25f,1400,4.5f);
    tri_p("tr_talking","TALKING",  0xffcc8822, 0.001f,0.35f, 600,3.0f);
    tri_p("tr_ritual", "RITUAL",   0xff880000, 0.002f,0.5f,  700,2.5f);
    tri_p("tr_totem",  "TOTEM",    0xff884422, 0.001f,0.4f,  500,3.8f);
    tri_p("tr_fire",   "FIRE DNC", 0xffff4400, 0.001f,0.3f, 1100,6.0f);
    tri_p("tr_spirit", "SPIRIT",   0xff446688, 0.003f,0.6f,  400,2.0f);
    tri_p("tr_warrior","WARRIOR",  0xffcc2200, 0.001f,0.2f, 1600,7.0f);
    tri_p("tr_earth",  "EARTH",    0xff664422, 0.002f,0.5f,  650,3.2f);
    tri_p("tr_sky",    "SKY",      0xff88aaff, 0.002f,0.7f,  350,1.8f);
    tri_p("tr_rain",   "RAIN",     0xff4488cc, 0.001f,0.4f,  850,3.5f);
    tri_p("tr_thunder","THUNDER",  0xff222244, 0.001f,0.3f, 1800,8.0f);
    tri_p("tr_moon",   "MOON",     0xffccccff, 0.003f,0.8f,  300,1.5f);

    // ── CURIOSITY (SCI-FI engine — space exploration theme) ───────────────────
    auto cur = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, float modR, float modI, float lfoF, float lpQ_, float lfoD)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::SCIFI;
        p.modRatio=modR; p.modIndex=modI; p.lfoFreq=lfoF; p.lpQ=lpQ_; p.lfoDepth=lfoD;
        addPreset("CURIOSITY", p);
    };
    //             id            name        colour      atk    rel   modR  modI  lfoF  lpQ  lfoD
    cur("cu_mars",   "MARS",     0xffcc4400, 0.3f, 2.0f, 2.5f, 6.0f,0.15f, 3.f, 4.f);
    cur("cu_rover",  "ROVER",    0xff884422, 0.2f, 1.5f, 3.0f, 4.0f,0.20f, 4.f, 3.f);
    cur("cu_signal", "SIGNAL",   0xff00ccff, 0.01f,0.8f, 4.0f, 3.0f,1.00f, 8.f, 3.f);
    cur("cu_probe",  "PROBE",    0xff88ccff, 0.1f, 1.5f, 2.0f, 8.0f,0.30f, 4.f, 5.f);
    cur("cu_orbit",  "ORBIT",    0xff4488ff, 0.5f, 2.5f, 1.5f,10.0f,0.10f, 2.f, 7.f);
    cur("cu_cosmos", "COSMOS",   0xff8844ff, 1.0f, 3.0f, 1.2f,12.0f,0.08f, 2.f, 8.f);
    cur("cu_landing","LANDING",  0xffcc8844, 0.01f,1.2f, 3.5f, 5.0f,0.80f, 6.f, 4.f);
    cur("cu_dust",   "DUST DEVI",0xffaa6644, 0.2f, 1.8f, 4.5f, 4.5f,0.25f, 5.f, 3.f);
    cur("cu_canyon", "CANYON",   0xffcc5522, 0.4f, 2.2f, 2.0f, 7.0f,0.15f, 3.f, 5.f);
    cur("cu_beacon", "BEACON",   0xff00ff88, 0.001f,0.6f,6.0f, 2.0f,2.00f,12.f, 5.f);
    cur("cu_antenna","ANTENNA",  0xff44aaff, 0.05f,1.0f, 5.0f, 3.5f,0.50f, 7.f, 4.f);
    cur("cu_surface","SURFACE",  0xffdd8822, 0.3f, 2.5f, 1.8f, 8.0f,0.12f, 3.f, 6.f);
    cur("cu_rock",   "ROCK",     0xff886644, 0.2f, 2.0f, 3.2f, 5.0f,0.22f, 4.f, 3.f);
    cur("cu_crater", "CRATER",   0xff664422, 0.5f, 2.8f, 1.0f, 6.0f,0.08f, 2.f, 4.f);
    cur("cu_sample", "SAMPLE",   0xff88aacc, 0.1f, 1.5f, 2.8f, 6.0f,0.30f, 5.f, 4.f);

    // ── X-FILES (HORROR engine — mystery / alien theme) ───────────────────────
    auto xf = [&](const char* id, const char* name, uint32 col,
                  float atk, float rel, float modR, float drift, float lp, float Q, int bits)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::HORROR;
        p.horModRatio=modR; p.driftAmount=drift; p.horLpHz=lp; p.horLpQ=Q; p.bitSteps=bits;
        addPreset("XFILES", p);
    };
    //            id            name        colour      atk    rel    modR   drift  lp    Q   bits
    xf("xf_muldr","MULDER",    0xff4444aa, 0.5f, 2.5f, 1.005f,0.050f,2000,2.f, 16);
    xf("xf_scully","SCULLY",   0xff8888cc, 0.3f, 2.0f, 1.008f,0.040f,3000,1.5f,20);
    xf("xf_alien","ALIEN",     0xff00aa44, 0.1f, 1.5f, 1.025f,0.030f,2500,3.f, 10);
    xf("xf_ufo",  "UFO",       0xff22cc88, 0.2f, 2.0f, 1.012f,0.060f,4000,1.f, 18);
    xf("xf_smoke","CIGARETTE", 0xff888888, 0.8f, 3.5f, 1.003f,0.070f,1500,2.f, 22);
    xf("xf_area51","AREA 51",  0xff004422, 2.0f, 5.0f, 1.001f,0.080f, 800,1.f, 28);
    xf("xf_conspir","CONSPIR", 0xff222244, 1.0f, 4.0f, 1.006f,0.055f,1200,2.f, 18);
    xf("xf_abduct","ABDUCTION",0xff44aa88, 0.05f,1.2f, 1.040f,0.025f,3500,4.f,  8);
    xf("xf_hybrid","HYBRID",   0xff668866, 0.4f, 3.0f, 1.009f,0.045f,1800,2.5f,14);
    xf("xf_trust","TRUST NONE",0xff333355, 1.5f, 4.5f, 1.002f,0.065f, 900,1.f, 24);
    xf("xf_bounty","BOUNTY",   0xff224422, 0.6f, 3.5f, 1.011f,0.038f,1400,3.f, 12);
    xf("xf_lone","LONE GUN",   0xff444466, 0.3f, 2.5f, 1.015f,0.028f,2200,2.f, 16);
    xf("xf_truth","TRUTH",     0xff6688aa, 1.2f, 4.0f, 1.004f,0.058f,1000,2.f, 20);
    xf("xf_blkoil","BLACK OIL",0xff111122, 2.0f, 5.5f, 1.001f,0.090f, 500,1.f, 30);
    xf("xf_syndic","SYNDICATE",0xff334444, 1.0f, 3.8f, 1.007f,0.048f,1600,2.f, 16);

    // ── FLUTES (Legacy/sine engine — flute family) ─────────────────────────────
    auto fl = [&](const char* id, const char* name, uint32 col,
                  float atk, float rel, float det, float lp, float Q)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=0; // sine
        p.legDetune=det; p.legLpHz=lp; p.legLpQ=Q;
        addPreset("FLUTES", p);
    };
    //             id            name        colour      atk    rel   det   lp     Q
    fl("fl_concert","CONCERT",  0xffaaddff, 0.06f,1.5f,  0, 8000,0.4f);
    fl("fl_silver", "SILVER",   0xffc0d8ff, 0.04f,1.2f,  0, 9000,0.4f);
    fl("fl_shakuha","SHAKUHACHI",0xff88aa66,0.08f,1.0f,  2, 5000,0.5f);
    fl("fl_bamboo", "BAMBOO",   0xff99bb66, 0.07f,1.2f,  3, 6000,0.4f);
    fl("fl_pan",    "PAN FLUTE",0xffaaccaa, 0.05f,1.5f,  0, 7000,0.4f);
    fl("fl_tin",    "TIN WHISTLE",0xff88bbff,0.03f,0.8f, 0,10000,0.4f);
    fl("fl_alto",   "ALTO",     0xff99ccdd, 0.07f,1.3f,  1, 7500,0.4f);
    fl("fl_bass",   "BASS FLUTE",0xff4488aa,0.08f,1.8f,  2, 4000,0.5f);
    fl("fl_piccolo","PICCOLO",  0xffc8e8ff, 0.04f,0.9f,  0,12000,0.4f);
    fl("fl_irish",  "IRISH",    0xff88cc88, 0.03f,0.7f,  0,10000,0.4f);
    fl("fl_breathy","BREATHY",  0xffddeecc, 0.05f,1.4f,  4, 6000,0.4f);
    fl("fl_dark",   "DARK",     0xff336688, 0.08f,1.6f,  1, 4500,0.5f);
    fl("fl_ocarina","OCARINA",  0xffccaa88, 0.05f,1.2f,  0, 6000,0.4f);
    fl("fl_crystal","CRYSTAL",  0xffe8f8ff, 0.04f,1.5f,  0,14000,0.3f);
    fl("fl_mellow", "MELLOW",   0xff88aacc, 0.06f,1.8f,  2, 5500,0.4f);

    // ── GUITARS (GUITAR engine — electric + acoustic plucks) ──────────────────
    // params: id, name, col, atk, rel, guitWave, filterOpen, filterClose,
    //         filterTime, bodyDecay, distAmount, detuneCents, subGain, lpQ
    auto gtr = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, int wave, float fOpen, float fClose,
                   float fTime, float bDecay, float dist, float det, float sub, float Q)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::GUITAR;
        p.guitWave=wave; p.filterOpen=fOpen; p.filterClose=fClose;
        p.filterTime=fTime; p.bodyDecay=bDecay;
        p.distAmount=dist; p.detuneCents=det; p.subGain=sub; p.lpQ=Q;
        addPreset("GUITARS", p);
    };
    //              id            name        colour      atk    rel  wave fOpen fClose fTime bDec  dist det  sub   Q
    gtr("gt_strat",  "STRAT",    0xffcc6600, 0.001f,0.35f, 0,6000,  800,0.12f,0.25f,1.5f, 5,0.0f,2.0f);
    gtr("gt_tele",   "TELE",     0xffcc8822, 0.001f,0.30f, 0,8000, 1000,0.08f,0.18f,1.2f, 0,0.0f,1.8f);
    gtr("gt_lespaul","LES PAUL", 0xff884400, 0.001f,0.45f, 0,4000,  600,0.15f,0.30f,2.5f, 3,0.1f,2.5f);
    gtr("gt_acoustc","ACOUSTIC", 0xffddaa66, 0.001f,0.40f, 0,7000, 1200,0.10f,0.28f,1.0f, 0,0.0f,1.5f);
    gtr("gt_nylon",  "NYLON",    0xffeecc88, 0.001f,0.55f, 0,5000,  900,0.14f,0.35f,0.8f, 0,0.0f,1.2f);
    gtr("gt_jazz",   "JAZZ",     0xffcc8844, 0.002f,0.50f, 0,3000,  500,0.20f,0.35f,3.0f, 8,0.15f,3.0f);
    gtr("gt_metal",  "METAL",    0xff880000, 0.001f,0.25f, 0,7000,  700,0.08f,0.15f,4.0f, 6,0.0f,2.2f);
    gtr("gt_slide",  "SLIDE",    0xffaa6622, 0.005f,0.60f, 0,5500,  800,0.18f,0.40f,2.0f, 4,0.0f,2.0f);
    gtr("gt_funk",   "FUNK",     0xffffcc00, 0.001f,0.20f, 0,9000, 1500,0.06f,0.12f,1.5f, 0,0.0f,1.6f);
    gtr("gt_blues",  "BLUES",    0xffaa4400, 0.001f,0.45f, 0,4500,  700,0.14f,0.28f,2.2f, 6,0.0f,2.3f);
    gtr("gt_clean",  "CLEAN",    0xff88ccff, 0.001f,0.30f, 0,10000,1500,0.06f,0.22f,0.9f, 0,0.0f,1.3f);
    gtr("gt_crunch", "CRUNCH",   0xffcc4400, 0.001f,0.25f, 1,6000,  600,0.10f,0.18f,3.5f, 4,0.0f,2.4f);
    gtr("gt_wah",    "WAH",      0xffff8800, 0.001f,0.35f, 0,8000,  400,0.25f,0.22f,1.8f, 0,0.0f,8.0f);
    gtr("gt_12str",  "12 STRING",0xffeebb44, 0.001f,0.45f, 0,6000, 1000,0.12f,0.30f,1.2f,10,0.0f,1.5f);
    gtr("gt_steel",  "STEEL",    0xffcccccc, 0.001f,0.35f, 0,7500,  900,0.10f,0.20f,1.6f, 0,0.0f,1.8f);

    // ── BAGPIPES (pulse chanter + drone engine) ────────────────────────────────
    // params: id, name, col, atk, rel, pulseWidth, droneGain, droneLPHz,
    //         bagVibDepth, lfoFreq(vibRate), lpQ(nasalQ)
    auto bag = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, float pw, float dGain, float dLP,
                   float vibD, float vibR, float nasQ)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::BAGPIPES;
        p.pulseWidth=pw; p.droneGain=dGain; p.droneLPHz=dLP;
        p.bagVibDepth=vibD; p.lfoFreq=vibR; p.lpQ=nasQ;
        addPreset("BAGPIPES", p);
    };
    //              id            name        colour      atk    rel    pw     dGain  dLP  vibD   vibR  nasQ
    bag("bp_highld","HIGHLAND",  0xff00aa44, 0.02f,2.0f, 0.22f,0.35f, 280,0.008f,6.0f,2.5f);
    bag("bp_uillnn","UILLEANN",  0xff228844, 0.03f,2.0f, 0.18f,0.28f, 220,0.006f,5.0f,2.0f);
    bag("bp_drone", "DRONE",     0xff006622, 0.05f,4.0f, 0.30f,0.60f, 150,0.004f,4.0f,1.5f);
    bag("bp_march", "MARCH",     0xffcc8800, 0.01f,1.5f, 0.20f,0.30f, 300,0.010f,7.0f,3.0f);
    bag("bp_lament","LAMENT",    0xff004488, 0.06f,3.0f, 0.25f,0.40f, 200,0.005f,4.5f,2.2f);
    bag("bp_reel",  "REEL",      0xff22aa44, 0.01f,1.2f, 0.15f,0.25f, 350,0.012f,8.0f,3.5f);
    bag("bp_braw",  "BRAW",      0xff00cc66, 0.02f,2.0f, 0.28f,0.45f, 260,0.009f,6.5f,2.8f);
    bag("bp_pibrch","PIBROCH",   0xff008844, 0.04f,2.5f, 0.32f,0.50f, 180,0.007f,5.5f,2.5f);
    bag("bp_strath","STRATHSPEY",0xff00aa33, 0.01f,1.8f, 0.18f,0.32f, 290,0.011f,7.5f,3.2f);
    bag("bp_jig",   "JIG",       0xff44cc44, 0.01f,1.0f, 0.12f,0.20f, 400,0.015f,9.0f,4.0f);
    bag("bp_rebel", "REBEL",     0xff884400, 0.02f,2.0f, 0.26f,0.38f, 250,0.009f,6.0f,2.8f);
    bag("bp_pastrl","PASTORAL",  0xff66bb66, 0.04f,3.0f, 0.22f,0.55f, 200,0.005f,4.0f,2.0f);
    bag("bp_warlik","WARLIKE",   0xffcc2200, 0.01f,1.5f, 0.18f,0.25f, 320,0.013f,8.5f,3.8f);
    bag("bp_celtic","CELTIC",    0xff00bb88, 0.03f,2.2f, 0.24f,0.35f, 240,0.008f,5.8f,2.4f);
    bag("bp_ancien","ANCIENT",   0xff446644, 0.05f,3.5f, 0.35f,0.65f, 170,0.004f,3.5f,1.8f);

    // ── JOLA_EP (Rhodes-style electric piano engine) ───────────────────────────
    // params: id, name, col, atk, rel, tremoloRate, tremoloDepth, clickAmount,
    //         epDecayTime, sustainLevel, warmth, legLpHz, legLpQ, detuneCents
    auto ep = [&](const char* id, const char* name, uint32 col,
                  float atk, float rel, float tRate, float tDepth, float click,
                  float decay, float sust, float wrm, float lpHz, float lpQ_, float det)
    {
        PresetParams p;
        p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::JOLA_EP;
        p.tremoloRate=tRate; p.tremoloDepth=tDepth; p.clickAmount=click;
        p.epDecayTime=decay; p.sustainLevel=sust; p.warmth=wrm;
        p.legLpHz=lpHz; p.legLpQ=lpQ_; p.detuneCents=det;
        addPreset("JOLA_EP", p);
    };
    //              id            name        colour      atk    rel   tRate tDep  click decay sust  wrm   lpHz  lpQ  det
    ep("ep_rhodes", "RHODES",    0xffcc8844, 0.002f,2.5f, 3.0f,0.08f,0.15f,1.5f,0.20f,1.8f,1200,1.2f, 4);
    ep("ep_suitcse","SUITCASE",  0xffaa6633, 0.002f,2.8f, 3.5f,0.10f,0.12f,1.8f,0.18f,2.0f,1000,1.0f, 5);
    ep("ep_wurly",  "WURLY",     0xff886622, 0.001f,2.0f, 4.0f,0.06f,0.18f,1.2f,0.22f,1.5f,1500,1.4f, 3);
    ep("ep_stage",  "STAGE EP",  0xffcc7733, 0.002f,3.0f, 2.5f,0.09f,0.14f,2.0f,0.19f,2.2f, 900,0.9f, 6);
    ep("ep_jazz",   "JAZZ EP",   0xff884422, 0.003f,3.5f, 2.0f,0.07f,0.10f,2.5f,0.16f,2.5f, 800,0.8f, 8);
    ep("ep_bright", "BRIGHT EP", 0xffffcc44, 0.001f,2.0f, 5.0f,0.05f,0.20f,1.0f,0.25f,1.2f,2000,1.8f, 3);
    ep("ep_dark",   "DARK EP",   0xff442200, 0.003f,3.5f, 2.0f,0.12f,0.08f,3.0f,0.12f,3.0f, 600,0.7f, 6);
    ep("ep_funky",  "FUNKY EP",  0xffffaa00, 0.001f,1.5f, 6.0f,0.04f,0.25f,1.5f,0.30f,1.8f,2500,2.0f, 4);
    ep("ep_gospel", "GOSPEL EP", 0xff886622, 0.002f,2.5f, 3.0f,0.08f,0.15f,2.0f,0.22f,2.0f,1200,1.2f, 5);
    ep("ep_lofi",   "LO-FI EP",  0xffaa8844, 0.003f,2.0f, 3.5f,0.15f,0.20f,1.5f,0.25f,1.5f, 800,0.8f, 7);
    ep("ep_bell",   "BELL EP",   0xffaaddff, 0.001f,3.5f, 4.5f,0.03f,0.18f,0.8f,0.28f,1.0f,3000,2.5f, 2);
    ep("ep_soft",   "SOFT EP",   0xffddbbaa, 0.003f,3.0f, 2.5f,0.06f,0.10f,1.5f,0.18f,1.8f,1100,1.0f, 3);
    ep("ep_soul",   "SOUL EP",   0xffcc8833, 0.002f,2.8f, 3.0f,0.09f,0.14f,2.2f,0.20f,2.0f,1000,1.0f, 5);
    ep("ep_electrc","ELECTRIC",  0xff8888ff, 0.001f,2.2f, 4.0f,0.07f,0.22f,1.8f,0.24f,1.6f,1800,1.6f, 4);
    ep("ep_warm",   "WARM EP",   0xffdd9955, 0.003f,3.2f, 2.8f,0.10f,0.12f,2.5f,0.18f,2.3f, 950,0.9f, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
void SoulForgeSynthAudioProcessor::setCurrentProgram(int index)
{
    if (index < 0 || index >= (int)bank.size()) return;
    currentProgram = index;
    const auto& preset = bank[index];

    // Push atk/rel into apvts
    if (auto* a = apvts.getRawParameterValue("attack"))  a->store(preset.atk);
    if (auto* r = apvts.getRawParameterValue("release")) r->store(preset.rel);

    // Update all active voices
    for (int i = 0; i < synth.getNumVoices(); ++i)
        if (auto* v = dynamic_cast<SynthVoice*>(synth.getVoice(i)))
            v->setCurrentPreset(&bank[currentProgram]);
}

const juce::String SoulForgeSynthAudioProcessor::getProgramName(int index)
{
    if (index < 0 || index >= (int)bank.size()) return {};
    return bank[index].name;
}

bool SoulForgeSynthAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    if (layouts.getMainOutputChannelSet() != AudioChannelSet::stereo())
        return false;
    return true;
}

void SoulForgeSynthAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    synth.setCurrentPlaybackSampleRate(sampleRate);

    for (int i = 0; i < synth.getNumVoices(); ++i)
    {
        if (auto* v = dynamic_cast<SynthVoice*>(synth.getVoice(i)))
        {
            v->prepareToPlay(sampleRate, samplesPerBlock);
            if (!bank.empty())
                v->setCurrentPreset(&bank[0]);
        }
    }

    // Reverb
    juce::dsp::ProcessSpec spec;
    spec.sampleRate       = sampleRate;
    spec.maximumBlockSize = (juce::uint32)samplesPerBlock;
    spec.numChannels      = 2;

    reverb.prepare(spec);
    juce::dsp::Reverb::Parameters reverbParams;
    reverbParams.roomSize   = 0.5f;
    reverbParams.wetLevel   = 0.0f;  // controlled by param
    reverbParams.dryLevel   = 1.0f;
    reverbParams.damping    = 0.5f;
    reverb.setParameters(reverbParams);

    chorus.prepare(spec);
}

void SoulForgeSynthAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                                 juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    // Update preset on voices if program changed
    for (int i = 0; i < synth.getNumVoices(); ++i)
        if (auto* v = dynamic_cast<SynthVoice*>(synth.getVoice(i)))
            if (!bank.empty())
                v->setCurrentPreset(&bank[currentProgram]);

    synth.renderNextBlock(buffer, midiMessages, 0, buffer.getNumSamples());

    // Volume
    float vol = apvts.getRawParameterValue("volume")->load();
    buffer.applyGain(vol);

    // Reverb
    float reverbAmount = apvts.getRawParameterValue("reverb")->load();
    {
        juce::dsp::Reverb::Parameters rp;
        rp.roomSize   = 0.6f;
        rp.wetLevel   = reverbAmount * 0.6f;
        rp.dryLevel   = 1.0f - reverbAmount * 0.3f;
        rp.damping    = 0.5f;
        reverb.setParameters(rp);
        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> ctx(block);
        reverb.process(ctx);
    }

    // Chorus
    float chorusAmount = apvts.getRawParameterValue("chorus")->load();
    if (chorusAmount > 0.01f)
    {
        chorus.setRate(0.5f);
        chorus.setDepth(chorusAmount * 0.02f);
        chorus.setCentreDelay(7.0f);
        chorus.setFeedback(0.0f);
        chorus.setMix(chorusAmount * 0.4f);
        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> ctx(block);
        chorus.process(ctx);
    }
}

void SoulForgeSynthAudioProcessor::getStateInformation(juce::MemoryBlock& dest)
{
    auto state = apvts.copyState();
    state.setProperty("program", currentProgram, nullptr);
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, dest);
}

void SoulForgeSynthAudioProcessor::setStateInformation(const void* data, int size)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, size));
    if (xml)
    {
        auto state = juce::ValueTree::fromXml(*xml);
        apvts.replaceState(state);
        setCurrentProgram(state.getProperty("program", 0));
    }
}

juce::AudioProcessorEditor* SoulForgeSynthAudioProcessor::createEditor()
{
    return new SoulForgeSynthAudioProcessorEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoulForgeSynthAudioProcessor();
}
