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
    // GFUNK: portamento from previous pitch
    if (currentPreset && currentPreset->engine == EngineType::GFUNK
        && currentPreset->portaDur > 0.0f && currentFreq > 0.0)
    {
        // keep currentFreq as start, slide to new freq
        targetFreq = freq;
        // currentFreq stays as previous note freq
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

        // ── Pitch slide (BASS808 + GFUNK portamento) ──────────────────────────
        if (currentPreset->engine == EngineType::BASS808)
        {
            if (currentFreq > targetFreq)
            {
                double slideSamples = currentPreset->slideDur * sampleRate;
                double step = (currentFreq - targetFreq) / jmax(slideSamples, 1.0);
                currentFreq = jmax(targetFreq, currentFreq - step);
            }
        }
        else if (currentPreset->engine == EngineType::GFUNK && currentPreset->portaDur > 0.0f)
        {
            double slideSamples = currentPreset->portaDur * sampleRate;
            if (currentFreq < targetFreq)
                currentFreq = jmin(targetFreq, currentFreq + (targetFreq - currentFreq) / jmax(slideSamples, 1.0) * 4.0);
            else if (currentFreq > targetFreq)
                currentFreq = jmax(targetFreq, currentFreq - (currentFreq - targetFreq) / jmax(slideSamples, 1.0) * 4.0);
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
            case EngineType::OCTOBER:   sample = renderOCTOBER();   break;
            case EngineType::SUPERSAW:  sample = renderSUPERSAW();  break;
            case EngineType::GFUNK:     sample = renderGFUNK();     break;
            case EngineType::ASTRO:     sample = renderASTRO();     break;
            case EngineType::YEEZY:     sample = renderYEEZY();     break;
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
            else if (currentPreset->engine == EngineType::OCTOBER)
            {
                cutoff = currentPreset->legLpHz;
                Q      = currentPreset->legLpQ;
            }
            else if (currentPreset->engine == EngineType::SUPERSAW)
            {
                cutoff = currentPreset->legLpHz;
                Q      = currentPreset->legLpQ;
            }
            else if (currentPreset->engine == EngineType::GFUNK)
            {
                cutoff = currentPreset->legLpHz;
                Q      = currentPreset->legLpQ;
            }
            else if (currentPreset->engine == EngineType::ASTRO)
            {
                cutoff = currentPreset->legLpHz;
                Q      = currentPreset->legLpQ;
            }
            else if (currentPreset->engine == EngineType::YEEZY)
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

// ─────────────────────────────────────────────────────────────────────────────
// OCTOBER — underwater muffled keys (sine + sub, very low LP)
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderOCTOBER()
{
    const auto& p = *currentPreset;

    // Slightly detuned sine pair
    double f1 = freq * std::pow(2.0,  (double)p.legDetune / 1200.0);
    double f2 = freq * std::pow(2.0, -(double)p.legDetune / 1200.0);

    double osc  = std::sin(phase[0] * MathConstants<double>::twoPi) * 0.5
                + std::sin(phase[1] * MathConstants<double>::twoPi) * 0.5;
    advPhase(phase[0], f1);
    advPhase(phase[1], f2);

    // Sub sine at half freq
    double sub = std::sin(phase[2] * MathConstants<double>::twoPi) * p.legSubGain;
    advPhase(phase[2], freq * 0.5);

    return (osc + sub) * 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPERSAW — multi-saw unison (1–7 oscillators, tanh saturation)
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderSUPERSAW()
{
    const auto& p = *currentPreset;

    int n = jlimit(1, 7, p.numSaws);
    double out = 0.0;

    for (int i = 0; i < n; ++i)
    {
        double cents;
        if (n == 1) cents = 0.0;
        else        cents = p.detuneCents * (-1.0 + 2.0 * i / (double)(n - 1));
        double f = freq * std::pow(2.0, cents / 1200.0);
        out += sawSample(phase[i]);
        advPhase(phase[i], f);
    }
    out /= jmax(n, 1);

    return tanh_approx(out * p.saturation) / jmax(tanh_approx(p.saturation), 0.001) * 0.80;
}

// ─────────────────────────────────────────────────────────────────────────────
// GFUNK — sawtooth + portamento + saturation + sub
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderGFUNK()
{
    const auto& p = *currentPreset;

    double playFreq = (p.portaDur > 0.0f) ? currentFreq : freq;

    // Main saw + detuned saw
    double f1 = playFreq * std::pow(2.0,  (double)p.detuneCents / 1200.0);
    double f2 = playFreq * std::pow(2.0, -(double)p.detuneCents / 1200.0);
    double osc = sawSample(phase[0]) * 0.5 + sawSample(phase[1]) * 0.5;
    advPhase(phase[0], f1);
    advPhase(phase[1], f2);

    osc = tanh_approx(osc * p.saturation) / jmax(tanh_approx(p.saturation), 0.001);

    // Sub sine
    double sub = std::sin(phase[2] * MathConstants<double>::twoPi) * p.legSubGain;
    advPhase(phase[2], playFreq * 0.5);

    return (osc + sub) * 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASTRO — triangle + wobble LFO + bitcrush + distortion (Travis flute sound)
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderASTRO()
{
    const auto& p = *currentPreset;

    // Wobble LFO modulating frequency
    double lfoVal = std::sin(lfoPhase * MathConstants<double>::twoPi);
    double wobFreq = freq * (1.0 + lfoVal * p.wobbleDepth);
    advPhase(lfoPhase, p.wobbleRate);

    double sample = triSample(phase[0]);
    advPhase(phase[0], wobFreq);

    // Bitcrush
    if (p.bitSteps > 0)
        sample = bitcrush(sample, p.bitSteps);

    // Soft distortion
    sample = softclip(sample, p.distAmount);

    return sample * 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────
// YEEZY — 3 modes: 0=soul-chop triangle, 1=industrial square, 2=sine+sub
// ─────────────────────────────────────────────────────────────────────────────
double SynthVoice::renderYEEZY()
{
    const auto& p = *currentPreset;
    double sample = 0.0;

    if (p.yeezMode == 0)
    {
        // Soul-chop: triangle with simple high-pass (1-pole difference)
        double tri = triSample(phase[0]);
        advPhase(phase[0], freq);
        // Simple 1-pole HP: y[n] = x[n] - x[n-1] * coeff
        double hpCoeff = 1.0 - (MathConstants<double>::twoPi * p.hpHz / sampleRate);
        hpCoeff = jlimit(0.0, 0.9999, hpCoeff);
        double hpOut = tri - hpCoeff * driftPhase; // driftPhase reused as HP state
        driftPhase = tri * (1.0 - hpCoeff);
        sample = softclip(hpOut, p.saturation) * 0.80;
    }
    else if (p.yeezMode == 1)
    {
        // Industrial: square with hard clip
        double sq = squareSample(phase[0]);
        advPhase(phase[0], freq);
        double driven = sq * p.saturation;
        sample = jlimit(-1.0, 1.0, driven) * 0.70;
    }
    else // mode 2: cathedral sine + sub
    {
        double s = std::sin(phase[0] * MathConstants<double>::twoPi);
        advPhase(phase[0], freq);
        double sub = std::sin(phase[1] * MathConstants<double>::twoPi) * p.legSubGain;
        advPhase(phase[1], freq * 0.5);
        sample = softclip(s, p.saturation) * 0.6 + sub;
    }

    return sample;
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
    folderOrder = { "PIANO","VOICES","LEADS",
                    "PADS","BASS","GHIBLI","DS","SCIFI","VIKINGS","GYM","BASS808","VAPOR","HORROR",
                    "SAMURAI","CHERNOBYL","PIRATES","TRIBAL","CURIOSITY","XFILES",
                    "FLUTES","GUITARS","BAGPIPES","JOLA_EP",
                    "ANIME","RAP_FR","OCTOBER","KDOT","STARBOY","ASTRO",
                    "YEEZY","GIVEON","DAMSO","CAS","TORY","RNB","PHONK_BR" };

    folders["PIANO"]     = { "PIANO",     Colour(0xfff0d060) };
    folders["VOICES"]    = { "VOICES",    Colour(0xffff80cc) };
    folders["LEADS"]     = { "LEADS",     Colour(0xffffe040) };
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
    folders["ANIME"]     = { "ANIME",     Colour(0xffff69b4) };
    folders["RAP_FR"]    = { "RAP FR",    Colour(0xff0055ff) };
    folders["OCTOBER"]   = { "OCTOBER",   Colour(0xff2040a0) };
    folders["KDOT"]      = { "KDOT",      Colour(0xff8b0000) };
    folders["STARBOY"]   = { "STARBOY",   Colour(0xffc0003c) };
    folders["ASTRO"]     = { "ASTRO",     Colour(0xff8b4513) };
    folders["YEEZY"]     = { "YEEZY",     Colour(0xffc8a000) };
    folders["GIVEON"]    = { "GIVEON",    Colour(0xff2c1654) };
    folders["DAMSO"]     = { "DAMSO",     Colour(0xff1a1a2e) };
    folders["CAS"]       = { "CAS",       Colour(0xfff5a0c8) };
    folders["TORY"]      = { "TORY",      Colour(0xffe8a030) };
    folders["RNB"]       = { "RNB",       Colour(0xffc47028) };
    folders["PHONK_BR"]  = { "PHONK BR",  Colour(0xff22bb44) };

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

    // ── PIANO (Legacy sine/triangle) ──────────────────────────────────────────
    // params: id, name, col, atk, rel, wave, det, lp, Q, sub
    auto pno = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, int wave, float det, float lp, float Q, float sub=0.f){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=wave; p.legDetune=det; p.legLpHz=lp; p.legLpQ=Q; p.legSubGain=sub;
        addPreset("PIANO",p);
    };
    pno("steinway",  "STEINWAY",  0xfff0d060, 0.005f,2.5f, 0, 4,  2800,0.8f,0.10f);
    pno("upright",   "UPRIGHT",   0xffd4a840, 0.006f,1.8f, 0, 6,  2000,0.7f,0.08f);
    pno("boudoir",   "BOUDOIR",   0xffc89030, 0.008f,2.2f, 0, 5,  2200,0.7f,0.12f);
    pno("concert",   "CONCERT",   0xffffe880, 0.004f,3.0f, 0, 3,  3200,0.9f,0.12f);
    pno("baroque",   "BAROQUE",   0xffe8c060, 0.003f,1.5f, 1, 3,  4000,1.2f,0.00f);
    pno("lofi_pno",  "LOFI",      0xffc8a878, 0.008f,1.8f, 1,10,  1200,0.6f,0.10f);
    pno("cassette",  "CASSETTE",  0xffb89060, 0.010f,1.5f, 1,14,   900,0.5f,0.08f);
    pno("dusty",     "DUSTY",     0xffa07850, 0.012f,1.6f, 1,12,  1000,0.5f,0.10f);
    pno("midnight",  "MIDNIGHT",  0xff806040, 0.015f,2.0f, 1,15,   700,0.5f,0.08f);
    pno("wabi",      "WABI",      0xff907858, 0.020f,1.4f, 1,18,   600,0.4f,0.06f);
    pno("pno_rhodes","RHODES",    0xff60c8e0, 0.003f,1.5f, 0, 3,  4000,1.5f,0.00f);
    pno("pno_wurly", "WURLY",     0xff40a0c0, 0.004f,1.3f, 2, 4,  3500,1.8f,0.00f);
    pno("clavinet",  "CLAVI",     0xff20c080, 0.002f,0.9f, 2, 2,  5000,2.5f,0.00f);
    pno("dyno",      "DYNO",      0xff50d0a0, 0.003f,1.6f, 0, 3,  5000,2.0f,0.00f);
    pno("suitcase",  "SUITCASE",  0xff30b8b0, 0.005f,2.0f, 0, 5,  3000,1.2f,0.10f);
    pno("dark_pno",  "DARK",      0xff8060c0, 0.010f,3.5f, 0,10,   600,0.5f,0.20f);
    pno("requiem",   "REQUIEM",   0xff6040a0, 0.020f,4.0f, 0,12,   400,0.4f,0.25f);
    pno("noir",      "NOIR",      0xff5030c0, 0.008f,3.0f, 0, 8,   700,0.5f,0.18f);
    pno("gothic",    "GOTHIC",    0xff7050b0, 0.015f,3.5f, 0,14,   500,0.4f,0.22f);
    pno("abyss_p",   "ABYSS",     0xff4020a0, 0.030f,4.5f, 0,18,   300,0.4f,0.30f);
    pno("toy_pno",   "TOY",       0xfff080a0, 0.002f,0.8f, 1, 2,  8000,2.5f,0.00f);
    pno("musicbox",  "MUSICBOX",  0xffe870b0, 0.001f,1.5f, 0, 1,  6000,3.0f,0.00f);
    pno("kalimba",   "KALIMBA",   0xffff90c0, 0.001f,2.0f, 0, 2,  7000,2.8f,0.00f);
    pno("xylophone", "XYLO",      0xfff060a0, 0.001f,0.6f, 1, 1,  9000,2.0f,0.00f);
    pno("glocken",   "GLOCKEN",   0xffe8a0c8, 0.001f,1.8f, 0, 1,  8000,3.5f,0.00f);
    pno("prepared",  "PREPARED",  0xffa0d080, 0.010f,2.0f, 2,20,  3000,1.5f,0.10f);
    pno("cluster",   "CLUSTER",   0xff80c060, 0.008f,2.5f, 3,25,  2000,0.8f,0.20f);
    pno("inside",    "INSIDE",    0xff60a040, 0.005f,3.0f, 1,15,  4000,1.2f,0.10f);
    pno("bowed",     "BOWED",     0xff90c070, 0.500f,3.5f, 1, 8,  1500,0.6f,0.15f);
    pno("detuned",   "DETUNED",   0xff70b050, 0.008f,2.0f, 2,30,  2500,0.7f,0.10f);
    pno("jazz_p",    "JAZZ",      0xffe0a030, 0.004f,1.2f, 0, 5,  2500,0.8f,0.10f);
    pno("bebop",     "BEBOP",     0xffd09020, 0.003f,1.0f, 0, 3,  3500,1.2f,0.00f);
    pno("ballad",    "BALLAD",    0xffc8b040, 0.008f,2.0f, 0, 6,  2000,0.7f,0.15f);
    pno("smoky",     "SMOKY",     0xffb8a030, 0.010f,1.8f, 1, 8,  1500,0.6f,0.20f);
    pno("stride",    "STRIDE",    0xffd0b050, 0.003f,1.3f, 0, 4,  3000,1.0f,0.00f);
    pno("ambient_p", "AMBIENT",   0xff60a8e0, 0.500f,5.0f, 0,12,   800,0.5f,0.20f);
    pno("reverb_p",  "REVERB",    0xff4090d0, 0.010f,4.0f, 0, 8,  1200,0.6f,0.15f);
    pno("space_p",   "SPACE",     0xff3080c0, 0.300f,4.5f, 0,15,   600,0.4f,0.25f);
    pno("shimmer",   "SHIMMER",   0xff5098d8, 0.200f,3.5f, 1,10,  2000,0.7f,0.10f);
    pno("frozen",    "FROZEN",    0xff70b0e8, 1.000f,6.0f, 0,20,   400,0.4f,0.30f);
    pno("trap_p",    "TRAP",      0xffe06060, 0.003f,1.5f, 0, 5,  3000,1.0f,0.15f);
    pno("drill_p",   "DRILL",     0xffd05050, 0.002f,1.2f, 0, 4,  3500,1.2f,0.10f);
    pno("cloud_p",   "CLOUD",     0xffc07070, 0.008f,2.0f, 1, 8,  1800,0.6f,0.20f);
    pno("opium_p",   "OPIUM",     0xffe08080, 0.005f,1.8f, 0, 6,  2000,0.7f,0.18f);
    pno("emo_trap",  "EMOTRAP",   0xffd06060, 0.010f,2.5f, 1,10,  1500,0.5f,0.20f);
    pno("koto",      "KOTO",      0xffe8b060, 0.002f,1.5f, 1, 3,  5000,2.0f,0.00f);
    pno("gamelan",   "GAMELAN",   0xffd0a050, 0.001f,2.5f, 0, 2,  6000,3.0f,0.00f);
    pno("sitar_p",   "SITAR",     0xffc09040, 0.003f,1.8f, 2,15,  4000,2.0f,0.00f);
    pno("mbira",     "MBIRA",     0xffb08030, 0.001f,1.2f, 1, 2,  7000,2.5f,0.00f);
    pno("santur",    "SANTUR",    0xffd0b060, 0.002f,2.0f, 1, 4,  5500,2.2f,0.00f);
    pno("honky",     "HONKY",     0xffd4c060, 0.005f,1.0f, 0,20,  2500,0.8f,0.10f);
    pno("rag",       "RAG",       0xffc8b040, 0.004f,1.2f, 0,15,  2800,0.9f,0.00f);
    pno("silent_era","SILENT",    0xffb8a030, 0.003f,0.9f, 0,22,  1800,0.6f,0.00f);
    pno("motown_p",  "MOTOWN",    0xffe0c050, 0.004f,1.5f, 0, 8,  2200,0.7f,0.15f);
    pno("glamrock",  "GLAMROCK",  0xffd0d060, 0.003f,1.3f, 2,12,  3000,1.2f,0.10f);
    pno("melancholy","MELA",      0xff9080e0, 0.010f,3.0f, 0, 8,  1200,0.5f,0.15f);
    pno("hope",      "HOPE",      0xff80e090, 0.008f,2.5f, 0, 5,  2500,0.8f,0.10f);
    pno("anger",     "ANGER",     0xffe04040, 0.002f,0.8f, 2, 6,  4000,2.0f,0.00f);
    pno("tender",    "TENDER",    0xffe0a0b0, 0.015f,2.8f, 0, 4,  1800,0.7f,0.12f);
    pno("nostalgia", "NOSTALGIA", 0xffc0b090, 0.012f,2.5f, 1,10,  1400,0.5f,0.18f);
    pno("fm_grand",  "FMGRAND",   0xff40e0b0, 0.004f,2.0f, 0, 3,  4000,1.5f,0.10f);
    pno("fm_soft",   "FMSOFT",    0xff30d0a0, 0.008f,2.5f, 0, 4,  3000,1.0f,0.10f);
    pno("additive_p","ADDITIVE",  0xff50e8c0, 0.005f,2.2f, 0, 2,  5000,2.0f,0.10f);
    pno("wavetbl_p", "WAVE",      0xff60f0d0, 0.006f,1.8f, 1, 6,  3500,1.5f,0.05f);
    pno("granular_p","GRANULAR",  0xff70e8c8, 0.100f,2.5f, 2,15,  2000,0.7f,0.10f);
    pno("rain_p",    "RAIN",      0xff70b0d0, 0.010f,3.0f, 1, 6,  2000,0.6f,0.10f);
    pno("forest_p",  "FOREST",    0xff60a050, 0.020f,3.5f, 1,10,  1500,0.5f,0.20f);
    pno("cave_p",    "CAVE",      0xff809070, 0.015f,4.0f, 0, 8,  1000,0.5f,0.15f);
    pno("ocean_p",   "OCEAN",     0xff5090b0, 0.300f,5.0f, 0,15,   600,0.4f,0.30f);
    pno("wind_p",    "WIND",      0xff80a0c0, 0.400f,4.5f, 1,20,   400,0.4f,0.20f);
    pno("church_bel","CHURCH",    0xffd0d0a0, 0.001f,4.0f, 0, 0,  6000,3.0f,0.00f);
    pno("crystal",   "CRYSTAL",   0xffc0e0f0, 0.001f,3.0f, 0, 0,  8000,4.0f,0.00f);
    pno("metal_p",   "METAL",     0xffa0b0c0, 0.002f,2.0f, 2, 5,  5000,2.5f,0.00f);
    pno("tubular",   "TUBULAR",   0xffb0c0d0, 0.001f,3.5f, 0, 1,  7000,3.5f,0.00f);
    pno("bowl",      "BOWL",      0xffc0d0e0, 0.005f,5.0f, 0, 2,  4000,2.5f,0.10f);
    pno("broken",    "BROKEN",    0xff808080, 0.010f,1.5f, 2,25,  1500,0.6f,0.10f);
    pno("ghost_p",   "GHOST",     0xffb0b0b0, 0.020f,3.0f, 1,18,  1000,0.5f,0.20f);
    pno("haunted",   "HAUNTED",   0xff909090, 0.030f,3.5f, 3,20,   800,0.4f,0.25f);
    pno("decayed",   "DECAYED",   0xffa09090, 0.015f,2.5f, 1,22,  1200,0.5f,0.15f);
    pno("warped",    "WARPED",    0xffb0a0a0, 0.020f,2.0f, 2,30,  1000,0.5f,0.10f);
    pno("sine_p",    "SINE",      0xffe0e0e0, 0.005f,2.0f, 0, 0,  3000,0.8f,0.00f);
    pno("glass_p",   "GLASS",     0xffd0e8f0, 0.003f,2.5f, 0, 2,  4000,1.2f,0.00f);
    pno("satie",     "SATIE",     0xffd8e0f8, 0.008f,2.8f, 0, 3,  2500,0.7f,0.10f);
    pno("arvo",      "ARVO",      0xffc8d8f0, 0.020f,4.0f, 0, 5,  2000,0.6f,0.12f);
    pno("eno_p",     "ENO",       0xffb8c8e8, 0.300f,5.5f, 0, 8,  1500,0.5f,0.15f);
    pno("storm",     "STORM",     0xff6070c0, 0.005f,2.0f, 2, 8,  3500,1.5f,0.15f);
    pno("heroic",    "HEROIC",    0xff7080d0, 0.003f,1.8f, 2, 6,  4000,1.8f,0.10f);
    pno("tragic",    "TRAGIC",    0xff5060b0, 0.010f,3.0f, 0,10,   800,0.5f,0.20f);
    pno("epic",      "EPIC",      0xff8090e0, 0.008f,3.5f, 1,12,  1500,0.7f,0.20f);
    pno("lullaby",   "LULLABY",   0xffa0b0e8, 0.020f,3.0f, 0, 5,  1800,0.6f,0.15f);

    // ── VOICES (Legacy) ───────────────────────────────────────────────────────
    auto vox = [&](const char* id, const char* name, uint32 col,
                   float atk, float rel, int wave, float det, float lp, float Q, float sub=0.f){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::Legacy; p.legWave=wave; p.legDetune=det; p.legLpHz=lp; p.legLpQ=Q; p.legSubGain=sub;
        addPreset("VOICES",p);
    };
    vox("nuts",     "NUTS",    0xffff80cc, 0.35f,2.2f, 0,12,1200,0.5f,0.15f);
    vox("baritone", "BARI",    0xff8060a0, 0.10f,1.8f, 0, 5,1200,0.6f,0.25f);
    vox("tenor",    "TENOR",   0xffa080c0, 0.08f,1.5f, 0, 8,1800,0.7f,0.10f);
    vox("bass_vox", "BASS",    0xff604080, 0.15f,2.0f, 0, 4, 800,0.5f,0.35f);
    vox("falsetto", "FALSETTO",0xffc0a0e0, 0.05f,1.2f, 0,10,3000,1.2f,0.00f);
    vox("croon",    "CROON",   0xff9070b0, 0.12f,1.6f, 0, 7,1500,0.6f,0.20f);
    vox("soprano",  "SOPRANO", 0xffffb0e0, 0.06f,1.5f, 0,12,4000,1.5f,0.00f);
    vox("mezzo",    "MEZZO",   0xffe090c8, 0.08f,1.8f, 0,10,2800,1.0f,0.08f);
    vox("alto_vox", "ALTO",    0xffd070b0, 0.10f,2.0f, 0, 8,2000,0.8f,0.15f);
    vox("breathy",  "BREATHY", 0xffffd0f0, 0.04f,1.0f, 1, 6,5000,1.8f,0.00f);
    vox("belt",     "BELT",    0xffff50a0, 0.02f,0.8f, 2, 5,4500,2.0f,0.00f);
    vox("choir",    "CHOIR",   0xffe0c0f8, 0.30f,3.0f, 1,20,2000,0.7f,0.15f);
    vox("gospel",   "GOSPEL",  0xfff0d060, 0.10f,2.0f, 0,15,2500,0.8f,0.20f);
    vox("monks",    "MONKS",   0xffc0c0a0, 0.50f,4.0f, 0, 8,1000,0.5f,0.30f);
    vox("unison",   "UNISON",  0xffd0e0f0, 0.08f,2.5f, 2,25,2000,0.7f,0.15f);
    vox("madrigal", "MADRI",   0xffe8d0e0, 0.10f,2.2f, 1,18,2500,0.8f,0.10f);
    vox("vocoder",  "VOCODER", 0xff40e0ff, 0.02f,0.8f, 2,10,3500,2.0f,0.00f);
    vox("talkbox",  "TALKBOX", 0xff20d0e0, 0.01f,0.6f, 2, 8,4000,2.5f,0.00f);
    vox("glitch_v", "GLITCH",  0xff00ffcc, 0.005f,0.4f,3,15,5000,3.0f,0.00f);
    vox("pitch_v",  "PITCH",   0xff80ffe0, 0.03f,1.0f, 2,12,4500,2.0f,0.00f);
    vox("formant",  "FORMANT", 0xff60d0c0, 0.04f,1.2f, 2,10,3000,3.0f,0.00f);
    vox("trap_v",   "TRAP",    0xffff4080, 0.01f,1.5f, 2, 6,4000,2.0f,0.10f);
    vox("rnb_v",    "RNB",     0xffe06080, 0.02f,1.8f, 0, 8,2500,1.0f,0.10f);
    vox("pop_v",    "POP",     0xffff80b0, 0.01f,1.0f, 0, 5,5000,1.8f,0.00f);
    vox("jazz_v",   "JAZZ",    0xffd0a040, 0.05f,1.5f, 0, 7,3000,1.0f,0.10f);
    vox("opera_v",  "OPERA",   0xffc080e0, 0.08f,2.5f, 0,15,3500,1.2f,0.05f);
    vox("throat",   "THROAT",  0xffa08060, 0.20f,3.0f, 1,20,1500,0.8f,0.20f);
    vox("yodel",    "YODEL",   0xff80a060, 0.05f,0.8f, 1,25,3000,1.5f,0.00f);
    vox("pygmy",    "PYGMY",   0xff70b070, 0.08f,1.5f, 1,18,2000,0.8f,0.10f);
    vox("muezzin",  "MUEZZIN", 0xffd0a080, 0.10f,2.0f, 0,12,2500,0.9f,0.10f);
    vox("siren_v",  "SIREN",   0xff80d0ff, 0.30f,3.5f, 1,20,3000,1.0f,0.10f);

    // ── LEADS (mixed engines) ─────────────────────────────────────────────────
    {
        // SCIFI leads
        auto scl = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float mr, float mi, float lf, float lq, float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("LEADS",p);
        };
        scl("bladee",  "BLADEE",  0xff80e8ff, 0.010f,1.2f, 5.0f,4.0f,2.0f,6.0f,3.0f);
        scl("dx7_ld",  "DX7",     0xff60ff90, 0.005f,1.2f, 3.0f,5.0f,0.5f,5.0f,2.0f);
        scl("mono_arp","ARP",     0xff80ffff, 0.005f,0.5f, 2.0f,2.0f,3.0f,4.0f,2.0f);
        scl("seq_ld",  "SEQ",     0xffffff80, 0.010f,0.6f, 4.0f,3.0f,1.0f,5.0f,3.0f);
        scl("ring_ld", "RING",    0xffd0e080, 0.002f,0.8f, 3.5f,8.0f,0.5f,6.0f,4.0f);
        scl("trance",  "TRANCE",  0xff0080ff, 0.010f,1.5f, 2.5f,4.0f,0.8f,5.0f,3.0f);
        scl("afro_ld", "AFRO",    0xffff8840, 0.005f,0.6f, 3.0f,4.0f,2.0f,5.0f,3.0f);

        // SUPERSAW leads
        auto ssl = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float det, int ns, float sat, float lp, float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("LEADS",p);
        };
        ssl("kencar",  "KENCAR",  0xffffe040, 0.005f,0.8f, 20,7, 3.0f,12000,2.0f);
        ssl("hyper",   "HYPER",   0xffff00ff, 0.005f,0.8f, 22,7, 2.5f,10000,2.0f);
        ssl("pluck_l", "PLUCK",   0xffffff00, 0.001f,0.6f, 12,5, 2.0f,12000,2.5f);
        ssl("anthem",  "ANTHEM",  0xff00ffff, 0.020f,2.0f, 18,7, 1.5f, 6000,1.5f);
        ssl("oberheim","OB",      0xffff4050, 0.015f,1.6f, 15,5, 1.2f, 3500,0.9f);

        // GYM leads
        auto gml = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       int w, float cl, float bh, float bd, float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GYM; p.gymWave=w; p.clipAmount=cl; p.boostHz=bh; p.boostDB=bd; p.gymSub=sub;
            addPreset("LEADS",p);
        };
        gml("carti",   "CARTI",   0xffff4060, 0.005f,0.6f, 1,0.9f,3000,10,0.2f);
        gml("stab_ld", "STAB",    0xffff8000, 0.001f,0.4f, 1,0.7f,2500, 8,0.0f);
        gml("arcade",  "ARCADE",  0xffff80ff, 0.001f,0.3f, 0,0.5f,3000, 5,0.0f);
        gml("techno_l","TECHNO",  0xff404040, 0.005f,0.7f, 1,0.6f,1500, 6,0.0f);
        gml("hyperpop","HPOP",    0xffff40ff, 0.001f,0.4f, 1,0.9f,2000, 8,0.1f);

        // CHERNOBYL leads
        auto chl = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       int bs, float na, float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("LEADS",p);
        };
        chl("suicide",  "SUICIDE",  0xff9060ff, 0.020f,1.8f,  8,0.15f,3.0f);
        chl("noise_l",  "NOISE",    0xffaaaaaa, 0.001f,0.3f,  4,0.50f,5.0f);
        chl("bitcr_l",  "BITCR",    0xffb0c040, 0.001f,0.5f,  8,0.05f,2.0f);

        // VAPOR leads
        auto vpl = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float det, float ls, float le, float st, float vr, int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("LEADS",p);
        };
        vpl("future_l","FUTURE",  0xff40ff80, 0.030f,1.5f,  8, 800,5000,0.5f,0.3f,0);
        vpl("moog_l",  "MOOG",    0xffff9030, 0.010f,1.0f,  6, 500,3500,0.5f,0.1f,0);
        vpl("juno_l",  "JUNO",    0xff30c0ff, 0.020f,1.5f, 18,1500,5000,0.8f,0.4f,0);
        vpl("prophet", "PROPHET", 0xffff6030, 0.010f,1.3f, 12, 800,3500,0.6f,0.2f,0);
        vpl("riser_l", "RISER",   0xffff0080, 2.000f,0.1f, 25, 200,8000,2.0f,0.05f,0);

        // GFUNK reggaeton
        {
            PresetParams p; p.id="reggaeton"; p.name="REG"; p.colour=Colour(0xff30d060);
            p.atk=0.008f; p.rel=0.8f;
            p.engine=EngineType::GFUNK; p.detuneCents=12; p.portaDur=0.02f;
            p.saturation=1.8f; p.legLpHz=4000; p.legLpQ=1.5f; p.legSubGain=0.2f;
            addPreset("LEADS",p);
        }
        // ASTRO travis
        {
            PresetParams p; p.id="travis"; p.name="TRAVIS"; p.colour=Colour(0xffff8040);
            p.atk=0.15f; p.rel=2.0f;
            p.engine=EngineType::ASTRO; p.wobbleRate=3.0f; p.wobbleDepth=0.010f;
            p.bitSteps=96; p.distAmount=1.2f; p.legLpHz=4000; p.legLpQ=1.2f;
            addPreset("LEADS",p);
        }
    }

    // ── ANIME (VAPOR + SCIFI) ─────────────────────────────────────────────────
    {
        auto anv = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float det, float ls, float le, float st, float vr, int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("ANIME",p);
        };
        auto ans = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float mr, float mi, float lf, float lq, float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("ANIME",p);
        };
        anv("an_epic",   "EPIC",    0xffff4488, 0.30f,2.5f, 12, 600,4000,1.5f,0.20f,0);
        anv("an_choir",  "CHOIR",   0xffffaadd, 0.60f,3.0f,  5, 400,2000,2.0f,0.15f,2);
        anv("an_power",  "POWER",   0xffff2266, 0.05f,1.5f,  8,1500,6000,0.8f,0.30f,0);
        anv("an_dream",  "DREAM",   0xffcc88ff, 1.50f,4.0f,  4, 300,1200,3.0f,0.10f,2);
        anv("an_ghost",  "GHOST",   0xffeeeeff, 0.80f,3.5f, 18, 200,1000,2.5f,0.08f,2);
        ans("an_opening","OPENING", 0xffff8844, 0.01f,1.0f, 3.5f,3.0f,0.5f,5.0f,2.0f);
        ans("an_battle", "BATTLE",  0xffff0044, 0.001f,0.7f,5.0f,6.0f,2.5f,8.0f,5.0f);
        ans("an_hero",   "HERO",    0xffffcc00, 0.08f,1.2f, 2.0f,4.0f,0.8f,4.0f,3.0f);
        ans("an_villain","VILLAIN", 0xff660033, 0.30f,2.0f, 1.5f,10.f,0.2f,3.0f,7.0f);
        ans("an_mech",   "MECH",    0xff4488cc, 0.02f,0.8f, 7.0f,4.0f,1.5f,9.0f,4.0f);
        ans("an_crystal","CRYSTAL", 0xffaaddff, 0.001f,2.0f,4.0f,2.0f,0.3f,5.0f,2.0f);
        ans("an_portal", "PORTAL",  0xff8844ff, 0.10f,1.8f, 0.5f,5.0f,0.6f,4.0f,3.0f);
        anv("an_sakura", "SAKURA",  0xffffbbcc, 1.00f,3.5f,  6, 500,2000,2.0f,0.18f,1);
        ans("an_spirit", "SPIRIT",  0xff88ffee, 0.40f,3.0f,1.01f,15.f,0.1f,2.0f,8.0f);
        anv("an_rise",   "RISE",    0xffff6600, 0.20f,2.5f,  9, 400,5000,1.0f,0.22f,0);
        anv("an_wind",   "WIND",    0xffaaffcc, 0.60f,2.5f,  7, 600,2500,1.8f,0.14f,1);
        ans("an_fire",   "FIRE",    0xffff4400, 0.05f,1.2f, 4.5f,5.0f,3.0f,7.0f,4.0f);
        ans("an_cyber2", "CYBER",   0xff00ffcc, 0.001f,0.5f,6.0f,4.0f,2.0f,8.0f,3.0f);
        anv("an_tears",  "TEARS",   0xff88aaff, 2.00f,5.0f,  4, 200, 900,4.0f,0.08f,2);
    }

    // ── RAP_FR (VAPOR + SCIFI + BASS808) ─────────────────────────────────────
    {
        auto rfv = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float det, float ls, float le, float st, float vr, int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("RAP_FR",p);
        };
        auto rfs = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float mr, float mi, float lf, float lq, float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("RAP_FR",p);
        };
        auto rf8 = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                       float sf, float sd, float da, float st, float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st; p.b8Sub=sub;
            addPreset("RAP_FR",p);
        };
        rfv("rf_piano",   "PIANO MEL",  0xfff0d080, 0.002f,1.8f,  3,2000,6000,0.5f,0.10f,2);
        rfv("rf_violin",  "VIOLIN",     0xffcc8844, 0.050f,1.2f,  3,2500,7000,0.6f,0.35f,0);
        rfv("rf_strings", "STRINGS",    0xffaa6633, 0.300f,2.0f, 10, 800,3500,1.2f,0.25f,0);
        rfv("rf_icy",     "ICY",        0xffaaddff, 0.500f,3.0f,  8,1200,4000,1.5f,0.15f,0);
        rfv("rf_freeze",  "FREEZE",     0xff224488, 1.000f,4.0f, 15, 300,1200,2.5f,0.08f,2);
        rfs("rf_sch",     "SCH",        0xff330011, 0.100f,2.0f, 1.5f,8.0f,0.15f,3.0f,5.0f);
        rfv("rf_nekfeu",  "NEKFEU",     0xff4488cc, 0.050f,1.5f,  5,1000,3500,1.5f,0.20f,1);
        rfs("rf_booba",   "BOOBA",      0xff222288, 0.010f,1.0f, 2.0f,6.0f,0.8f,5.0f,4.0f);
        rfv("rf_church",  "EGLISE",     0xff888866, 0.100f,3.5f,  2,3000,8000,0.5f,0.05f,2);
        rfv("rf_night",   "NUIT",       0xff112244, 0.800f,3.0f,  7, 400,1800,2.0f,0.12f,2);
        rfv("rf_rain",    "PLUIE",      0xff88aacc, 1.500f,4.0f, 18, 200, 700,3.5f,0.08f,2);
        rf8("rf_trap808", "808 FR",     0xffff3300, 0.005f,2.5f, 2.0f,0.08f,2.5f,1.0f,0.0f);
        rf8("rf_bass_fr", "BASS FR",    0xffcc2200, 0.005f,2.0f, 1.8f,0.06f,3.0f,0.95f,0.0f);
        rfv("rf_organ",   "ORGUE",      0xff664422, 0.020f,1.5f,  4, 500,2000,1.0f,0.40f,0);
        rfv("rf_dark_pad","DARK PAD",   0xff1a0033, 1.000f,4.0f, 20, 150, 600,3.0f,0.05f,2);
        rfv("rf_soul",    "SOUL",       0xff885533, 0.100f,2.0f,  6, 800,2800,1.2f,0.30f,1);
        rfv("rf_guitar",  "GUITARE",    0xffcc8833, 0.005f,1.0f,  2,3000,7000,0.4f,0.15f,1);
        rfv("rf_brass",   "CUIVRES",    0xffcc9900, 0.100f,1.2f,  8,1500,5000,0.5f,0.28f,0);
        rfv("rf_drama",   "DRAMA",      0xff8800cc, 0.400f,3.0f, 12, 600,3000,1.5f,0.18f,0);
        rfv("rf_fog",     "BROUILLARD", 0xffaabbcc, 2.000f,5.0f, 22, 150, 600,4.0f,0.06f,2);
        rfs("rf_clock",   "HORLOGE",    0xff887755, 0.001f,1.5f, 4.0f,1.5f,0.1f,6.0f,2.0f);
        rfv("rf_ambi",    "AMBIANCE",   0xff445566, 1.500f,4.5f, 10, 300,1500,2.5f,0.10f,0);
        rfs("rf_jul",     "JUL",        0xffffcc00, 0.050f,1.0f, 3.0f,3.0f,1.5f,5.0f,3.0f);
    }

    // ── OCTOBER (underwater sine+sub) ─────────────────────────────────────────
    auto oct = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                   float lp, float lq, float sub, float det){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
        addPreset("OCTOBER",p);
    };
    oct("oct_6am",     "6AM IN TORONTO",  0xff1a2a6c,0.10f,3.0f,  380,0.6f,0.20f,3);
    oct("oct_marvins", "MARVINS ROOM",    0xff1a0a30,0.18f,4.0f,  320,0.5f,0.12f,5);
    oct("oct_hold",    "HOLD ON",         0xff304060,0.14f,3.5f,  420,0.7f,0.18f,4);
    oct("oct_passi",   "PASSION FRUIT",   0xffe08040,0.09f,2.8f,  520,0.8f,0.22f,3);
    oct("oct_under",   "UNDERWATER",      0xff0a1a40,0.16f,4.2f,  280,0.5f,0.15f,6);
    oct("oct_float",   "MIDNIGHT FLOAT",  0xff08080a,0.20f,4.5f,  300,0.5f,0.10f,4);
    oct("oct_weston",  "WESTON ROAD",     0xff283868,0.10f,3.2f,  450,0.7f,0.25f,4);
    oct("oct_softly",  "SOFTLY",          0xff8090c0,0.22f,4.8f,  260,0.4f,0.08f,5);
    oct("oct_ovo",     "OVO KEYS",        0xffc0a000,0.08f,2.6f,  500,0.8f,0.28f,3);
    oct("oct_fromtime","FROM TIME",       0xff6070a0,0.15f,3.8f,  350,0.6f,0.16f,4);
    oct("oct_views",   "VIEWS SUB",       0xff203060,0.06f,2.4f,  480,0.8f,0.42f,3);
    oct("oct_gods",    "GODS PLAN",       0xffd0a820,0.08f,2.6f,  550,0.9f,0.38f,3);
    oct("oct_certif",  "CERTIFIED",       0xffc0c0c0,0.07f,2.4f,  580,0.9f,0.32f,4);
    oct("oct_dark",    "DARK LANE",       0xff0a0a14,0.12f,3.4f,  340,0.6f,0.20f,5);
    oct("oct_sneaky",  "SNEAKIN",         0xff202840,0.08f,2.8f,  410,0.7f,0.30f,4);
    oct("oct_papi",    "PAPI PASSION",    0xff2a2060,0.07f,2.6f,  600,1.0f,0.26f,3);
    oct("oct_summer",  "SUMMER LOVE",     0xffe0c060,0.05f,2.2f,  640,1.0f,0.22f,3);
    oct("oct_blessed", "BLESSED",         0xffa08000,0.06f,2.4f,  620,1.0f,0.28f,4);
    oct("oct_notice",  "NOTICE ME",       0xff3050c0,0.10f,3.0f,  460,0.8f,0.18f,4);
    oct("oct_4422",    "LOVE YOU ALWAYS", 0xff2030a0,0.09f,3.0f,  400,0.7f,0.24f,4);
    oct("oct_choir",   "GHOST CHOIR",     0xff4050c0,0.14f,4.0f,  360,0.6f,0.14f,9);
    oct("oct_warm",    "WARM NIGHT",      0xffc08050,0.11f,3.2f,  490,0.8f,0.30f,6);
    oct("oct_haze",    "TORONTO HAZE",    0xff708090,0.18f,4.0f,  320,0.5f,0.18f,7);
    oct("oct_slow",    "SLOW DOWN",       0xff404878,0.25f,5.0f,  290,0.5f,0.10f,5);
    oct("oct_came",    "CAME UP",         0xffd0b040,0.06f,2.2f,  560,0.9f,0.35f,3);

    // ── KDOT (GFUNK West Coast) ────────────────────────────────────────────────
    auto kd = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  float det, float pd, float sat, float lp, float lq, float sub){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
        p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
        addPreset("KDOT",p);
    };
    kd("kd_compton",  "COMPTON GFUNK",  0xff8b0000,0.04f,2.0f, 14,0.0f,1.8f,2200,1.2f,0.20f);
    kd("kd_humble",   "HUMBLE BASS",    0xff400000,0.03f,1.6f,  5,0.0f,2.2f,1600,0.9f,0.38f);
    kd("kd_damn",     "DAMN SAW",       0xffd03000,0.02f,1.2f,  8,0.0f,3.2f,5000,2.0f,0.05f);
    kd("kd_nottf",    "NOT LIKE US",    0xffff2000,0.01f,0.9f,  4,0.0f,4.0f,7000,2.5f,0.00f);
    kd("kd_euphoria", "EUPHORIA LEAD",  0xffd08000,0.02f,1.2f,  6,0.0f,3.5f,4500,2.2f,0.05f);
    kd("kd_element",  "ELEMENT",        0xffe04000,0.02f,1.3f, 20,0.0f,2.8f,3000,1.6f,0.10f);
    kd("kd_wicked",   "WICKED",         0xff401040,0.03f,1.5f, 25,0.0f,2.0f,2000,1.2f,0.22f);
    kd("kd_crown",    "CROWN",          0xffffd700,0.05f,2.0f, 16,0.0f,1.5f,2800,1.3f,0.14f);
    kd("kd_alright",  "ALRIGHT",        0xff20c040,0.06f,2.2f, 18,0.0f,1.4f,2400,1.1f,0.18f);
    kd("kd_kung",     "KUNG FU GLIDE",  0xffe09020,0.04f,1.8f, 10,0.04f,1.6f,3500,1.5f,0.12f);
    kd("kd_count",    "COUNT ME OUT",   0xffa02020,0.03f,1.4f,  7,0.04f,2.6f,3800,1.8f,0.10f);
    kd("kd_butterfly","BUTTERFLY KEYS", 0xff6040c0,0.14f,3.2f, 22,0.0f,0.9f,1400,0.8f,0.12f);
    kd("kd_mortal",   "MORTAL MAN",     0xff304080,0.18f,3.5f, 28,0.0f,0.7f,1200,0.7f,0.08f);
    kd("kd_mother",   "MOTHER I SOBER", 0xffc0a080,0.20f,4.0f, 30,0.0f,0.6f,1000,0.6f,0.06f);
    kd("kd_sing",     "SING ABOUT ME",  0xff6080a0,0.16f,3.8f, 24,0.0f,0.8f,1500,0.8f,0.10f);
    kd("kd_poetic",   "POETIC JUSTICE", 0xffc080e0,0.10f,2.8f, 20,0.0f,1.1f,1800,1.0f,0.18f);
    kd("kd_vinyl",    "VINYL WEST",     0xff704020,0.08f,2.4f, 16,0.0f,2.5f,1800,0.9f,0.22f);
    kd("kd_good",     "GOOD KID",       0xff805030,0.06f,2.2f, 12,0.0f,1.8f,2000,1.0f,0.16f);
    kd("kd_mirror",   "MIRROR",         0xff80a0c0,0.12f,2.8f, 18,0.0f,1.2f,1700,0.9f,0.14f);
    kd("kd_rich",     "RICH SPIRIT",    0xffe0c000,0.04f,1.8f, 10,0.0f,2.0f,2600,1.4f,0.16f);
    kd("kd_maad",     "MAAD CITY",      0xff202020,0.03f,1.5f,  6,0.0f,2.4f,2200,1.3f,0.30f);
    kd("kd_swim",     "SWIM LANES",     0xff004080,0.07f,2.0f, 14,0.0f,1.7f,2400,1.2f,0.26f);
    kd("kd_duck",     "DUCKWORTH",      0xff905020,0.04f,1.7f,  9,0.0f,2.1f,2200,1.1f,0.20f);
    kd("kd_nle",      "COMPTON NIGHTS", 0xff0a0a20,0.06f,2.2f, 15,0.0f,1.9f,2000,1.0f,0.24f);
    kd("kd_dna",      "DNA LEAD",       0xffc04040,0.02f,1.2f,  4,0.0f,3.8f,6000,2.0f,0.08f);

    // ── STARBOY (SUPERSAW 80s synthwave) ──────────────────────────────────────
    auto sb = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  float det, int ns, float sat, float lp, float lq){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
        addPreset("STARBOY",p);
    };
    sb("sb_trilogy",  "TRILOGY SAW",    0xff202020,0.03f,1.8f,  8,3,1.2f, 6000,1.6f);
    sb("sb_heartless","HEARTLESS",      0xff101010,0.02f,1.4f,  6,3,2.0f, 8000,2.0f);
    sb("sb_sacrifice","SACRIFICE",      0xffff0040,0.01f,1.2f,  6,3,3.0f,12000,2.5f);
    sb("sb_gasoline", "GASOLINE",       0xffe08000,0.02f,1.4f, 10,3,2.8f,10000,2.2f);
    sb("sb_take",     "TAKE MY BREATH", 0xff40c0e0,0.02f,1.6f, 10,3,2.2f, 9000,1.8f);
    sb("sb_blinding", "BLINDING LIGHTS",0xffff2060,0.02f,2.0f, 16,5,1.8f, 5000,1.5f);
    sb("sb_dawn",     "DAWN FM",        0xffff8000,0.04f,2.2f, 14,5,1.5f, 4500,1.4f);
    sb("sb_moth",     "MOTH TO FLAME",  0xffffff00,0.03f,1.8f, 20,5,2.0f, 6500,1.8f);
    sb("sb_lead",     "STARBOY LEAD",   0xffffd700,0.02f,1.8f, 12,5,2.4f, 7000,2.0f);
    sb("sb_save",     "SAVE YOUR TEARS",0xff4080c0,0.04f,2.4f, 18,5,1.6f, 4000,1.4f);
    sb("sb_die",      "DIE FOR YOU",    0xffc00000,0.06f,2.8f, 22,5,1.4f, 3500,1.2f);
    sb("sb_double",   "DOUBLE FANTASY", 0xffff60c0,0.04f,2.2f, 16,5,1.9f, 5000,1.5f);
    sb("sb_xo",       "XO SERUM",       0xffe040a0,0.04f,2.4f, 20,7,2.0f, 5000,1.6f);
    sb("sb_neon",     "NEON BLADE",     0xff00e8ff,0.03f,2.2f, 25,7,2.2f, 6500,1.8f);
    sb("sb_cyber",    "CYBER ROMANCE",  0xff8000ff,0.08f,3.0f, 30,7,1.2f, 3500,1.1f);
    sb("sb_kiss",     "KISS LAND",      0xff300020,0.10f,3.5f, 35,7,0.9f, 2500,0.9f);
    sb("sb_loft",     "LOFT MUSIC",     0xff604060,0.12f,3.8f, 32,7,0.8f, 2000,0.8f);
    sb("sb_after",    "AFTER HOURS",    0xff800020,0.07f,3.2f, 28,7,1.1f, 2800,1.0f);
    sb("sb_belong",   "I BELONG TO YOU",0xffe080c0,0.08f,3.0f, 24,7,1.4f, 3800,1.3f);
    sb("sb_beauty",   "BEAUTY BEHIND",  0xffc060c0,0.06f,2.8f, 22,7,1.6f, 4000,1.4f);
    sb("sb_stargirl", "STARGIRL",       0xffa0c0ff,0.10f,3.2f, 26,7,1.0f, 3000,1.0f);
    sb("sb_sidewalk", "SIDEWALKS",      0xff606060,0.09f,3.0f, 28,7,1.2f, 2600,0.9f);
    sb("sb_in_good",  "IN GOOD HANDS",  0xff80e0a0,0.12f,3.4f, 30,7,1.0f, 3000,1.0f);
    sb("sb_neon2",    "NEON ANGELS",    0xffff40ff,0.05f,2.6f, 22,7,1.8f, 4500,1.6f);
    sb("sb_lostwaves","LOST IN WAVES",  0xffff6000,0.14f,4.0f, 35,7,0.7f, 1800,0.7f);

    // ── ASTRO (distorted flute / Travis Scott) ────────────────────────────────
    auto ast = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                   float wr, float wd, int bs, float da, float lp, float lq){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
        addPreset("ASTRO",p);
    };
    ast("as_goosebumps","GOOSEBUMPS",   0xff8b4513,0.03f,2.2f,3.5f,0.012f, 96,1.4f,3500,1.4f);
    ast("as_antidote",  "ANTIDOTE",     0xff60a000,0.04f,2.0f,4.0f,0.008f,128,1.0f,4500,1.2f);
    ast("as_highest",   "HIGHEST",      0xffc0c000,0.06f,2.8f,2.0f,0.015f, 96,1.2f,3000,1.1f);
    ast("as_star",      "STARGAZING",   0xff0030a0,0.10f,3.5f,1.5f,0.018f,128,0.9f,2500,1.0f);
    ast("as_bebe",      "BEBE",         0xffff80a0,0.06f,2.4f,3.0f,0.010f, 96,1.3f,3200,1.3f);
    ast("as_butterfly2","BUTTERFLY FX", 0xff604080,0.05f,2.4f,2.5f,0.014f, 80,1.5f,3500,1.4f);
    ast("as_way",       "WAY BACK",     0xff4060c0,0.08f,3.0f,2.2f,0.012f, 96,1.1f,2800,1.0f);
    ast("as_houstonia", "HOUSTONIA",    0xff804000,0.05f,2.6f,2.8f,0.010f, 80,1.4f,2600,1.1f);
    ast("as_utopia",    "UTOPIA LEAD",  0xffe08000,0.02f,1.8f,4.5f,0.015f, 48,2.0f,5000,1.6f);
    ast("as_night",     "NIGHTCRAWLER", 0xff200020,0.04f,2.4f,3.0f,0.018f, 48,1.8f,2800,1.3f);
    ast("as_cactus",    "CACTUS JACK",  0xffc06000,0.02f,1.6f,5.0f,0.014f, 32,2.4f,5500,1.8f);
    ast("as_escape",    "ESCAPE PLAN",  0xff402060,0.03f,1.8f,4.2f,0.012f, 32,2.2f,4500,1.6f);
    ast("as_lose",      "LOSE",         0xffe04040,0.02f,1.5f,5.0f,0.010f, 24,2.6f,6000,2.0f);
    ast("as_coords",    "COORDINATES",  0xff0080c0,0.03f,2.0f,3.8f,0.016f, 48,1.8f,4000,1.5f);
    ast("as_portal",    "PORTAL",       0xff00c0c0,0.02f,1.6f,5.5f,0.013f, 24,2.4f,5000,1.8f);
    ast("as_sicko",     "SICKO MODE",   0xff400000,0.03f,2.0f,2.0f,0.008f, 64,2.0f,2000,1.0f);
    ast("as_wave",      "WAVE",         0xff0040e0,0.12f,3.5f,1.8f,0.020f,128,0.8f,2200,0.9f);
    ast("as_moon",      "MOON PHASE",   0xffc0c0e0,0.14f,4.0f,1.2f,0.022f,128,0.7f,1800,0.8f);
    ast("as_dream",     "DREAMLAND",    0xff8080e0,0.10f,3.2f,2.0f,0.016f, 96,1.0f,2400,0.9f);
    ast("as_rodeo",     "RODEO",        0xffa04000,0.02f,1.2f,6.0f,0.018f, 16,3.0f,6000,2.2f);
    ast("as_pick",      "PICK UP PHONE",0xff20c020,0.01f,1.2f,6.5f,0.010f, 12,3.2f,7000,2.5f);
    ast("as_drugs",     "DRUGS YOU",    0xffa080c0,0.02f,1.4f,4.5f,0.020f, 20,2.8f,4500,1.8f);
    ast("as_jackboys",  "JACKBOYS",     0xffffff00,0.01f,1.0f,7.0f,0.012f,  8,3.5f,8000,3.0f);
    ast("as_kratos",    "KRATOS",       0xffcc0000,0.01f,1.0f,7.5f,0.008f,  6,4.0f,9000,2.8f);
    ast("as_theme",     "ASTRO THEME",  0xffe0a000,0.04f,2.2f,3.5f,0.013f, 64,1.6f,3500,1.4f);

    // ── YEEZY (3-mode soul/industrial/cathedral) ───────────────────────────────
    auto yz = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                  int mode, float sat, float lp, float lq, float sub, float hp){
        PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
        p.engine=EngineType::YEEZY; p.yeezMode=mode; p.saturation=sat;
        p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.hpHz=hp;
        addPreset("YEEZY",p);
    };
    // mode 0 — soul chop
    yz("yz_wire",    "THROUGH THE WIRE",0xffd4a017,0.05f,2.0f, 0,1.2f,4000,1.2f,0.10f,300);
    yz("yz_dropout", "COLLEGE DROPOUT", 0xffc09020,0.06f,2.4f, 0,1.0f,3500,1.0f,0.08f,250);
    yz("yz_diamonds","DIAMONDS",        0xffa0d0ff,0.08f,2.8f, 0,0.8f,3000,0.9f,0.06f,200);
    yz("yz_gold",    "GOLD DIGGER",     0xffffd700,0.04f,1.8f, 0,1.4f,4500,1.4f,0.12f,350);
    yz("yz_heard",   "HEARD EM SAY",    0xffe0c080,0.10f,3.0f, 0,0.9f,2800,0.9f,0.07f,220);
    yz("yz_roses",   "ROSES",           0xffff80a0,0.12f,3.2f, 0,0.7f,2600,0.8f,0.05f,180);
    yz("yz_flashing","FLASHING LIGHTS", 0xffff40ff,0.03f,1.6f, 0,1.6f,5000,1.6f,0.14f,400);
    yz("yz_stronger","STRONGER KEYS",   0xff8080ff,0.02f,1.4f, 0,1.8f,5500,1.8f,0.15f,450);
    // mode 1 — industrial
    yz("yz_skinhead","BLACK SKINHEAD",  0xff1a1a1a,0.01f,0.8f, 1,5.0f,9000,3.5f,0.00f,0);
    yz("yz_sight",   "ON SIGHT",        0xff303030,0.01f,0.7f, 1,4.5f,7000,3.0f,0.00f,0);
    yz("yz_send",    "SEND IT UP",      0xffc01020,0.01f,0.9f, 1,4.0f,5000,2.5f,0.00f,0);
    yz("yz_new",     "NEW SLAVES",      0xff202020,0.02f,1.2f, 1,3.0f,2500,1.8f,0.00f,0);
    yz("yz_blood",   "BLOOD ON LEAVES", 0xff800000,0.03f,1.6f, 1,2.0f,1200,1.4f,0.10f,0);
    yz("yz_guilt",   "GUILT TRIP",      0xff402040,0.02f,1.4f, 1,2.5f,3500,2.0f,0.00f,0);
    yz("yz_hold",    "HOLD MY LIQUOR",  0xff501020,0.05f,2.0f, 1,1.8f, 800,1.2f,0.15f,0);
    yz("yz_bound",   "BOUND 2",         0xff604020,0.04f,1.8f, 1,1.5f, 600,1.0f,0.20f,0);
    // mode 2 — cathedral
    yz("yz_moon",    "MOON KEYS",       0xffe0e8ff,0.15f,4.0f, 2,1.0f,2500,0.8f,0.30f,0);
    yz("yz_jail",    "JAIL SUB",        0xff202040,0.08f,3.0f, 2,1.2f,2000,0.9f,0.50f,0);
    yz("yz_carnival","CARNIVAL ORGAN",  0xffe04060,0.05f,2.2f, 2,1.5f,3000,1.1f,0.20f,0);
    yz("yz_heaven",  "HEAVEN GATE",     0xfffffdd0,0.20f,5.0f, 2,0.6f,1800,0.7f,0.15f,0);
    yz("yz_rumi",    "RUMI LULLABY",    0xffc0e0ff,0.18f,4.5f, 2,0.8f,2200,0.8f,0.18f,0);
    yz("yz_donda",   "DONDA CHANT",     0xff808080,0.12f,3.5f, 2,1.1f,2400,0.9f,0.35f,0);
    yz("yz_24",      "24",              0xffffffff,0.25f,5.5f, 2,0.5f,1600,0.7f,0.12f,0);
    yz("yz_come",    "COME TO LIFE",    0xffffd0a0,0.14f,4.0f, 2,0.9f,2600,0.9f,0.25f,0);
    yz("yz_believe", "I BELIEVE",       0xffd0c0e0,0.10f,3.2f, 2,1.0f,2300,0.8f,0.28f,0);

    // ── GIVEON ────────────────────────────────────────────────────────────────
    {
        auto gvep = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                        float tr, float td, float det, float lp, float lq, float cl, float dc, float sl, float wm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::JOLA_EP; p.tremoloRate=tr; p.tremoloDepth=td; p.detuneCents=det;
            p.legLpHz=lp; p.legLpQ=lq; p.clickAmount=cl; p.epDecayTime=dc; p.sustainLevel=sl; p.warmth=wm;
            addPreset("GIVEON",p);
        };
        gvep("gv_heartbreak","HEARTBREAK ANNIV",0xff2c1654,0.05f,2.5f,3.5f,0.06f, 3,1400,1.0f,0.12f,2.0f,0.25f,1.5f);
        gvep("gv_late_keys", "LATE NIGHT KEYS", 0xff1a1030,0.07f,3.0f,1.5f,0.03f, 6,1000,1.0f,0.08f,2.5f,0.30f,2.5f);

        auto gvsc = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                        float mr, float mi, float lf, float lq, float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("GIVEON",p);
        };
        gvsc("gv_gospel",   "GOSPEL SINE",    0xff4a2060,0.10f,3.0f,1.5f,1.0f,0.3f,2.0f,0.5f);
        gvsc("gv_soul_bell","SOUL BELL",       0xff6040a0,0.001f,2.0f,4.0f,0.8f,0.0f,8.0f,0.0f);

        auto gvvp = [&](const char* id, const char* name, uint32 col, float atk, float rel,
                        float det, float ls, float le, float st, float vr, int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("GIVEON",p);
        };
        gvvp("gv_soul_pad", "SOUL PAD",        0xff1a0a30,0.30f,3.5f, 8, 400,2000,2.5f,0.20f,2);
        gvvp("gv_cine_dread","CINEMATIC DREAD", 0xff100820,0.80f,4.5f,20, 200,1000,4.0f,0.10f,0);

        auto gvoct=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float lp,float lq,float sub,float det){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
            addPreset("GIVEON",p);
        };
        gvoct("gv_deep_muff","DEEP MUFFLED",  0xff0a0520,0.12f,3.8f,350,0.6f,0.40f,5);
        gvoct("gv_4am",      "4AM CONFESSION",0xff08040f,0.18f,4.5f,280,0.5f,0.15f,7);

        auto gvsam=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pd,float res,float hm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SAMURAI; p.pluckDecay=pd; p.lpQ=res; p.harmMix=hm;
            addPreset("GIVEON",p);
        };
        gvsam("gv_soul_pluck","SOUL PLUCK",   0xff3a1540,0.01f,2.0f,0.8f, 6,0.30f);
        gvsam("gv_resonant",  "RESONANT SOUL",0xff5030a0,0.001f,2.5f,1.5f,12,0.15f);

        auto gvvk=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float sub,float lp,float sat,int w){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VIKINGS; p.detuneCents=det; p.subGain=sub; p.vikLpHz=lp; p.saturation=sat; p.waves=w;
            addPreset("GIVEON",p);
        };
        gvvk("gv_dark_choir","DARK CHOIR",    0xff2a1060,0.25f,3.2f,12,0.20f,1200,1.0f,3);

        auto gvhr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float dr,int bs,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::HORROR; p.horModRatio=mr; p.driftAmount=dr; p.bitSteps=bs; p.horLpHz=lp; p.horLpQ=lq;
            addPreset("GIVEON",p);
        };
        gvhr("gv_drift_silk","DRIFT SILK",    0xff201030,0.40f,4.0f,1.005f,0.003f,64,2000,1.2f);

        auto gvgf=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float pd,float sat,float lp,float lq,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
            addPreset("GIVEON",p);
        };
        gvgf("gv_neo_lead","NEO SOUL LEAD",   0xff5a2080,0.05f,2.0f,18,0.0f,0.8f,2500,1.0f,0.20f);

        auto gvpt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float vr,float vd,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::PIRATES; p.detuneCents=det; p.vibRate=vr; p.vibDepth=vd; p.lpQ=lq;
            addPreset("GIVEON",p);
        };
        gvpt("gv_neo_str","NEO STRINGS",      0xff4030a0,0.20f,2.8f,15,3.5f,0.007f,1.5f);

        auto gvgt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      int wt,float fo,float fc,float ft,float fq,float da,float det,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GUITAR; p.guitWave=wt; p.filterOpen=fo; p.filterClose=fc;
            p.filterTime=ft; p.lpQ=fq; p.distAmount=da; p.detuneCents=det; p.bodyDecay=bd; p.legSubGain=sub;
            addPreset("GIVEON",p);
        };
        gvgt("gv_strum","SOULFUL STRUM",      0xff2a1020,0.01f,1.8f,0,3500,800,0.2f,1.5f,1.1f,5,0.4f,0.0f);

        auto gvtrib=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float dc,float fhz,float pch){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::TRIBAL; p.atk=atk; p.formantHz=fhz; p.punch=pch;
            addPreset("GIVEON",p);
        };
        gvtrib("gv_formant","SOUL FORMANT",   0xff3a2060,0.08f,1.5f,0.5f,500,2.5f);

        auto gvchrn=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        int bs,float na,float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("GIVEON",p);
        };
        gvchrn("gv_vinyl_soul","VINYL SOUL",  0xff4a2840,0.08f,2.2f,32,0.04f,1.5f);

        auto gvgym=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       int wv,float cl,float bh,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GYM; p.gymWave=wv; p.clipAmount=cl; p.boostHz=bh; p.boostDB=bd; p.gymSub=sub;
            addPreset("GIVEON",p);
        };
        gvgym("gv_dark_punch","DARK PUNCH",   0xff281040,0.02f,1.4f,0,0.3f,600,4,0.30f);

        auto gvast=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float wr,float wd,int bs,float da,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("GIVEON",p);
        };
        gvast("gv_smooth","SMOOTH LIKE",      0xff2a1858,0.06f,2.4f,1.2f,0.006f,128,0.8f,2200,0.9f);

        auto gvss=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,int ns,float sat,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("GIVEON",p);
        };
        gvss("gv_orch_dark","ORCHESTRAL DARK",0xff1a0840,0.35f,3.5f,28,7,0.5f,1800,0.7f);
        gvss("gv_lush_wall","LUSH DARK WALL", 0xff150a30,0.40f,4.0f,35,7,0.4f,1500,0.6f);

        gvoct("gv_cathedral","CATHEDRAL",     0xffe8d0ff,0.20f,5.0f,2000,0.8f,0.20f,0);

        auto gvb8=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float sf,float sd,float da,float st){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st;
            addPreset("GIVEON",p);
        };
        gvb8("gv_like_you","LIKE I WANT YOU", 0xff180830,0.04f,2.2f,1.0f,0.001f,1.0f,1.0f);
        gvb8("gv_warmth808","WARMTH",          0xff3a1a50,0.04f,2.0f,1.5f,0.08f,1.5f,1.0f);

        auto gvbag=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pw,float dg,float dlp,float vr,float vd,float br,float nq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BAGPIPES; p.pulseWidth=pw; p.droneGain=dg; p.droneLPHz=dlp;
            p.lfoFreq=vr; p.bagVibDepth=vd; p.legLpHz=br; p.lpQ=nq;
            addPreset("GIVEON",p);
        };
        gvbag("gv_dark_organ","DARK ORGAN",   0xff3c2060,0.06f,2.5f,0.45f,0.15f,120,2.5f,0.003f,1800,1.0f);
    }

    // ── DAMSO ─────────────────────────────────────────────────────────────────
    {
        auto dmhr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float dr,int bs,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::HORROR; p.horModRatio=mr; p.driftAmount=dr; p.bitSteps=bs; p.horLpHz=lp; p.horLpQ=lq;
            addPreset("DAMSO",p);
        };
        dmhr("dm_ipseit",  "IPSEITE",         0xff1a1a2e,0.01f,1.8f,1.02f,0.04f, 8,1200,3.0f);
        dmhr("dm_extreme", "EXTREME",         0xff0a0204,0.01f,1.0f,1.04f,0.06f, 4, 600,5.0f);
        dmhr("dm_fm_sub",  "FM SOUS-GRAVE",   0xff04040c,0.04f,2.0f,0.5f, 0.10f, 96,2000,4.0f);

        auto dmb8=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float sf,float sd,float da,float st){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st;
            addPreset("DAMSO",p);
        };
        dmb8("dm_808dark","BATTERIE FAIBLE",  0xff0d0d1a,0.02f,1.4f,3.0f,0.12f,4.0f,1.0f);

        auto dmgym=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       int wv,float cl,float bh,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GYM; p.gymWave=wv; p.clipAmount=cl; p.boostHz=bh; p.boostDB=bd; p.gymSub=sub;
            addPreset("DAMSO",p);
        };
        dmgym("dm_industrial","PACIFIQUE",    0xff2a0a0a,0.01f,1.0f,0,0.9f,3000,10,0.0f);
        dmgym("dm_square_ind","CARRE INDUS",  0xff1a1008,0.01f,1.1f,1,0.5f,1000, 8,0.0f);

        auto dmchrn=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        int bs,float na,float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("DAMSO",p);
        };
        dmchrn("dm_noise",  "BRUIT BLANC",   0xff080808,0.01f,1.2f, 4,0.35f,5.0f);
        dmchrn("dm_noise2", "CHAOS BLANC",   0xff080408,0.01f,1.4f,20,0.50f,2.0f);

        auto dmsc=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float mi,float lf,float lq,float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("DAMSO",p);
        };
        dmsc("dm_fm_cold","FM FROID",         0xff0a1020,0.03f,2.0f,7.0f,8.0f,0.05f,8.0f,0.5f);

        dmgym("dm_ind_square2","BLACK MIRROR",0xff1a1a1a,0.01f,0.9f,1,0.9f,1800, 8,0.0f);
        // reuse YEEZY mode1 via raw preset
        {
            PresetParams p; p.id="dm_ind_sq"; p.name="BLACK MIRROR"; p.colour=Colour(0xff1a1a1a);
            p.atk=0.01f; p.rel=0.9f;
            p.engine=EngineType::YEEZY; p.yeezMode=1; p.saturation=5.0f;
            p.legLpHz=9000; p.legLpQ=3.5f; p.legSubGain=0.0f; p.hpHz=0;
            addPreset("DAMSO",p);
        }

        auto dmast=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float wr,float wd,int bs,float da,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("DAMSO",p);
        };
        dmast("dm_glitch","GLITCH PSYCHO",    0xff1a0a2a,0.02f,1.5f,5.5f,0.020f, 8,3.5f,2500,2.0f);

        auto dmvk=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float sub,float lp,float sat,int w){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VIKINGS; p.detuneCents=det; p.subGain=sub; p.vikLpHz=lp; p.saturation=sat; p.waves=w;
            addPreset("DAMSO",p);
        };
        dmvk("dm_cold_saws","SCIE FROIDE",    0xff0a0a14,0.03f,1.8f, 4,0.50f, 500,4.0f,3);

        auto dmvp=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float ls,float le,float st,float vr,int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("DAMSO",p);
        };
        dmvp("dm_dark_sweep","DESCENTE",      0xff10101a,0.05f,2.2f,25, 150, 600,0.4f,0.05f,0);
        dmvp("dm_sub_sweep", "VAGUE GRAVE",   0xff060610,0.08f,2.5f, 0,  80, 400,0.8f,0.00f,2);

        auto dmtrib=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float fhz,float pch){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::TRIBAL; p.formantHz=fhz; p.punch=pch;
            addPreset("DAMSO",p);
        };
        dmtrib("dm_punch_dark","PERCUSSION",  0xff0f0f0f,0.01f,0.8f,350,7.0f);
        dmtrib("dm_max_punch", "IMPACT MAX",  0xff0f0808,0.001f,0.6f,200,10.0f);

        auto dmsam=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pd,float res,float hm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SAMURAI; p.pluckDecay=pd; p.lpQ=res; p.harmMix=hm;
            addPreset("DAMSO",p);
        };
        dmsam("dm_short_plk","PLUCK SEC",     0xff14141e,0.001f,1.0f,0.08f,14,0.05f);

        auto dmpt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float vr,float vd,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::PIRATES; p.detuneCents=det; p.vibRate=vr; p.vibDepth=vd; p.lpQ=lq;
            addPreset("DAMSO",p);
        };
        dmpt("dm_slow_vib","VIBRATION BASSE", 0xff0a0a10,0.06f,2.5f, 5,0.3f,0.030f,6.0f);

        auto dmgt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      int wt,float fo,float fc,float ft,float fq,float da,float det,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GUITAR; p.guitWave=wt; p.filterOpen=fo; p.filterClose=fc;
            p.filterTime=ft; p.lpQ=fq; p.distAmount=da; p.detuneCents=det; p.bodyDecay=bd; p.legSubGain=sub;
            addPreset("DAMSO",p);
        };
        dmgt("dm_dark_pluck","CORDE NOIRE",   0xff180808,0.001f,1.2f,0, 600,150,0.05f,4.0f,4.0f,0,0.08f,0.0f);

        auto dmbag=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pw,float dg,float dlp,float vr,float vd,float br,float nq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BAGPIPES; p.pulseWidth=pw; p.droneGain=dg; p.droneLPHz=dlp;
            p.lfoFreq=vr; p.bagVibDepth=vd; p.legLpHz=br; p.lpQ=nq;
            addPreset("DAMSO",p);
        };
        dmbag("dm_drone","BOURDON NOIR",      0xff050508,0.04f,3.0f,0.07f,0.80f,500,0.0f,0.0f,800,5.0f);

        auto dmgf=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float pd,float sat,float lp,float lq,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
            addPreset("DAMSO",p);
        };
        dmgf("dm_cold_bass","BASSE FROIDE",   0xff0a0a18,0.02f,1.6f, 3,0.0f,5.0f, 600,2.0f,0.0f);

        auto dmoct=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float lp,float lq,float sub,float det){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
            addPreset("DAMSO",p);
        };
        dmoct("dm_cave",    "CAVE",           0xff04040a,0.15f,3.5f,220,0.4f,0.08f,2);

        auto dmss=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,int ns,float sat,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("DAMSO",p);
        };
        dmss("dm_3saws","TROIS SAWS FROIDS",  0xff0c0c20,0.03f,1.8f, 6,3,4.0f,1800,2.5f);

        auto dmep=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float tr,float td,float det,float lp,float lq,float cl,float dc,float sl,float wm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::JOLA_EP; p.tremoloRate=tr; p.tremoloDepth=td; p.detuneCents=det;
            p.legLpHz=lp; p.legLpQ=lq; p.clickAmount=cl; p.epDecayTime=dc; p.sustainLevel=sl; p.warmth=wm;
            addPreset("DAMSO",p);
        };
        dmep("dm_dark_ep","EP NOIR",          0xff10080a,0.04f,1.8f,0.0f,0.0f, 2, 800,1.5f,0.0f,0.8f,0.10f,4.0f);

        {
            PresetParams p; p.id="dm_yeezy_cave"; p.name="YEEZY CAVE"; p.colour=Colour(0xff050510);
            p.atk=0.12f; p.rel=3.2f;
            p.engine=EngineType::YEEZY; p.yeezMode=2; p.saturation=2.0f;
            p.legLpHz=600; p.legLpQ=0.8f; p.legSubGain=0.50f; p.hpHz=0;
            addPreset("DAMSO",p);
        }
    }

    // ── CAS ───────────────────────────────────────────────────────────────────
    {
        auto casvp=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float ls,float le,float st,float vr,int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("CAS",p);
        };
        casvp("ca_dream_sw","DREAM SWEEP",    0xffc8a0f0,0.30f,4.0f, 8, 300,4000,2.5f,0.15f,2);
        casvp("ca_float_sw","FLOATING SWEEP", 0xffc8d8f8,0.50f,5.0f, 5, 500,5000,3.5f,0.08f,1);
        casvp("ca_warm_sw", "WARM SWEEP",     0xffc88830,0.20f,2.6f, 6, 800,6000,0.8f,0.20f,1);

        auto casss=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,int ns,float sat,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("CAS",p);
        };
        casss("ca_shoegaze","SHOEGAZE WALL",  0xffb060c0,0.40f,4.5f,32,7,0.4f,2000,0.7f);
        casss("ca_thin_shine","THIN SHIMMER", 0xfff0f0ff,0.04f,2.0f,10,3,0.3f,9000,1.0f);
        casss("ca_wide_dream","WIDE DREAM",   0xffb0a0d0,0.35f,4.5f,30,2,0.4f,2200,0.9f);
        casss("ca_gentle_pad","GENTLE PAD",   0xffb8a8d8,0.40f,4.2f,22,3,0.5f,1800,0.8f);

        auto cassc=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float mr,float mi,float lf,float lq,float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("CAS",p);
        };
        cassc("ca_fm_ether","FM ETHERE",      0xffe0c0ff,0.10f,3.0f,1.0f,0.5f,0.2f,3.0f,0.3f);
        cassc("ca_fm_fast", "FM SCINTILLANT", 0xffe8d0ff,0.05f,2.5f,3.0f,0.4f,5.0f,6.0f,1.0f);

        auto casoct=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float lp,float lq,float sub,float det){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
            addPreset("CAS",p);
        };
        casoct("ca_intimate","CHAMBRE ROSE",  0xfff0a0b8,0.12f,3.8f,480,0.7f,0.12f,5);
        casoct("ca_open_oct","OPEN DREAM",    0xffffd8f0,0.10f,3.5f,600,0.8f,0.18f,4);

        auto cassam=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float pd,float res,float hm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SAMURAI; p.pluckDecay=pd; p.lpQ=res; p.harmMix=hm;
            addPreset("CAS",p);
        };
        cassam("ca_soft_pluck","SOFT PLUCK",  0xffc0a0d8,0.001f,2.5f,0.6f, 5,0.20f);
        cassam("ca_long_pluck","PLUCK ETERNEL",0xfff0e8ff,0.001f,3.5f,2.0f, 8,0.22f);

        auto casep=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float tr,float td,float det,float lp,float lq,float cl,float dc,float sl,float wm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::JOLA_EP; p.tremoloRate=tr; p.tremoloDepth=td; p.detuneCents=det;
            p.legLpHz=lp; p.legLpQ=lq; p.clickAmount=cl; p.epDecayTime=dc; p.sustainLevel=sl; p.warmth=wm;
            addPreset("CAS",p);
        };
        casep("ca_ep_dream","EP REVE",         0xfff8c0e0,0.06f,3.0f,2.0f,0.04f, 5,1600,1.0f,0.06f,2.0f,0.28f,1.4f);
        casep("ca_ep_church","EP EGLISE",      0xffe8e0ff,0.08f,4.0f,0.8f,0.02f, 4,1200,0.9f,0.04f,3.0f,0.35f,1.2f);

        auto casgt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       int wt,float fo,float fc,float ft,float fq,float da,float det,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GUITAR; p.guitWave=wt; p.filterOpen=fo; p.filterClose=fc;
            p.filterTime=ft; p.lpQ=fq; p.distAmount=da; p.detuneCents=det; p.bodyDecay=bd; p.legSubGain=sub;
            addPreset("CAS",p);
        };
        casgt("ca_pluck_clean","PLUCK CRISTAL",0xffd8e8f8,0.001f,2.0f,0,6000,2000,0.3f,1.0f,0.8f,3,0.3f,0.0f);

        auto casgf=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float pd,float sat,float lp,float lq,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
            addPreset("CAS",p);
        };
        casgf("ca_soft_warm","ANALOG VELVET",  0xffe8c0d8,0.05f,2.5f,20,0.0f,0.6f,3000,0.9f,0.10f);

        auto caschrn=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                         int bs,float na,float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("CAS",p);
        };
        caschrn("ca_dust",  "POUSSIERE",       0xffe0d8f0,0.10f,3.5f,96,0.02f,0.8f);

        auto cashr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float mr,float dr,int bs,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::HORROR; p.horModRatio=mr; p.driftAmount=dr; p.bitSteps=bs; p.horLpHz=lp; p.horLpQ=lq;
            addPreset("CAS",p);
        };
        cashr("ca_drift",   "DRIFT NOCTURNE",  0xffa0a8c8,0.50f,4.5f,1.003f,0.002f,96,2500,1.0f);

        auto caspt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float vr,float vd,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::PIRATES; p.detuneCents=det; p.vibRate=vr; p.vibDepth=vd; p.lpQ=lq;
            addPreset("CAS",p);
        };
        caspt("ca_str_vib","STRING VIBRATO",   0xffd080e0,0.20f,3.5f,12,3.8f,0.008f,1.2f);
        caspt("ca_fast_vib","VIBRATO RAPIDE",  0xffd8c0f8,0.15f,3.0f, 8,7.0f,0.012f,0.9f);

        auto castrib=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                         float fhz,float pch){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::TRIBAL; p.formantHz=fhz; p.punch=pch;
            addPreset("CAS",p);
        };
        castrib("ca_soft_bell","BELL FLORAL",  0xfff0c8e8,0.001f,2.2f,1200,1.2f);

        auto casbag=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float pw,float dg,float dlp,float vr,float vd,float br,float nq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BAGPIPES; p.pulseWidth=pw; p.droneGain=dg; p.droneLPHz=dlp;
            p.lfoFreq=vr; p.bagVibDepth=vd; p.legLpHz=br; p.lpQ=nq;
            addPreset("CAS",p);
        };
        casbag("ca_drone","AMBIENT DRONE",     0xffa0c0e0,0.06f,4.0f,0.48f,0.40f,160,2.0f,0.004f,2500,0.9f);

        auto casb8=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float sf,float sd,float da,float st){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st;
            addPreset("CAS",p);
        };
        casb8("ca_sub_clean","BASS FLORALE",   0xffc0d0e8,0.05f,2.0f,1.0f,0.001f,0.5f,1.0f);

        auto casast=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float wr,float wd,int bs,float da,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("CAS",p);
        };
        casast("ca_wobble_cl","FLUTE REVEUSE", 0xffe8f0d8,0.06f,2.8f,1.5f,0.008f,128,0.6f,3000,1.0f);

        {
            PresetParams p; p.id="ca_divine"; p.name="DIVINE LIGHT"; p.colour=Colour(0xfffff8ff);
            p.atk=0.18f; p.rel=4.8f;
            p.engine=EngineType::YEEZY; p.yeezMode=2; p.saturation=0.5f;
            p.legLpHz=3500; p.legLpQ=0.7f; p.legSubGain=0.08f; p.hpHz=0;
            addPreset("CAS",p);
        }
    }

    // ── TORY ──────────────────────────────────────────────────────────────────
    {
        auto togf=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float pd,float sat,float lp,float lq,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
            addPreset("TORY",p);
        };
        togf("to_carib_lead","CARIBBEAN LEAD",0xffe8a030,0.04f,2.0f,14,0.0f,1.6f,4000,1.4f,0.18f);
        togf("to_saw_warm",  "SAW WARM",      0xffb07020,0.04f,2.0f,22,0.0f,1.0f,3500,1.0f,0.14f);

        auto tob8=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float sf,float sd,float da,float st){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st;
            addPreset("TORY",p);
        };
        tob8("to_808warm",  "WARM 808",       0xffc86000,0.02f,1.8f,1.5f,0.06f,1.8f,1.0f);
        tob8("to_808slide", "808 SLIDE LONG", 0xffd05010,0.02f,1.5f,2.5f,0.18f,2.5f,1.0f);

        auto toep=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float tr,float td,float det,float lp,float lq,float cl,float dc,float sl,float wm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::JOLA_EP; p.tremoloRate=tr; p.tremoloDepth=td; p.detuneCents=det;
            p.legLpHz=lp; p.legLpQ=lq; p.clickAmount=cl; p.epDecayTime=dc; p.sustainLevel=sl; p.warmth=wm;
            addPreset("TORY",p);
        };
        toep("to_rb_ep",  "R&B EP",           0xfff0c060,0.04f,2.2f,4.5f,0.07f, 5,2500,1.2f,0.14f,1.2f,0.22f,1.6f);
        toep("to_ep_fast","EP FESTIF",         0xffe8b020,0.04f,1.8f,6.0f,0.09f, 4,3000,1.3f,0.18f,1.0f,0.18f,1.2f);

        auto tovp=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float ls,float le,float st,float vr,int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("TORY",p);
        };
        tovp("to_trop_pad","TROPICAL PAD",    0xffe89020,0.25f,3.2f,10, 600,5000,1.2f,0.25f,0);
        tovp("to_warm_sw", "WARM SWEEP",      0xffc88830,0.20f,2.6f, 6, 800,6000,0.8f,0.20f,1);

        auto toss=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,int ns,float sat,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("TORY",p);
        };
        toss("to_warm_ssaw","WARM SUPERSAW",  0xffd07020,0.05f,2.5f,18,5,1.6f, 6000,1.5f);
        toss("to_bright_wall","BRIGHT WALL",  0xfff0c840,0.05f,2.8f,22,7,1.8f, 8000,1.6f);
        toss("namek",       "NAMEK",          0xffffd700,0.05f,3.0f,20,7,2.8f,10000,2.0f);

        auto togym=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       int wv,float cl,float bh,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GYM; p.gymWave=wv; p.clipAmount=cl; p.boostHz=bh; p.boostDB=bd; p.gymSub=sub;
            addPreset("TORY",p);
        };
        togym("to_dancehall","DANCEHALL STAB",0xffff8020,0.01f,1.0f,1,0.5f,2000,6,0.15f);
        togym("to_clip_saw", "CLIP SAW DANCE",0xffe86020,0.02f,1.4f,0,0.4f,1500,5,0.10f);

        auto tosc=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float mi,float lf,float lq,float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("TORY",p);
        };
        tosc("to_fm_bright","FM BRIGHT",      0xfff0b840,0.03f,1.8f,2.0f,2.5f,0.6f,4.0f,1.5f);

        auto tosam=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pd,float res,float hm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SAMURAI; p.pluckDecay=pd; p.lpQ=res; p.harmMix=hm;
            addPreset("TORY",p);
        };
        tosam("to_carib_pluck","MARIMBA CARIB",0xffe8c040,0.001f,1.4f,0.25f,8,0.40f);

        auto togt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      int wt,float fo,float fc,float ft,float fq,float da,float det,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GUITAR; p.guitWave=wt; p.filterOpen=fo; p.filterClose=fc;
            p.filterTime=ft; p.lpQ=fq; p.distAmount=da; p.detuneCents=det; p.bodyDecay=bd; p.legSubGain=sub;
            addPreset("TORY",p);
        };
        togt("to_warm_gtr","WARM GUITAR",     0xffd08030,0.001f,1.6f,0,4000,1500,0.15f,1.8f,1.2f,4,0.3f,0.0f);

        auto totrib=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float fhz,float pch){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::TRIBAL; p.formantHz=fhz; p.punch=pch;
            addPreset("TORY",p);
        };
        totrib("to_carib_perc","CARIB PERC",  0xffe07020,0.01f,1.0f, 700,3.5f);

        auto tovk=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float sub,float lp,float sat,int w){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VIKINGS; p.detuneCents=det; p.subGain=sub; p.vikLpHz=lp; p.saturation=sat; p.waves=w;
            addPreset("TORY",p);
        };
        tovk("to_warm_ens","WARM ENSEMBLE",   0xffc07828,0.20f,2.8f,12,0.25f,3000,1.2f,3);

        auto tohr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float dr,int bs,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::HORROR; p.horModRatio=mr; p.driftAmount=dr; p.bitSteps=bs; p.horLpHz=lp; p.horLpQ=lq;
            addPreset("TORY",p);
        };
        tohr("to_vintage","VINTAGE TAPE",     0xffa06020,0.06f,2.4f,1.008f,0.005f,48,3000,1.0f);

        auto tochrn=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        int bs,float na,float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("TORY",p);
        };
        tochrn("to_grit_rb","GRIT R&B",       0xffb05818,0.04f,1.8f,48,0.06f,2.0f);

        auto toast=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float wr,float wd,int bs,float da,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("TORY",p);
        };
        toast("to_trap_wob","TRAP WOBBLE",    0xffe04010,0.03f,1.6f,3.5f,0.012f,64,1.6f,4000,1.4f);

        auto topt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float vr,float vd,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::PIRATES; p.detuneCents=det; p.vibRate=vr; p.vibDepth=vd; p.lpQ=lq;
            addPreset("TORY",p);
        };
        topt("to_carib_vib","CARIB STRINGS",  0xffd09030,0.15f,2.5f,18,5.0f,0.010f,1.8f);

        auto tooct=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float lp,float lq,float sub,float det){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
            addPreset("TORY",p);
        };
        tooct("to_intimate","INTIMATE R&B",   0xffc07040,0.10f,3.0f,560,0.9f,0.28f,4);

        auto tobag=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pw,float dg,float dlp,float vr,float vd,float br,float nq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BAGPIPES; p.pulseWidth=pw; p.droneGain=dg; p.droneLPHz=dlp;
            p.lfoFreq=vr; p.bagVibDepth=vd; p.legLpHz=br; p.lpQ=nq;
            addPreset("TORY",p);
        };
        tobag("to_steel_drum","STEEL DRUM",   0xfff0d060,0.001f,1.2f,0.50f,0.05f,80,0.0f,0.0f,6000,4.0f);

        {
            PresetParams p; p.id="to_soul_chop"; p.name="SOUL CHOP CARIB"; p.colour=Colour(0xfff0a840);
            p.atk=0.04f; p.rel=1.8f;
            p.engine=EngineType::YEEZY; p.yeezMode=0; p.saturation=1.4f;
            p.legLpHz=4500; p.legLpQ=1.3f; p.legSubGain=0.15f; p.hpHz=280;
            addPreset("TORY",p);
        }
    }

    // ── RNB ───────────────────────────────────────────────────────────────────
    {
        auto rnbep=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float tr,float td,float det,float lp,float lq,float cl,float dc,float sl,float wm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::JOLA_EP; p.tremoloRate=tr; p.tremoloDepth=td; p.detuneCents=det;
            p.legLpHz=lp; p.legLpQ=lq; p.clickAmount=cl; p.epDecayTime=dc; p.sustainLevel=sl; p.warmth=wm;
            addPreset("RNB",p);
        };
        rnbep("rnb_neosoul","NEO SOUL RHODES",0xffc47028,0.04f,3.0f,2.8f,0.06f, 6,2800,1.1f,0.12f,1.8f,0.25f,2.2f);
        rnbep("rnb_gospel_ep","GOSPEL RHODES",0xffe09040,0.03f,2.6f,5.5f,0.10f, 3,3500,1.0f,0.20f,1.2f,0.30f,1.5f);
        rnbep("rnb_warm_ep3","WARM EP LATE",  0xffd8901c,0.05f,2.8f,3.5f,0.05f, 8,2200,0.9f,0.08f,2.2f,0.28f,2.8f);

        auto rnboct=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float lp,float lq,float sub,float det){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
            addPreset("RNB",p);
        };
        rnboct("rnb_motown","MOTOWN SINE",    0xffa06830,0.06f,2.8f,480,0.8f,0.22f,3);
        rnboct("rnb_intimate","INTIMATE SINE",0xffa09070,0.15f,3.5f,640,1.0f,0.18f,2);

        auto rnbvp=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float ls,float le,float st,float vr,int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("RNB",p);
        };
        rnbvp("rnb_sza_pad","SZA DREAM PAD", 0xffd080c0,0.30f,4.0f, 8, 500,4000,2.0f,0.15f,0);
        rnbvp("rnb_slow_jam","SLOW JAM PAD", 0xffd060a0,0.40f,4.5f, 5, 400,3000,3.0f,0.08f,1);

        auto rnbsc=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float mr,float mi,float lf,float lq,float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("RNB",p);
        };
        rnbsc("rnb_fm_bell","SOUL FM BELL",   0xfff0a040,0.02f,2.2f,1.5f,1.8f,0.4f,3.5f,0.8f);
        rnbsc("rnb_fm_elec","ELECTRIC SOUL",  0xffe0a020,0.02f,1.6f,3.0f,3.5f,1.0f,5.0f,2.0f);

        auto rnbbag=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float pw,float dg,float dlp,float vr,float vd,float br,float nq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BAGPIPES; p.pulseWidth=pw; p.droneGain=dg; p.droneLPHz=dlp;
            p.lfoFreq=vr; p.bagVibDepth=vd; p.legLpHz=br; p.lpQ=nq;
            addPreset("RNB",p);
        };
        rnbbag("rnb_smooth_jazz","SMOOTH JAZZ",0xff8090b0,0.12f,2.5f,0.18f,0.0f,200,4.5f,0.007f,2800,2.5f);

        auto rnbgf=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float pd,float sat,float lp,float lq,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
            addPreset("RNB",p);
        };
        rnbgf("rnb_funk_lead","FUNK LEAD",    0xffd09830,0.02f,1.4f,10,0.0f,1.4f,3800,1.2f,0.12f);
        rnbgf("rnb_mellow_saw","MELLOW SAW",  0xffc07830,0.10f,2.8f,18,0.0f,0.9f,2400,0.9f,0.20f);

        auto rnbvk=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float sub,float lp,float sat,int w){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VIKINGS; p.detuneCents=det; p.subGain=sub; p.vikLpHz=lp; p.saturation=sat; p.waves=w;
            addPreset("RNB",p);
        };
        rnbvk("rnb_choir","SILKY CHOIR",      0xffe0c0a0,0.22f,3.5f, 9,0.12f,3200,1.0f,5);

        auto rnbb8=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float sf,float sd,float da,float st){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st;
            addPreset("RNB",p);
        };
        rnbb8("rnb_round_bass","ROUND BASS",  0xff804020,0.02f,2.0f,1.0f,0.02f,1.4f,1.0f);
        rnbb8("rnb_deep_bass", "DEEP R&B",    0xff602010,0.02f,2.2f,1.2f,0.05f,2.0f,1.0f);

        auto rnbsam=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float pd,float res,float hm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SAMURAI; p.pluckDecay=pd; p.lpQ=res; p.harmMix=hm;
            addPreset("RNB",p);
        };
        rnbsam("rnb_soul_pluck","SOUL PLUCK", 0xffc09060,0.001f,1.8f,0.30f,6,0.35f);

        auto rnbhr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float mr,float dr,int bs,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::HORROR; p.horModRatio=mr; p.driftAmount=dr; p.bitSteps=bs; p.horLpHz=lp; p.horLpQ=lq;
            addPreset("RNB",p);
        };
        rnbhr("rnb_vinyl","VINYL SOUL",        0xff706050,0.08f,2.8f,1.004f,0.003f,56,2800,0.9f);

        auto rnbast=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float wr,float wd,int bs,float da,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("RNB",p);
        };
        rnbast("rnb_trap_rb","R&B TRAP LEAD", 0xffb040a0,0.03f,1.8f,2.5f,0.008f,96,1.5f,4500,1.2f);

        auto rnbgym=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        int wv,float cl,float bh,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GYM; p.gymWave=wv; p.clipAmount=cl; p.boostHz=bh; p.boostDB=bd; p.gymSub=sub;
            addPreset("RNB",p);
        };
        rnbgym("rnb_organ_stab","CHURCH STAB",0xffa05000,0.01f,0.9f,1,0.35f,1200,5,0.10f);

        auto rnbchrn=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                         int bs,float na,float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("RNB",p);
        };
        rnbchrn("rnb_lofi","LO-FI SOUL",      0xff907060,0.06f,2.4f,36,0.08f,1.6f);

        auto rnbpt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,float vr,float vd,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::PIRATES; p.detuneCents=det; p.vibRate=vr; p.vibDepth=vd; p.lpQ=lq;
            addPreset("RNB",p);
        };
        rnbpt("rnb_strings_vib","SOUL STRINGS",0xffd0a080,0.18f,3.2f,12,4.2f,0.009f,1.5f);

        auto rnbtrib=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                         float fhz,float pch){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::TRIBAL; p.formantHz=fhz; p.punch=pch;
            addPreset("RNB",p);
        };
        rnbtrib("rnb_click_perc","SOUL CLICK", 0xffc08040,0.01f,0.8f, 600,3.0f);

        auto rnbgt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       int wt,float fo,float fc,float ft,float fq,float da,float det,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GUITAR; p.guitWave=wt; p.filterOpen=fo; p.filterClose=fc;
            p.filterTime=ft; p.lpQ=fq; p.distAmount=da; p.detuneCents=det; p.bodyDecay=bd; p.legSubGain=sub;
            addPreset("RNB",p);
        };
        rnbgt("rnb_fingerpick","FINGER GUITAR",0xffb07030,0.001f,2.0f,0,3500, 900,0.20f,1.6f,1.0f,3,0.35f,0.0f);

        auto rnbss=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float det,int ns,float sat,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("RNB",p);
        };
        rnbss("rnb_gospel_wall","GOSPEL WALL", 0xfff0c060,0.08f,3.0f,14,5,1.4f,5500,1.3f);

        {
            PresetParams p; p.id="rnb_soul_chop"; p.name="SOUL CHOP"; p.colour=Colour(0xffe08828);
            p.atk=0.03f; p.rel=1.5f;
            p.engine=EngineType::YEEZY; p.yeezMode=0; p.saturation=1.2f;
            p.legLpHz=3800; p.legLpQ=1.1f; p.legSubGain=0.12f; p.hpHz=200;
            addPreset("RNB",p);
        }
    }

    // ── PHONK_BR ──────────────────────────────────────────────────────────────
    {
        auto pbgym=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       int wv,float cl,float bh,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GYM; p.gymWave=wv; p.clipAmount=cl; p.boostHz=bh; p.boostDB=bd; p.gymSub=sub;
            addPreset("PHONK_BR",p);
        };
        pbgym("pb_funk_clip","FUNK CARIOCA",  0xff22bb44,0.01f,0.8f,1,0.85f,2500,10,0.25f);
        pbgym("pb_pisadinha","PISADINHA ELEC",0xff11aa33,0.01f,0.6f,0,0.70f,3000, 9,0.18f);
        pbgym("pb_bounce_clip","BOUNCE CLIP", 0xff55cc44,0.01f,0.7f,1,0.90f,1800,12,0.30f);

        auto pbb8=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float sf,float sd,float da,float st){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BASS808; p.slideFrom=sf; p.slideDur=sd; p.distAmount=da; p.slideTarget=st;
            addPreset("PHONK_BR",p);
        };
        pbb8("pb_808_baile","BAILE 808",      0xff119933,0.01f,1.5f,2.0f,0.10f,3.5f,1.0f);
        pbb8("pb_808_heavy","808 PESADO",     0xff006616,0.01f,2.0f,3.0f,0.15f,4.5f,1.0f);

        auto pbyr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      int mode,float sat,float lp,float lq,float sub,float hp){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::YEEZY; p.yeezMode=mode; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.hpHz=hp;
            addPreset("PHONK_BR",p);
        };
        pbyr("pb_tamborzao","TAMBORZAO ELEC", 0xff33cc55,0.01f,0.7f,1,4.5f,7000,2.5f,0.0f,600);

        auto pbtrib=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        float fhz,float pch){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::TRIBAL; p.formantHz=fhz; p.punch=pch;
            addPreset("PHONK_BR",p);
        };
        pbtrib("pb_perc150","PERCUSSAO 150",  0xff44dd44,0.01f,0.5f,1200,6.0f);
        pbtrib("pb_forro_perc","FORRO PERC",  0xff22aa33,0.01f,0.6f, 900,7.0f);

        auto pbchrn=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                        int bs,float na,float sat){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::CHERNOBYL; p.bitSteps=bs; p.noiseAmt=na; p.saturation=sat;
            addPreset("PHONK_BR",p);
        };
        pbchrn("pb_bass_sat","BASS SATURADA", 0xff0a8822,0.01f,1.2f,12,0.20f,4.0f);
        pbchrn("pb_crado_vinyl","VINIL CRADO",0xff337744,0.05f,1.6f, 6,0.30f,5.0f);

        auto pbhr=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float dr,int bs,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::HORROR; p.horModRatio=mr; p.driftAmount=dr; p.bitSteps=bs; p.horLpHz=lp; p.horLpQ=lq;
            addPreset("PHONK_BR",p);
        };
        pbhr("pb_horror_synth","SINTETIZADOR",0xff226633,0.03f,1.4f,1.025f,0.04f, 8,4500,3.5f);
        pbhr("pb_industrial","INDUSTRIAL",    0xff334433,0.03f,1.5f,1.050f,0.08f, 5,5000,4.0f);

        auto pbast=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float wr,float wd,int bs,float da,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::ASTRO; p.wobbleRate=wr; p.wobbleDepth=wd; p.bitSteps=bs; p.distAmount=da; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("PHONK_BR",p);
        };
        pbast("pb_mc_wobble","MC ENERGY",     0xff55ee66,0.02f,1.0f,8.0f,0.022f,16,3.0f,6000,2.5f);
        pbast("pb_wobble_bass","WOBBLE BASS", 0xff00ff44,0.02f,1.6f,5.0f,0.018f,24,2.5f,3500,2.0f);

        auto pbsc=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float mr,float mi,float lf,float lq,float ld){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SCIFI; p.modRatio=mr; p.modIndex=mi; p.lfoFreq=lf; p.lpQ=lq; p.lfoDepth=ld;
            addPreset("PHONK_BR",p);
        };
        pbsc("pb_forro_fm","FORRO PHONK FM",  0xff33cc44,0.02f,1.1f,4.5f,7.0f,2.0f,6.0f,5.0f);

        auto pbvk=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float sub,float lp,float sat,int w){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VIKINGS; p.detuneCents=det; p.subGain=sub; p.vikLpHz=lp; p.saturation=sat; p.waves=w;
            addPreset("PHONK_BR",p);
        };
        pbvk("pb_vikings_wall","PAREDE SAT",  0xff1a7730,0.03f,1.8f,20,0.40f,5000,4.5f,3);

        auto pbvp=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float ls,float le,float st,float vr,int wt){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::VAPOR; p.detuneCents=det; p.lpStartHz=ls; p.lpEndHz=le; p.sweepTime=st; p.vapVibRate=vr; p.vapWave=wt;
            addPreset("PHONK_BR",p);
        };
        pbvp("pb_sweep_agro","SWEEP AGRESSIF",0xff22dd55,0.02f,1.5f,22,1500,9000,0.4f,1.0f,0);

        auto pbsam=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pd,float res,float hm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SAMURAI; p.pluckDecay=pd; p.lpQ=res; p.harmMix=hm;
            addPreset("PHONK_BR",p);
        };
        pbsam("pb_pluck_hard","PLUCK DURO",   0xff33bb44,0.001f,0.7f,0.10f,15,0.50f);

        auto pbss=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,int ns,float sat,float lp,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::SUPERSAW; p.detuneCents=det; p.numSaws=ns; p.saturation=sat; p.legLpHz=lp; p.legLpQ=lq;
            addPreset("PHONK_BR",p);
        };
        pbss("pb_phonk_wall","PHONK WALL",    0xff55ff66,0.04f,2.0f,30,7,4.0f,9000,2.5f);

        auto pbgf=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float pd,float sat,float lp,float lq,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GFUNK; p.detuneCents=det; p.portaDur=pd; p.saturation=sat;
            p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub;
            addPreset("PHONK_BR",p);
        };
        pbgf("pb_phonk_horn","PHONK HORN",    0xff44ee55,0.02f,1.2f,28,0.0f,3.0f,6000,2.0f,0.25f);

        auto pbpt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float det,float vr,float vd,float lq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::PIRATES; p.detuneCents=det; p.vibRate=vr; p.vibDepth=vd; p.lpQ=lq;
            addPreset("PHONK_BR",p);
        };
        pbpt("pb_string_stab","STRING STAB",  0xff00cc33,0.01f,0.8f,25,8.0f,0.018f,3.5f);

        auto pbgt=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      int wt,float fo,float fc,float ft,float fq,float da,float det,float bd,float sub){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::GUITAR; p.guitWave=wt; p.filterOpen=fo; p.filterClose=fc;
            p.filterTime=ft; p.lpQ=fq; p.distAmount=da; p.detuneCents=det; p.bodyDecay=bd; p.legSubGain=sub;
            addPreset("PHONK_BR",p);
        };
        pbgt("pb_dist_gtr","GUITARRA DIST",   0xff228833,0.001f,1.0f,1,8000,2000,0.05f,3.5f,4.0f,12,0.10f,0.15f);

        auto pbbag=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float pw,float dg,float dlp,float vr,float vd,float br,float nq){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::BAGPIPES; p.pulseWidth=pw; p.droneGain=dg; p.droneLPHz=dlp;
            p.lfoFreq=vr; p.bagVibDepth=vd; p.legLpHz=br; p.lpQ=nq;
            addPreset("PHONK_BR",p);
        };
        pbbag("pb_drone_dark","DRONE ESCURO", 0xff115522,0.20f,2.5f,0.50f,0.60f,120,0.5f,0.015f,1200,5.0f);

        auto pbep=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                      float tr,float td,float det,float lp,float lq,float cl,float dc,float sl,float wm){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::JOLA_EP; p.tremoloRate=tr; p.tremoloDepth=td; p.detuneCents=det;
            p.legLpHz=lp; p.legLpQ=lq; p.clickAmount=cl; p.epDecayTime=dc; p.sustainLevel=sl; p.warmth=wm;
            addPreset("PHONK_BR",p);
        };
        pbep("pb_ep_phonk","EP PHONK DIST",   0xff33ff55,0.02f,1.0f,9.0f,0.18f,15,5500,2.0f,0.40f,0.5f,0.10f,4.0f);

        auto pboct=[&](const char* id,const char* name,uint32 col,float atk,float rel,
                       float lp,float lq,float sub,float det){
            PresetParams p; p.id=id; p.name=name; p.colour=Colour(col); p.atk=atk; p.rel=rel;
            p.engine=EngineType::OCTOBER; p.legLpHz=lp; p.legLpQ=lq; p.legSubGain=sub; p.legDetune=det;
            addPreset("PHONK_BR",p);
        };
        pboct("pb_dark_sine","BAIXO DARK",    0xff0a6618,0.01f,1.8f,260,1.5f,0.40f,0);
    }
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
