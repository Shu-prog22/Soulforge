#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

// ─────────────────────────────────────────────────────────────────────────────
// Simple knob component
// ─────────────────────────────────────────────────────────────────────────────
class SFKnob : public juce::Component
{
public:
    SFKnob(const juce::String& label, juce::Colour accent)
        : labelText(label), accentColour(accent)
    {
        slider.setSliderStyle(juce::Slider::RotaryVerticalDrag);
        slider.setTextBoxStyle(juce::Slider::NoTextBox, false, 0, 0);
        slider.setColour(juce::Slider::rotarySliderFillColourId,  accent);
        slider.setColour(juce::Slider::rotarySliderOutlineColourId, accent.withAlpha(0.3f));
        slider.setColour(juce::Slider::thumbColourId, accent.brighter(0.5f));
        addAndMakeVisible(slider);
    }

    void resized() override { slider.setBounds(getLocalBounds().removeFromTop(getHeight() - 18)); }

    void paint(juce::Graphics& g) override
    {
        g.setColour(accentColour.withAlpha(0.8f));
        g.setFont(juce::Font(9.0f, juce::Font::bold));
        g.drawText(labelText, 0, getHeight() - 18, getWidth(), 18, juce::Justification::centred);
    }

    juce::Slider slider;

private:
    juce::String labelText;
    juce::Colour accentColour;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main editor
// ─────────────────────────────────────────────────────────────────────────────
class SoulForgeSynthAudioProcessorEditor : public juce::AudioProcessorEditor,
                                           private juce::ListBoxModel,
                                           private juce::Timer
{
public:
    explicit SoulForgeSynthAudioProcessorEditor (SoulForgeSynthAudioProcessor&);
    ~SoulForgeSynthAudioProcessorEditor() override = default;

    void paint   (juce::Graphics&) override;
    void resized () override;

private:
    // ── ListBoxModel ───────────────────────────────────────────────────────────
    int  getNumRows() override;
    void paintListBoxItem(int row, juce::Graphics&, int w, int h, bool selected) override;
    void listBoxItemClicked(int row, const juce::MouseEvent&) override;

    // ── Timer ─────────────────────────────────────────────────────────────────
    void timerCallback() override;

    SoulForgeSynthAudioProcessor& processorRef;

    // Folder buttons
    juce::OwnedArray<juce::TextButton> folderButtons;
    juce::String                       activeFolder;

    // Preset list (filtered by folder)
    std::vector<int> filteredIndices;
    juce::ListBox    presetList;

    // Knobs
    SFKnob knobVol     { "VOL",     juce::Colour(0xffe03030) };
    SFKnob knobAtk     { "ATTACK",  juce::Colour(0xffe03030) };
    SFKnob knobRel     { "RELEASE", juce::Colour(0xffe03030) };
    SFKnob knobFilter  { "FILTER",  juce::Colour(0xff30b0e0) };
    SFKnob knobReverb  { "REVERB",  juce::Colour(0xff8040ff) };
    SFKnob knobChorus  { "CHORUS",  juce::Colour(0xff40e080) };

    // APVTS attachments
    using Attach = juce::AudioProcessorValueTreeState::SliderAttachment;
    std::unique_ptr<Attach> atkAtt, relAtt, volAtt, filtAtt, revAtt, chorAtt;

    // Info
    juce::Label infoLabel;

    void rebuildFilteredList();
    void selectFolder(const juce::String& key);

    juce::Colour currentAccent { 0xffe03030 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SoulForgeSynthAudioProcessorEditor)
};
