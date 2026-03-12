#include "PluginEditor.h"

using namespace juce;

SoulForgeSynthAudioProcessorEditor::SoulForgeSynthAudioProcessorEditor(
    SoulForgeSynthAudioProcessor& p)
    : AudioProcessorEditor(&p), processorRef(p)
{
    setSize(780, 480);
    setResizable(true, true);
    setResizeLimits(600, 380, 1400, 900);

    // ── Knob attachments ──────────────────────────────────────────────────────
    volAtt  = std::make_unique<Attach>(p.apvts, "volume",  knobVol.slider);
    atkAtt  = std::make_unique<Attach>(p.apvts, "attack",  knobAtk.slider);
    relAtt  = std::make_unique<Attach>(p.apvts, "release", knobRel.slider);
    filtAtt = std::make_unique<Attach>(p.apvts, "filter",  knobFilter.slider);
    revAtt  = std::make_unique<Attach>(p.apvts, "reverb",  knobReverb.slider);
    chorAtt = std::make_unique<Attach>(p.apvts, "chorus",  knobChorus.slider);

    addAndMakeVisible(knobVol);
    addAndMakeVisible(knobAtk);
    addAndMakeVisible(knobRel);
    addAndMakeVisible(knobFilter);
    addAndMakeVisible(knobReverb);
    addAndMakeVisible(knobChorus);

    // ── Folder buttons ────────────────────────────────────────────────────────
    for (const auto& key : p.folderOrder)
    {
        auto* btn = folderButtons.add(new TextButton(p.folders[key].label));
        btn->setColour(TextButton::buttonColourId,    Colour(0xff0d0d1a));
        btn->setColour(TextButton::buttonOnColourId,  p.folders[key].colour.withAlpha(0.3f));
        btn->setColour(TextButton::textColourOnId,    p.folders[key].colour);
        btn->setColour(TextButton::textColourOffId,   Colour(0xff444444));
        btn->onClick = [this, key] { selectFolder(key); };
        addAndMakeVisible(btn);
    }

    // ── Preset list ───────────────────────────────────────────────────────────
    presetList.setModel(this);
    presetList.setColour(ListBox::backgroundColourId, Colour(0xff07070d));
    presetList.setColour(ListBox::outlineColourId,    Colour(0xff12122a));
    presetList.setRowHeight(26);
    addAndMakeVisible(presetList);

    // ── Info label ────────────────────────────────────────────────────────────
    infoLabel.setFont(Font(9.0f, Font::bold));
    infoLabel.setColour(Label::textColourId, Colour(0xff444466));
    infoLabel.setJustificationType(Justification::centred);
    infoLabel.setText("SOULFORGE SYNTH  |  VST3", dontSendNotification);
    addAndMakeVisible(infoLabel);

    // Default folder
    if (!p.folderOrder.empty())
        selectFolder(p.folderOrder[0]);

    startTimerHz(10);
}

void SoulForgeSynthAudioProcessorEditor::selectFolder(const String& key)
{
    activeFolder = key;
    auto& p = processorRef;

    if (p.folders.count(key))
        currentAccent = p.folders[key].colour;

    // Update button styles
    for (int i = 0; i < folderButtons.size(); ++i)
    {
        bool on = (p.folderOrder[i] == key);
        folderButtons[i]->setToggleState(on, dontSendNotification);
        folderButtons[i]->repaint();
    }

    rebuildFilteredList();
    presetList.deselectAllRows();
    presetList.repaint();
}

void SoulForgeSynthAudioProcessorEditor::rebuildFilteredList()
{
    filteredIndices.clear();
    auto& bank = processorRef.bank;
    for (int i = 0; i < (int)bank.size(); ++i)
        if (bank[i].folder == activeFolder)
            filteredIndices.push_back(i);
    presetList.updateContent();
}

int SoulForgeSynthAudioProcessorEditor::getNumRows()
{
    return (int)filteredIndices.size();
}

void SoulForgeSynthAudioProcessorEditor::paintListBoxItem(
    int row, Graphics& g, int w, int h, bool selected)
{
    if (row < 0 || row >= (int)filteredIndices.size()) return;
    const auto& preset = processorRef.bank[filteredIndices[row]];

    if (selected)
        g.fillAll(currentAccent.withAlpha(0.18f));
    else if (row % 2 == 0)
        g.fillAll(Colour(0xff0d0d1a));

    // Colour dot
    g.setColour(preset.colour);
    g.fillEllipse(8.f, h * 0.5f - 4.f, 8.f, 8.f);

    // Name
    g.setColour(selected ? currentAccent : Colour(0xffbbbbbb));
    g.setFont(Font(10.0f, selected ? Font::bold : Font::plain));
    g.drawText(preset.name, 24, 0, w - 28, h, Justification::centredLeft);
}

void SoulForgeSynthAudioProcessorEditor::listBoxItemClicked(int row, const MouseEvent&)
{
    if (row < 0 || row >= (int)filteredIndices.size()) return;
    processorRef.setCurrentProgram(filteredIndices[row]);
}

void SoulForgeSynthAudioProcessorEditor::timerCallback()
{
    // Sync list selection to current program
    int prog = processorRef.currentProgram;
    for (int i = 0; i < (int)filteredIndices.size(); ++i)
    {
        if (filteredIndices[i] == prog)
        {
            presetList.selectRow(i, false, true);
            break;
        }
    }
}

void SoulForgeSynthAudioProcessorEditor::paint(Graphics& g)
{
    // Background
    g.fillAll(Colour(0xff07070d));

    // Top bar
    g.setColour(Colour(0xff0d0d1a));
    g.fillRect(0, 0, getWidth(), 36);

    // Title
    g.setFont(Font("Courier New", 14.0f, Font::bold));
    g.setColour(currentAccent);
    g.drawText("SOULFORGE SYNTH", 12, 0, 200, 36, Justification::centredLeft);

    // Separator
    g.setColour(currentAccent.withAlpha(0.4f));
    g.drawLine(0.f, 36.f, (float)getWidth(), 36.f, 1.f);

    // Knob area background
    g.setColour(Colour(0xff0a0a15));
    g.fillRect(0, getHeight() - 100, getWidth(), 100);
    g.setColour(currentAccent.withAlpha(0.3f));
    g.drawLine(0.f, (float)(getHeight() - 100), (float)getWidth(), (float)(getHeight() - 100), 1.f);
}

void SoulForgeSynthAudioProcessorEditor::resized()
{
    auto bounds = getLocalBounds();

    // Top bar (title + info)
    auto topBar = bounds.removeFromTop(36);
    infoLabel.setBounds(topBar.removeFromRight(300));

    // Bottom knob strip
    auto knobStrip = bounds.removeFromBottom(100);
    int knobW = knobStrip.getWidth() / 6;
    knobVol   .setBounds(knobStrip.removeFromLeft(knobW));
    knobAtk   .setBounds(knobStrip.removeFromLeft(knobW));
    knobRel   .setBounds(knobStrip.removeFromLeft(knobW));
    knobFilter.setBounds(knobStrip.removeFromLeft(knobW));
    knobReverb.setBounds(knobStrip.removeFromLeft(knobW));
    knobChorus.setBounds(knobStrip);

    // Folder buttons (left sidebar, stacked)
    auto sidebar = bounds.removeFromLeft(110);
    int btnH = jmax(24, sidebar.getHeight() / jmax(1, folderButtons.size()));
    for (auto* btn : folderButtons)
        btn->setBounds(sidebar.removeFromTop(btnH));

    // Preset list fills remaining area
    presetList.setBounds(bounds);
}
