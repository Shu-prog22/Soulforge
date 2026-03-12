import { BANK } from './App';

test('le nombre total de presets dans BANK est supérieur à 400', () => {
  const total = Object.values(BANK).reduce((sum, folder) => sum + folder.presets.length, 0);
  expect(total).toBeGreaterThan(400);
});

test('BANK contient les 15 dossiers attendus', () => {
  const expected = ['PADS','PIANO','VOICES','LEADS','BASS','GHIBLI','DS','ANIME','RAP_FR','SCIFI','VIKINGS','GYM','BASS808','VAPOR','HORROR'];
  expected.forEach(key => expect(BANK[key]).toBeDefined());
});

// Legacy folders
test('PADS a au moins 25 presets',   () => { expect(BANK.PADS?.presets.length).toBeGreaterThanOrEqual(25); });
test('PIANO a au moins 25 presets',  () => { expect(BANK.PIANO?.presets.length).toBeGreaterThanOrEqual(25); });
test('VOICES a au moins 25 presets', () => { expect(BANK.VOICES?.presets.length).toBeGreaterThanOrEqual(25); });
test('LEADS a au moins 25 presets',  () => { expect(BANK.LEADS?.presets.length).toBeGreaterThanOrEqual(25); });
test('BASS a au moins 25 presets',   () => { expect(BANK.BASS?.presets.length).toBeGreaterThanOrEqual(25); });
test('GHIBLI a au moins 15 presets', () => { expect(BANK.GHIBLI?.presets.length).toBeGreaterThanOrEqual(15); });
test('DS a au moins 15 presets',     () => { expect(BANK.DS?.presets.length).toBeGreaterThanOrEqual(15); });
test('ANIME a au moins 25 presets',  () => { expect(BANK.ANIME?.presets.length).toBeGreaterThanOrEqual(25); });
test('RAP_FR a au moins 25 presets', () => { expect(BANK.RAP_FR?.presets.length).toBeGreaterThanOrEqual(25); });

// Engine folders
test('SCIFI a au moins 25 presets',   () => { expect(BANK.SCIFI?.presets.length).toBeGreaterThanOrEqual(25); });
test('VIKINGS a au moins 25 presets', () => { expect(BANK.VIKINGS?.presets.length).toBeGreaterThanOrEqual(25); });
test('GYM a au moins 25 presets',     () => { expect(BANK.GYM?.presets.length).toBeGreaterThanOrEqual(25); });
test('BASS808 a au moins 25 presets', () => { expect(BANK.BASS808?.presets.length).toBeGreaterThanOrEqual(25); });
test('VAPOR a au moins 25 presets',   () => { expect(BANK.VAPOR?.presets.length).toBeGreaterThanOrEqual(25); });
test('HORROR a au moins 25 presets',  () => { expect(BANK.HORROR?.presets.length).toBeGreaterThanOrEqual(25); });

// Chaque preset a un id et un name
test('tous les presets ont un id et un name', () => {
  Object.values(BANK).forEach(folder => {
    folder.presets.forEach(preset => {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
    });
  });
});

// Les presets avec engine ont un engine valide
test('tous les presets avec engine ont un engine valide', () => {
  Object.values(BANK).forEach(folder => {
    folder.presets.forEach(preset => {
      if (preset.engine) {
        expect(['SCIFI','VIKINGS','GYM','BASS808','VAPOR','HORROR']).toContain(preset.engine);
      }
    });
  });
});
