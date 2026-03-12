import { useState, useEffect, useRef, useCallback } from "react";

const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

const NOTES = [
  {note:"C3",midi:48,black:false},{note:"C#3",midi:49,black:true},
  {note:"D3",midi:50,black:false},{note:"D#3",midi:51,black:true},
  {note:"E3",midi:52,black:false},{note:"F3",midi:53,black:false},
  {note:"F#3",midi:54,black:true},{note:"G3",midi:55,black:false},
  {note:"G#3",midi:56,black:true},{note:"A3",midi:57,black:false},
  {note:"A#3",midi:58,black:true},{note:"B3",midi:59,black:false},
  {note:"C4",midi:60,black:false},{note:"C#4",midi:61,black:true},
  {note:"D4",midi:62,black:false},{note:"D#4",midi:63,black:true},
  {note:"E4",midi:64,black:false},{note:"F4",midi:65,black:false},
  {note:"F#4",midi:66,black:true},{note:"G4",midi:67,black:false},
  {note:"G#4",midi:68,black:true},{note:"A4",midi:69,black:false},
  {note:"A#4",midi:70,black:true},{note:"B4",midi:71,black:false},
  {note:"C5",midi:72,black:false},
];

const KB = {
  "a":"C3","w":"C#3","s":"D3","e":"D#3","d":"E3","f":"F3","t":"F#3",
  "g":"G3","y":"G#3","h":"A3","u":"A#3","j":"B3","k":"C4","o":"C#4",
  "l":"D4","p":"D#4",";":"E4"
};

// ══════════════════════════════════════════════════════════
// ENGINES — moteurs de synthèse paramétriques par dossier
// Chaque fonction : (freq, now, ctx, masterGain, lp, oscs, release, params)
// ══════════════════════════════════════════════════════════
const ENGINES = {
  SCIFI: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{modRatio=3.5,modIndex=4,lfoFreq=0.8,lpQ=5,lfoDepth=3}=p;
    const carrier=ctx.createOscillator(); carrier.type="sine"; carrier.frequency.value=freq;
    const mod=ctx.createOscillator(); mod.type="sine"; mod.frequency.value=freq*modRatio;
    const modG=ctx.createGain();
    modG.gain.setValueAtTime(freq*modIndex,now);
    modG.gain.exponentialRampToValueAtTime(freq*(modIndex*0.25+0.01),now+0.6);
    mod.connect(modG); modG.connect(carrier.frequency);
    const lfoOsc=ctx.createOscillator(); const lfoG=ctx.createGain();
    lfoOsc.type="sine"; lfoOsc.frequency.value=lfoFreq; lfoG.gain.value=freq*lfoDepth;
    lfoOsc.connect(lfoG); lfoG.connect(lp.frequency); lfoOsc.start(); oscs.push(lfoOsc);
    const carrG=ctx.createGain(); carrG.gain.value=0.55;
    carrier.connect(carrG); carrG.connect(masterGain);
    carrier.start(); mod.start(); oscs.push(carrier,mod);
    lp.frequency.value=freq*6; lp.Q.value=lpQ;
  },
  VIKINGS: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{detuneCents=15,subGain=0.35,lpFreq=400,saturation=2.0,waves=3}=p;
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.tanh(x*saturation)*0.85;} ws.curve=wc;
    ws.connect(masterGain);
    const offsets=waves===1?[0]:waves===2?[-detuneCents,detuneCents]:[-detuneCents,0,detuneCents];
    offsets.forEach(cents=>{
      const f=freq*Math.pow(2,cents/1200);
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=f;
      const sawG=ctx.createGain(); sawG.gain.value=0.30;
      saw.connect(sawG); sawG.connect(ws); saw.start(); oscs.push(saw);
    });
    const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
    const subG=ctx.createGain(); subG.gain.value=subGain;
    sub.connect(subG); sub.connect(masterGain); sub.start(); oscs.push(sub);
    lp.frequency.value=Math.max(lpFreq,60); lp.Q.value=0.8;
  },
  GYM: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{waveType="square",clipAmount=0.7,boostFreq=2000,boostGain=8,subMix=0}=p;
    const osc=ctx.createOscillator(); osc.type=waveType; osc.frequency.value=freq;
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.max(-clipAmount,Math.min(clipAmount,x*2))/clipAmount*0.85;} ws.curve=wc;
    const peak=ctx.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=Math.min(boostFreq,freq*8); peak.Q.value=2; peak.gain.value=boostGain;
    const gymG=ctx.createGain(); gymG.gain.value=0.50;
    osc.connect(ws); ws.connect(peak); peak.connect(gymG); gymG.connect(masterGain);
    osc.start(); oscs.push(osc);
    if(subMix>0){
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=subMix;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
    }
    lp.frequency.value=Math.min(freq*8,8000); lp.Q.value=0.5;
  },
  BASS808: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{slideFrom=2.0,slideDur=0.08,distAmount=2.5,slideTarget=1.0,subMix=0}=p;
    const sine=ctx.createOscillator(); sine.type="sine";
    sine.frequency.setValueAtTime(freq*slideFrom,now);
    sine.frequency.exponentialRampToValueAtTime(freq*slideTarget,now+Math.max(slideDur,0.005));
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
    for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=Math.tanh(x*distAmount)*0.82;} ws.curve=wc;
    const envG=ctx.createGain();
    envG.gain.setValueAtTime(0.88,now);
    envG.gain.exponentialRampToValueAtTime(0.001,now+Math.max(release*0.95,0.05));
    sine.connect(ws); ws.connect(envG); envG.connect(masterGain); sine.start(); oscs.push(sine);
    if(subMix>0){
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=subMix;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
    }
    lp.frequency.value=freq*4; lp.Q.value=0.5;
  },
  VAPOR: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{detuneCents=8,lpStart=800,lpEnd=3000,sweepTime=1.5,vibRate=0.3,waveType="sawtooth"}=p;
    lp.frequency.setValueAtTime(lpStart,now);
    lp.frequency.linearRampToValueAtTime(lpEnd,now+sweepTime);
    lp.Q.value=1.2;
    [-detuneCents,0,detuneCents].forEach((cents,i)=>{
      const f=freq*Math.pow(2,cents/1200);
      const osc=ctx.createOscillator(); osc.type=waveType; osc.frequency.value=f;
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=vibRate+i*0.06; vibG.gain.value=f*0.004;
      vib.connect(vibG); vibG.connect(osc.frequency); vib.start(); oscs.push(vib);
      const oscG=ctx.createGain(); oscG.gain.value=0.25;
      osc.connect(oscG); oscG.connect(masterGain); osc.start(); oscs.push(osc);
    });
  },
  // ── SAMURAI — Sec, onde tri, pluck boisée, résonance haute, attaque 0s ──────
  SAMURAI: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{pluckDecay=0.35,resonance=9,harmMix=0.25}=p;
    // Corps triangle — sec et net
    const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=freq;
    const triG=ctx.createGain();
    triG.gain.setValueAtTime(0.55,now);
    triG.gain.exponentialRampToValueAtTime(0.001,now+Math.max(pluckDecay*release,0.05));
    tri.connect(triG); triG.connect(masterGain); tri.start(); oscs.push(tri);
    // Harmonique boisée — click d'attaque pluck
    [[2,0.25,0.06],[3,0.12,0.03],[5,0.06,0.02]].forEach(([ratio,gain,dur])=>{
      const h=ctx.createOscillator(); h.type="sine"; h.frequency.value=freq*ratio;
      const hG=ctx.createGain();
      hG.gain.setValueAtTime(gain*harmMix*4,now);
      hG.gain.exponentialRampToValueAtTime(0.001,now+dur);
      h.connect(hG); hG.connect(masterGain); h.start(); oscs.push(h);
    });
    lp.frequency.value=freq*6; lp.Q.value=resonance;
  },
  // ── CHERNOBYL — Sale : square + bitcrusher + bruit blanc ─────────────────
  CHERNOBYL: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{bitSteps=5,noiseAmt=0.12,satAmount=3.5}=p;
    const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
    // Bitcrusher via waveshaper
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.round(x*(bitSteps||5))/(bitSteps||5)*0.82;} ws.curve=wc;
    const sqG=ctx.createGain(); sqG.gain.value=0.45;
    sq.connect(sqG); sqG.connect(ws); ws.connect(masterGain); sq.start(); oscs.push(sq);
    // Bruit blanc filtré
    const bufSize=Math.floor(ctx.sampleRate*0.5);
    const noiseBuf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const nData=noiseBuf.getChannelData(0);
    for(let i=0;i<bufSize;i++) nData[i]=(Math.random()*2-1);
    const noise=ctx.createBufferSource(); noise.buffer=noiseBuf; noise.loop=true;
    const noiseG=ctx.createGain(); noiseG.gain.value=noiseAmt;
    noise.connect(noiseG); noiseG.connect(masterGain); noise.start(); oscs.push(noise);
    lp.frequency.value=Math.min(freq*3,3000); lp.Q.value=2;
  },
  // ── PIRATES — Épique : accordéon synth + vibrato + band-pass ─────────────
  PIRATES: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{detuneCents=22,vibRate=5.2,vibDepth=0.012,bpQ=3}=p;
    [-detuneCents,0,detuneCents].forEach((cents,i)=>{
      const f=freq*Math.pow(2,cents/1200);
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=f;
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=vibRate+i*0.15; vibG.gain.value=f*vibDepth;
      vib.connect(vibG); vibG.connect(saw.frequency); vib.start(); oscs.push(vib);
      const sawG=ctx.createGain(); sawG.gain.value=0.28;
      saw.connect(sawG); sawG.connect(masterGain); saw.start(); oscs.push(saw);
    });
    // Band-pass = caractère accordéon
    lp.type="bandpass"; lp.frequency.value=freq*2; lp.Q.value=bpQ;
  },
  // ── TRIBAL — Percutant : filtre vocal, decay très court ──────────────────
  TRIBAL: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{decay=0.18,formantHz=900,punch=4}=p;
    // Click d'attaque percussif
    const click=ctx.createOscillator(); click.type="sine"; click.frequency.value=freq*5;
    const clickG=ctx.createGain();
    clickG.gain.setValueAtTime(0.5,now);
    clickG.gain.exponentialRampToValueAtTime(0.001,now+0.018);
    click.connect(clickG); clickG.connect(masterGain); click.start(); oscs.push(click);
    // Corps triangle — decay court
    const body=ctx.createOscillator(); body.type="triangle"; body.frequency.value=freq;
    const bodyG=ctx.createGain();
    bodyG.gain.setValueAtTime(0.65,now);
    bodyG.gain.exponentialRampToValueAtTime(0.001,now+Math.max(decay*release,0.04));
    body.connect(bodyG); bodyG.connect(masterGain); body.start(); oscs.push(body);
    // Filtre vocal (formant bandpass)
    lp.type="bandpass"; lp.frequency.value=formantHz; lp.Q.value=punch;
  },
  // ── JOLA_EP — Rhodes déformé : sine+tri, tremolo cassette, click ─────────
  JOLA_EP: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{
      tremoloRate  =3.0,   // Hz — vitesse du trémolo de volume
      tremoloDepth =0.08,  // intensité du trémolo
      detuneCents  =4,     // width du chorus (cents)
      lpHz         =1200,  // coupure LP — enlève le "numérique"
      lpQ          =1.2,
      clickAmount  =0.15,  // transient initial de la touche
      decayTime    =1.5,   // temps de decay vers le sustain
      sustainLevel =0.20,  // niveau de sustain (20%)
      warmth       =1.8,   // saturation douce (chaleur cassette)
    }=p;

    // ── Enveloppe EP interne : click → decay → sustain ─────────────────────
    const epEnv=ctx.createGain();
    epEnv.gain.setValueAtTime(1.0,now);
    epEnv.gain.exponentialRampToValueAtTime(Math.max(sustainLevel,0.02),now+decayTime);

    // ── Trémolo LFO (sur le gain → volume qui "respire") ─────────────────────
    const tremLFO=ctx.createOscillator(); const tremG=ctx.createGain();
    tremLFO.type="sine"; tremLFO.frequency.value=tremoloRate;
    tremG.gain.value=tremoloDepth;
    tremLFO.connect(tremG); tremG.connect(epEnv.gain);
    tremLFO.start(); oscs.push(tremLFO);

    // ── Waveshaper doux — chaleur vintage ────────────────────────────────────
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
    const tanhW=Math.tanh(warmth)||1;
    for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.tanh(x*warmth)/tanhW;} ws.curve=wc;

    // ── Sine 70% + Triangle 30% ───────────────────────────────────────────────
    const sOsc=ctx.createOscillator(); sOsc.type="sine"; sOsc.frequency.value=freq;
    const tOsc=ctx.createOscillator(); tOsc.type="triangle"; tOsc.frequency.value=freq;
    const sG=ctx.createGain(); sG.gain.value=0.70;
    const tG=ctx.createGain(); tG.gain.value=0.30;
    sOsc.connect(sG); sG.connect(ws); tOsc.connect(tG); tG.connect(ws);
    ws.connect(epEnv); epEnv.connect(masterGain);
    sOsc.start(); tOsc.start(); oscs.push(sOsc,tOsc);

    // ── Click initial (simulation touche mécanique) ────────────────────────
    if(clickAmount>0){
      const click=ctx.createOscillator(); click.type="square"; click.frequency.value=freq*5;
      const clickG=ctx.createGain();
      clickG.gain.setValueAtTime(clickAmount,now);
      clickG.gain.exponentialRampToValueAtTime(0.001,now+0.012);
      click.connect(clickG); clickG.connect(masterGain); click.start(); oscs.push(click);
    }

    // ── Chorus : ±detuneCents → effet cassette légèrement instable ────────────
    if(detuneCents>0){
      [detuneCents,-detuneCents].forEach(c=>{
        const d=ctx.createOscillator(); d.type="sine";
        d.frequency.value=freq*Math.pow(2,c/1200);
        const dG=ctx.createGain(); dG.gain.value=0.22;
        d.connect(dG); dG.connect(epEnv); d.start(); oscs.push(d);
      });
    }

    // ── LP filter — retire le "numérique" ────────────────────────────────────
    lp.type="lowpass"; lp.frequency.value=lpHz; lp.Q.value=lpQ;
  },
  // ── BAGPIPES — Pulse nasal + drone + vibrato souffle ─────────────────────
  BAGPIPES: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{
      pulseWidth  =0.22,   // 0.1 = très nasal / 0.5 = carré doux
      droneGain   =0.35,   // volume du bourdon
      droneLPHz   =280,    // coupure LP du bourdon (garde uniquement le sub)
      vibratoRate =6.0,    // Hz — instabilité du souffle
      vibratoDepth=0.008,  // profondeur pitch LFO (relatif à freq)
      brightness  =3200,   // coupure LP globale
      nasalQ      =2.5,    // résonance du filtre principal
    }=p;

    // ── Onde pulsée étroite via PeriodicWave (plus nasal qu'un simple square) ─
    const N=32; const real=new Float32Array(N); const imag=new Float32Array(N);
    for(let n=1;n<N;n++) imag[n]=(Math.sin(n*Math.PI*pulseWidth)/(n*Math.PI))*2.0;
    const pWave=ctx.createPeriodicWave(real,imag,{disableNormalization:false});
    const osc=ctx.createOscillator(); osc.setPeriodicWave(pWave); osc.frequency.value=freq;

    // ── Vibrato LFO — instabilité humaine du souffle ──────────────────────────
    const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
    lfo.type="sine"; lfo.frequency.value=vibratoRate;
    lfoG.gain.value=freq*vibratoDepth;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    lfo.start(); oscs.push(lfo);

    const oscG=ctx.createGain(); oscG.gain.value=0.65;
    osc.connect(oscG); oscG.connect(masterGain);
    osc.start(); oscs.push(osc);

    // ── Filtre principal — caractère nasal ────────────────────────────────────
    lp.type="lowpass"; lp.frequency.value=brightness; lp.Q.value=nasalQ;

    // ── Bourdon (drone) — octave basse + LP serré ─────────────────────────────
    const drone=ctx.createOscillator(); drone.type="sawtooth";
    drone.frequency.value=freq*0.5;
    const dFilt=ctx.createBiquadFilter(); dFilt.type="lowpass";
    dFilt.frequency.value=droneLPHz; dFilt.Q.value=0.6;
    const dGain=ctx.createGain(); dGain.gain.value=droneGain;
    drone.connect(dFilt); dFilt.connect(dGain); dGain.connect(masterGain);
    drone.start(); oscs.push(drone);
  },
  // ── GUITAR — Pluck physique : filtre env + decay naturel de corde ──────────
  GUITAR: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{
      waveType   ="sawtooth",
      filterOpen =5000,   // Hz au moment du "clac"
      filterClose=700,    // Hz après le decay du filtre
      filterTime =0.10,   // temps de fermeture du filtre (s)
      filterQ    =2.0,
      distAmount =1.2,    // drive du waveshaper (1.0 = clean)
      detuneCents=0,      // légère chorus pour les 12-cordes
      bodyDecay  =0.20,   // temps pour tomber à 30% (s)
      subMix     =0.0,    // corps grave (acoustique)
    }=p;

    // ── Enveloppe de filtre — "clac" de corde ────────────────────────────────
    lp.type="lowpass";
    lp.frequency.setValueAtTime(Math.min(filterOpen,18000),now);
    lp.frequency.exponentialRampToValueAtTime(Math.max(filterClose,60),now+filterTime);
    lp.Q.value=filterQ;

    // ── Enveloppe d'amplitude — pluck shape ──────────────────────────────────
    const pluckEnv=ctx.createGain();
    pluckEnv.gain.setValueAtTime(0.95,now);
    pluckEnv.gain.exponentialRampToValueAtTime(0.28,now+bodyDecay);         // → 30% rapide
    pluckEnv.gain.exponentialRampToValueAtTime(0.001,now+Math.max(release,0.25)); // queue naturelle

    // ── Waveshaper (même pour clean : arrondit le clip) ───────────────────────
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.tanh(x*distAmount)*0.85;} ws.curve=wc;

    // ── Oscillateur principal ─────────────────────────────────────────────────
    const osc=ctx.createOscillator(); osc.type=waveType; osc.frequency.value=freq;
    osc.connect(ws); ws.connect(pluckEnv); pluckEnv.connect(masterGain);
    osc.start(); oscs.push(osc);

    // ── Detuning (chorus 12 cordes / unisson) ────────────────────────────────
    if(detuneCents>0){
      const osc2=ctx.createOscillator(); osc2.type=waveType;
      osc2.frequency.value=freq*Math.pow(2,detuneCents/1200);
      const g2=ctx.createGain(); g2.gain.value=0.45;
      osc2.connect(g2); g2.connect(ws); osc2.start(); oscs.push(osc2);
    }

    // ── Sub corps acoustique ─────────────────────────────────────────────────
    if(subMix>0){
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=subMix;
      sub.connect(subG); subG.connect(pluckEnv); sub.start(); oscs.push(sub);
    }
  },
  // ── OCTOBER — Underwater/Drake : LP très fermé, sine+square étouffé ────────
  OCTOBER: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{lpHz=600,lpQ=0.3,subMix=0.45,squareMix=0.18,detune=4}=p;
    const filter=ctx.createBiquadFilter();
    filter.type='lowpass';
    filter.frequency.setValueAtTime(lpHz,now);
    filter.Q.setValueAtTime(lpQ,now);
    filter.connect(masterGain);
    const sine=ctx.createOscillator(); sine.type='sine'; sine.frequency.value=freq;
    const sine2=ctx.createOscillator(); sine2.type='sine';
    sine2.frequency.value=freq*Math.pow(2,detune/1200);
    const sq=ctx.createOscillator(); sq.type='square'; sq.frequency.value=freq;
    const sqG=ctx.createGain(); sqG.gain.value=squareMix*0.2;
    sq.connect(sqG); sqG.connect(filter);
    sine.connect(filter); sine2.connect(filter);
    const sub=ctx.createOscillator(); sub.type='sine'; sub.frequency.value=freq*0.5;
    const subG=ctx.createGain(); subG.gain.value=subMix;
    sub.connect(subG); subG.connect(masterGain);
    [sine,sine2,sq,sub].forEach(o=>{o.start(now);oscs.push(o);});
  },
  // ── GFUNK — KDOT/West Coast : saw portamento + saturation vinyle ────────────
  GFUNK: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{detuneCents=12,portaDur=0.08,satAmount=2.5,lpHz=2000,lpQ=4,subMix=0.3}=p;
    const filter=ctx.createBiquadFilter();
    filter.type='lowpass'; filter.frequency.value=lpHz; filter.Q.value=lpQ;
    filter.connect(masterGain);
    const ws=ctx.createWaveShaper(); const c=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;c[i]=Math.tanh(x*satAmount)/Math.max(Math.tanh(satAmount),0.001);} ws.curve=c;
    ws.connect(filter);
    const mix=ctx.createGain(); mix.gain.value=0.38; mix.connect(ws);
    const saw=ctx.createOscillator(); saw.type='sawtooth';
    saw.frequency.setValueAtTime(freq*Math.pow(2,portaDur>0?0.35:0),now);
    saw.frequency.exponentialRampToValueAtTime(Math.max(freq,1),now+portaDur);
    const saw2=ctx.createOscillator(); saw2.type='sawtooth';
    saw2.frequency.setValueAtTime(freq*Math.pow(2,detuneCents/1200),now);
    saw2.frequency.exponentialRampToValueAtTime(Math.max(freq*Math.pow(2,detuneCents/1200),1),now+portaDur);
    saw.connect(mix); saw2.connect(mix);
    if(subMix>0){
      const sub=ctx.createOscillator(); sub.type='sine'; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=subMix;
      sub.connect(subG); subG.connect(masterGain); sub.start(now); oscs.push(sub);
    }
    [saw,saw2].forEach(o=>{o.start(now);oscs.push(o);});
  },
  // ── SUPERSAW — STARBOY/Synthwave : 7 saws désaccordés, brillant, épique ────
  SUPERSAW: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{detuneCents=25,numSaws=7,satAmount=1.5,lpHz=9000,lpQ=0.8}=p;
    const filter=ctx.createBiquadFilter();
    filter.type='lowpass'; filter.frequency.value=lpHz; filter.Q.value=lpQ;
    filter.connect(masterGain);
    const ws=ctx.createWaveShaper(); const c=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;c[i]=Math.tanh(x*satAmount)/Math.max(Math.tanh(satAmount),0.001);} ws.curve=c;
    ws.connect(filter);
    const merge=ctx.createGain(); merge.gain.value=0.14; merge.connect(ws);
    const spreads=[-1.5,-0.9,-0.3,0,0.3,0.9,1.5];
    for(let i=0;i<Math.min(numSaws,7);i++){
      const saw=ctx.createOscillator(); saw.type='sawtooth';
      saw.frequency.value=freq*Math.pow(2,(spreads[i]*detuneCents)/1200);
      saw.connect(merge); saw.start(now); oscs.push(saw);
    }
  },
  // ── ASTRO — Travis Scott : flûte distordue + LFO pitch + bitcrush ───────────
  ASTRO: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{wobbleRate=3.5,wobbleDepth=0.015,bitSteps=6,distAmount=3.0,lpHz=4000,lpQ=2.5}=p;
    const filter=ctx.createBiquadFilter();
    filter.type='lowpass'; filter.frequency.value=lpHz; filter.Q.value=lpQ;
    filter.connect(masterGain);
    const ws=ctx.createWaveShaper(); const c=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;c[i]=Math.round(Math.tanh(x*distAmount)/Math.max(Math.tanh(distAmount),0.001)*bitSteps)/bitSteps;} ws.curve=c;
    ws.connect(filter);
    const osc=ctx.createOscillator(); osc.type='triangle'; osc.frequency.value=freq;
    osc.connect(ws);
    const lfo=ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=wobbleRate;
    const lfoG=ctx.createGain(); lfoG.gain.value=freq*wobbleDepth;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    [osc,lfo].forEach(o=>{o.start(now);oscs.push(o);});
  },
  // ── YEEZY — 3 modes : Soul-Chop / Industrial / Donda cathedral ─────────────
  YEEZY: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{mode=0,satAmount=2.0,lpHz=3000,lpQ=2.0,subMix=0.0,hpHz=250}=p;
    if(mode===0){
      // Soul-Chop : triangle + HP filter (sample pitché vintage)
      const filter=ctx.createBiquadFilter();
      filter.type='highpass'; filter.frequency.value=hpHz; filter.Q.value=1.8;
      filter.connect(masterGain);
      const lp2=ctx.createBiquadFilter();
      lp2.type='lowpass'; lp2.frequency.value=5000; lp2.Q.value=0.6;
      lp2.connect(filter);
      const osc=ctx.createOscillator(); osc.type='triangle'; osc.frequency.value=freq;
      const osc2=ctx.createOscillator(); osc2.type='triangle';
      osc2.frequency.value=freq*Math.pow(2,8/1200);
      osc.connect(lp2); osc2.connect(lp2);
      [osc,osc2].forEach(o=>{o.start(now);oscs.push(o);});
    } else if(mode===1){
      // Industrial/Yeezus : square + clip asymétrique
      const filter=ctx.createBiquadFilter();
      filter.type='lowpass'; filter.frequency.value=lpHz; filter.Q.value=lpQ;
      filter.connect(masterGain);
      const ws=ctx.createWaveShaper(); const c=new Float32Array(256);
      for(let i=0;i<256;i++){const x=(i/128)-1;
        c[i]=x>0?Math.min(x*satAmount,0.9):-Math.min(-x*(satAmount*0.6),0.75);}
      ws.curve=c; ws.connect(filter);
      const osc=ctx.createOscillator(); osc.type='square'; osc.frequency.value=freq;
      osc.connect(ws); osc.start(now); oscs.push(osc);
    } else {
      // Donda/Dark : sine pure + sub profond
      const filter=ctx.createBiquadFilter();
      filter.type='lowpass'; filter.frequency.value=2500; filter.Q.value=0.5;
      filter.connect(masterGain);
      const osc=ctx.createOscillator(); osc.type='sine'; osc.frequency.value=freq;
      osc.connect(filter); osc.start(now); oscs.push(osc);
      if(subMix>0){
        const sub=ctx.createOscillator(); sub.type='sine'; sub.frequency.value=freq*0.25;
        const subG=ctx.createGain(); subG.gain.value=subMix;
        sub.connect(subG); subG.connect(masterGain); sub.start(now); oscs.push(sub);
      }
    }
  },
  HORROR: (freq,now,ctx,masterGain,lp,oscs,release,p)=>{
    const{modRatio=1.013,driftAmount=0.02,bitSteps=12,lpFreq=2000,lpQ=2}=p;
    const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
    const drift=ctx.createOscillator(); const driftG=ctx.createGain();
    drift.type="sine"; drift.frequency.value=0.12; driftG.gain.value=freq*driftAmount;
    drift.connect(driftG); driftG.connect(saw.frequency); drift.start(); oscs.push(drift);
    const saw2=ctx.createOscillator(); saw2.type="sawtooth"; saw2.frequency.value=freq*modRatio;
    const saw2G=ctx.createGain(); saw2G.gain.value=0.35;
    saw2.connect(saw2G); saw2G.connect(masterGain); saw2.start(); oscs.push(saw2);
    const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
    for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.round(x*bitSteps)/bitSteps*0.85;} ws.curve=wc;
    const sawG=ctx.createGain(); sawG.gain.value=0.45;
    saw.connect(sawG); sawG.connect(ws); ws.connect(masterGain); saw.start(); oscs.push(saw);
    lp.frequency.value=lpFreq; lp.Q.value=lpQ;
  },
};

export const BANK = {
  PADS: {
    label:"🎹 PADS", color:"#e03030",
    presets:[
      {id:"bleed", name:"BLEED", color:"#e03030", atk:0.4,  rel:2.0, desc:"Nostalgic emotional trap"},
      {id:"void",  name:"VOID",  color:"#6030e0", atk:2.5,  rel:3.0, desc:"Threatening cinematic weight"},
      {id:"frost", name:"FROST", color:"#30b0e0", atk:0.2,  rel:1.5, desc:"Cold FM spatial distance"},
      {id:"ember", name:"EMBER", color:"#e07030", atk:0.3,  rel:1.8, desc:"Warm nostalgic glow"},
      {id:"lunar", name:"LUNAR", color:"#c0a0ff", atk:0.8,  rel:2.5, desc:"Floating moon atmosphere"},
      {id:"static",name:"STATIC",color:"#a0a060", atk:0.1,  rel:1.2, desc:"Gritty lo-fi vinyl texture"},
      {id:"depth", name:"DEPTH", color:"#30e0a0", atk:0.5,  rel:3.5, desc:"Massive sub presence"},
      {id:"ghost", name:"GHOST", color:"#e0e0e0", atk:1.0,  rel:3.0, desc:"Resonant phantom shimmer"},
      {id:"neon",  name:"NEON",  color:"#e030c0", atk:0.05, rel:0.9, desc:"Synth-wave bright lead"},
      {id:"abyss", name:"ABYSS", color:"#4060a0", atk:1.5,  rel:4.0, desc:"Bottomless dark void"},
      {id:"silk",  name:"SILK",  color:"#e0b0a0", atk:0.25, rel:1.6, desc:"Smooth silky warmth"},
      {id:"pulse", name:"PULSE", color:"#60e060", atk:0.02, rel:0.7, desc:"Clean punchy attack"},
      // ── CINÉMATIQUE ────────────────────────────────────────
      {id:"titan",  name:"TITAN",  color:"#a040e0", atk:1.2,  rel:4.5, desc:"Massive cinematic swell"},
      {id:"oracle", name:"ORACLE", color:"#8050d0", atk:0.8,  rel:3.5, desc:"Mystical hovering texture"},
      {id:"relic",  name:"RELIC",  color:"#907040", atk:0.6,  rel:3.0, desc:"Ancient artefact resonance"},
      {id:"wraith", name:"WRAITH", color:"#c0c0d0", atk:1.5,  rel:5.0, desc:"Spectral drifting presence"},
      {id:"signal", name:"SIGNAL", color:"#40d0c0", atk:0.08, rel:1.4, desc:"Distant radio transmission"},
      // ── DARK / HEAVY ───────────────────────────────────────
      {id:"dread",  name:"DREAD",  color:"#503040", atk:2.0,  rel:5.0, desc:"Oppressive low dread"},
      {id:"necrosis",name:"NECRO", color:"#304030", atk:1.0,  rel:4.0, desc:"Decaying organic mass"},
      {id:"coffin", name:"COFFIN", color:"#302030", atk:0.5,  rel:3.5, desc:"Sealed silence within"},
      // ── BRIGHT / AIRY ──────────────────────────────────────
      {id:"aurora",  name:"AURORA", color:"#80ffe0", atk:0.3,  rel:2.8, desc:"Northern lights shimmer"},
      {id:"drift",   name:"DRIFT",  color:"#a0d0ff", atk:0.6,  rel:3.0, desc:"Slow cloud movement"},
      {id:"haze",    name:"HAZE",   color:"#d0e8ff", atk:0.4,  rel:2.5, desc:"Soft morning haze"},
      // ── RYTHMIC ────────────────────────────────────────────
      {id:"click",   name:"CLICK",  color:"#ffe080", atk:0.01, rel:0.4, desc:"Tight rhythmic stab"},
      {id:"chop",    name:"CHOP",   color:"#e0c060", atk:0.005,rel:0.3, desc:"Gated chopped pad"},
      {id:"gate",    name:"GATE",   color:"#c0a040", atk:0.02, rel:0.5, desc:"Trance gated swell"},
      // ── ORGANIC ────────────────────────────────────────────
      {id:"breath",  name:"BREATH", color:"#d0f0c0", atk:0.7,  rel:2.0, desc:"Breathlike soft attack"},
      {id:"wood",    name:"WOOD",   color:"#b08050", atk:0.15, rel:1.8, desc:"Warm woody resonance"},
      {id:"soil",    name:"SOIL",   color:"#806040", atk:0.25, rel:2.2, desc:"Earthy grounded tone"},
      // ── SPACE ──────────────────────────────────────────────
      {id:"nebula",  name:"NEBULA", color:"#9060ff", atk:2.0,  rel:6.0, desc:"Interstellar gas cloud"},
      {id:"quasar",  name:"QUASAR", color:"#ff60a0", atk:1.0,  rel:4.5, desc:"Pulsing energy burst"},
      {id:"cosmos",  name:"COSMOS", color:"#6080ff", atk:1.5,  rel:5.5, desc:"Infinite cosmic texture"},
      // ── TEXTURE ────────────────────────────────────────────
      {id:"tape",    name:"TAPE",   color:"#c09060", atk:0.2,  rel:2.0, desc:"Tape saturation — warm noise"},
      {id:"vinyl_p", name:"VINYL",  color:"#806050", atk:0.1,  rel:1.5, desc:"Vinyl crackle pad — lo-fi"},
      {id:"cassette_p",name:"CASS", color:"#a07050", atk:0.15, rel:1.8, desc:"Cassette hiss — degraded"},
      {id:"glass_w", name:"GLASS",  color:"#c0e8ff", atk:0.3,  rel:3.0, desc:"Glass harmonica — ethereal"},
      {id:"string_e",name:"STRING", color:"#e0c090", atk:0.4,  rel:2.5, desc:"String ensemble — orchestral"},
      {id:"brass_s", name:"BRASS",  color:"#d0a040", atk:0.06, rel:1.2, desc:"Brass section swell — punchy"},
      {id:"flute_p", name:"FLUTE",  color:"#90d0a0", atk:0.08, rel:1.5, desc:"Flute pad — breathy & light"},
      {id:"oboe_p",  name:"OBOE",   color:"#b0d080", atk:0.05, rel:1.3, desc:"Oboe — nasal & expressive"},
      {id:"cello_p", name:"CELLO",  color:"#c08060", atk:0.3,  rel:2.8, desc:"Cello section — rich low bow"},
      {id:"violin_p",name:"VIOLIN", color:"#e0a070", atk:0.1,  rel:2.0, desc:"Violin section — soaring"},
      {id:"harp_p",  name:"HARP",   color:"#ffe0a0", atk:0.002,rel:3.0, desc:"Orchestral harp — glissando"},
      {id:"choir_s", name:"CHOIRPAD",color:"#d0c0ff",atk:0.8,  rel:4.0, desc:"Choir pad — wordless voices"},
      {id:"reed",    name:"REED",   color:"#a0c060", atk:0.04, rel:1.4, desc:"Reed organ — angular harmonics"},
      {id:"hammond", name:"HAMMOND",color:"#e0a030", atk:0.01, rel:0.6, desc:"Hammond B3 — rotary spin"},
      {id:"thunder", name:"THUNDER",color:"#7070b0", atk:0.0,  rel:3.0, desc:"Thunder rumble — storm sub"},
      {id:"lava",    name:"LAVA",   color:"#ff5020", atk:0.3,  rel:2.5, desc:"Molten lava — slow boil"},
      {id:"specter",   name:"SPECTER", color:"#c080ff", atk:0.38, rel:2.2, desc:"Formant vocal pad — haunted ghost"},
      {id:"bass_space",  name:"SPACE",   color:"#8040ff", atk:0.3,  rel:2.0, desc:"Space pad — pitch LFO + delay"},
      {id:"bass_drone",  name:"DRONE",   color:"#6080c0", atk:0.5,  rel:3.0, desc:"Drone pad — octaves + drift lent"},
      {id:"bass_breath", name:"BREATH",  color:"#a0c0d0", atk:0.2,  rel:1.5, desc:"Breath pad — noise filtré + sine"},
      {id:"bass_choir",  name:"CHOIR",   color:"#c0a0e0", atk:0.1,  rel:2.0, desc:"Choir pad — ensemble sines battement"},
      {id:"bass_vintage",name:"VINTAGE", color:"#d4a040", atk:0.02, rel:1.2, desc:"Vintage pad — triangles chorus lent"},
    ]
  },
  PIANO: {
    label:"🎵 PIANO", color:"#f0d060",
    presets:[
      // ── CLASSIQUE ──────────────────────────────────────────
      {id:"steinway",   name:"STEINWAY",  color:"#f0d060", atk:0.005,rel:2.5, desc:"Grand piano — rich harmonics"},
      {id:"upright",    name:"UPRIGHT",   color:"#d4a840", atk:0.006,rel:1.8, desc:"Upright piano — wooden resonance"},
      {id:"boudoir",    name:"BOUDOIR",   color:"#c89030", atk:0.008,rel:2.2, desc:"Baby grand — intimate & warm"},
      {id:"concert",    name:"CONCERT",   color:"#ffe880", atk:0.004,rel:3.0, desc:"Concert hall grand — majestic"},
      {id:"baroque",    name:"BAROQUE",   color:"#e8c060", atk:0.003,rel:1.5, desc:"Harpsichord-like piano — plucky"},
      // ── LO-FI / TAPE ───────────────────────────────────────
      {id:"lofi_piano", name:"LOFI",      color:"#c8a878", atk:0.008,rel:1.8, desc:"Lo-fi tape piano — warm & dusty"},
      {id:"cassette",   name:"CASSETTE",  color:"#b89060", atk:0.01, rel:1.5, desc:"Cassette degraded — glitchy tape"},
      {id:"dusty",      name:"DUSTY",     color:"#a07850", atk:0.012,rel:1.6, desc:"Dusty vinyl piano — crackle"},
      {id:"midnight",   name:"MIDNIGHT",  color:"#806040", atk:0.015,rel:2.0, desc:"Late night lo-fi bedroom"},
      {id:"wabi",       name:"WABI",      color:"#907858", atk:0.02, rel:1.4, desc:"Wabi-sabi imperfect beauty"},
      // ── ÉLECTRIQUE ─────────────────────────────────────────
      {id:"rhodes",     name:"RHODES",    color:"#60c8e0", atk:0.003,rel:1.5, desc:"Electric piano — bell-like FM"},
      {id:"wurlitzer",  name:"WURLY",     color:"#40a0c0", atk:0.004,rel:1.3, desc:"Wurlitzer — gritty electric bark"},
      {id:"clavinet",   name:"CLAVI",     color:"#20c080", atk:0.002,rel:0.9, desc:"Clavinet — funky percussive chop"},
      {id:"dyno",       name:"DYNO",      color:"#50d0a0", atk:0.003,rel:1.6, desc:"Dyno Rhodes — bright & punchy"},
      {id:"suitcase",   name:"SUITCASE",  color:"#30b8b0", atk:0.005,rel:2.0, desc:"Suitcase Rhodes — deep & warm"},
      // ── CINÉMATIQUE / DARK ─────────────────────────────────
      {id:"dark_piano", name:"DARK",      color:"#8060c0", atk:0.01, rel:3.5, desc:"Cinematic dark piano — heavy"},
      {id:"requiem",    name:"REQUIEM",   color:"#6040a0", atk:0.02, rel:4.0, desc:"Requiem piano — church mourning"},
      {id:"noir",       name:"NOIR",      color:"#5030c0", atk:0.008,rel:3.0, desc:"Film noir — shadows & rain"},
      {id:"gothic",     name:"GOTHIC",    color:"#7050b0", atk:0.015,rel:3.5, desc:"Gothic cathedral resonance"},
      {id:"abyss_p",    name:"ABYSS",     color:"#4020a0", atk:0.03, rel:4.5, desc:"Piano from the deep — abyssal"},
      // ── JOUET / ENFANCE ────────────────────────────────────
      {id:"toy_piano",  name:"TOY",       color:"#f080a0", atk:0.002,rel:0.8, desc:"Toy piano — bright & playful"},
      {id:"musicbox",   name:"MUSICBOX",  color:"#e870b0", atk:0.001,rel:1.5, desc:"Music box — delicate clockwork"},
      {id:"kalimba",    name:"KALIMBA",   color:"#ff90c0", atk:0.001,rel:2.0, desc:"Kalimba — African thumb piano"},
      {id:"xylophone",  name:"XYLO",      color:"#f060a0", atk:0.001,rel:0.6, desc:"Xylophone — wooden bars"},
      {id:"glocken",    name:"GLOCKEN",   color:"#e8a0c8", atk:0.001,rel:1.8, desc:"Glockenspiel — shimmering bells"},
      // ── PRÉPARÉ / EXPÉRIMENTAL ─────────────────────────────
      {id:"prepared",   name:"PREPARED",  color:"#a0d080", atk:0.01, rel:2.0, desc:"Prepared piano — Cage style"},
      {id:"cluster",    name:"CLUSTER",   color:"#80c060", atk:0.008,rel:2.5, desc:"Tone cluster — dense harmonics"},
      {id:"inside",     name:"INSIDE",    color:"#60a040", atk:0.005,rel:3.0, desc:"Inside piano — plucked strings"},
      {id:"bowed",      name:"BOWED",     color:"#90c070", atk:0.5,  rel:3.5, desc:"Bowed piano strings — eerie"},
      {id:"detuned",    name:"DETUNED",   color:"#70b050", atk:0.008,rel:2.0, desc:"Microtonal detuned — warped"},
      // ── JAZZ ───────────────────────────────────────────────
      {id:"jazz_p",     name:"JAZZ",      color:"#e0a030", atk:0.004,rel:1.2, desc:"Jazz piano — mellow swing"},
      {id:"bebop",      name:"BEBOP",     color:"#d09020", atk:0.003,rel:1.0, desc:"Bebop velocity — fast attack"},
      {id:"ballad",     name:"BALLAD",    color:"#c8b040", atk:0.008,rel:2.0, desc:"Jazz ballad — tender & warm"},
      {id:"smoky",      name:"SMOKY",     color:"#b8a030", atk:0.01, rel:1.8, desc:"Smoky bar piano — rough edges"},
      {id:"stride",     name:"STRIDE",    color:"#d0b050", atk:0.003,rel:1.3, desc:"Stride piano — ragtime energy"},
      // ── AMBIENT / SPATIAL ──────────────────────────────────
      {id:"ambient_p",  name:"AMBIENT",   color:"#60a8e0", atk:0.5,  rel:5.0, desc:"Ambient sustain — infinite space"},
      {id:"reverb_p",   name:"REVERB",    color:"#4090d0", atk:0.01, rel:4.0, desc:"Cathedral reverb — vast hall"},
      {id:"space_p",    name:"SPACE",     color:"#3080c0", atk:0.3,  rel:4.5, desc:"Space piano — zero gravity"},
      {id:"shimmer",    name:"SHIMMER",   color:"#5098d8", atk:0.2,  rel:3.5, desc:"Shimmer pad piano — glowing"},
      {id:"frozen",     name:"FROZEN",    color:"#70b0e8", atk:1.0,  rel:6.0, desc:"Frozen time — slow attack"},
      // ── TRAP / HIP-HOP ─────────────────────────────────────
      {id:"trap_p",     name:"TRAP",      color:"#e06060", atk:0.003,rel:1.5, desc:"Trap piano — 808 companion"},
      {id:"drill_p",    name:"DRILL",     color:"#d05050", atk:0.002,rel:1.2, desc:"UK Drill piano — cold & minor"},
      {id:"cloud_p",    name:"CLOUD",     color:"#c07070", atk:0.008,rel:2.0, desc:"Cloud rap piano — dreamy"},
      {id:"opium_p",    name:"OPIUM",     color:"#e08080", atk:0.005,rel:1.8, desc:"Opium label piano — hazy"},
      {id:"emo_trap",   name:"EMOTRAP",   color:"#d06060", atk:0.01, rel:2.5, desc:"Emo trap piano — nostalgic pain"},
      // ── WORLD / ETHNIQUE ───────────────────────────────────
      {id:"koto",       name:"KOTO",      color:"#e8b060", atk:0.002,rel:1.5, desc:"Japanese koto — silk strings"},
      {id:"gamelan",    name:"GAMELAN",   color:"#d0a050", atk:0.001,rel:2.5, desc:"Balinese gamelan — bronze bells"},
      {id:"sitar_p",    name:"SITAR",     color:"#c09040", atk:0.003,rel:1.8, desc:"Sitar-piano hybrid — Indian"},
      {id:"mbira",      name:"MBIRA",     color:"#b08030", atk:0.001,rel:1.2, desc:"African mbira — thumb metal"},
      {id:"santur",     name:"SANTUR",    color:"#d0b060", atk:0.002,rel:2.0, desc:"Persian santur — hammered dulcimer"},
      // ── VINTAGE / RÉTRO ────────────────────────────────────
      {id:"honky",      name:"HONKY",     color:"#d4c060", atk:0.005,rel:1.0, desc:"Honky tonk — saloon detuned"},
      {id:"rag",        name:"RAG",       color:"#c8b040", atk:0.004,rel:1.2, desc:"Ragtime — bouncy & bright"},
      {id:"silent_era", name:"SILENT",    color:"#b8a030", atk:0.003,rel:0.9, desc:"Silent era — 1920s parlor"},
      {id:"motown",     name:"MOTOWN",    color:"#e0c050", atk:0.004,rel:1.5, desc:"Motown electric — soul groove"},
      {id:"glamrock",   name:"GLAMROCK",  color:"#d0d060", atk:0.003,rel:1.3, desc:"Glam rock piano — dramatic"},
      // ── ÉMOTION / MOOD ─────────────────────────────────────
      {id:"melancholy", name:"MELA",      color:"#9080e0", atk:0.01, rel:3.0, desc:"Pure melancholy — autumn rain"},
      {id:"hope",       name:"HOPE",      color:"#80e090", atk:0.008,rel:2.5, desc:"Hope piano — morning light"},
      {id:"anger",      name:"ANGER",     color:"#e04040", atk:0.002,rel:0.8, desc:"Anger piano — aggressive keys"},
      {id:"tender",     name:"TENDER",    color:"#e0a0b0", atk:0.015,rel:2.8, desc:"Tender touch — gentle love"},
      {id:"nostalgia",  name:"NOSTALGIA", color:"#c0b090", atk:0.012,rel:2.5, desc:"Pure nostalgia — childhood"},
      // ── HYBRIDE SYNTH ──────────────────────────────────────
      {id:"fm_grand",   name:"FMGRAND",   color:"#40e0b0", atk:0.004,rel:2.0, desc:"FM synthesis grand — DX7 style"},
      {id:"fm_soft",    name:"FMSOFT",    color:"#30d0a0", atk:0.008,rel:2.5, desc:"FM soft piano — gentle bells"},
      {id:"additive_p", name:"ADDITIVE",  color:"#50e8c0", atk:0.005,rel:2.2, desc:"Additive synthesis — pure tones"},
      {id:"wavetable_p",name:"WAVE",      color:"#60f0d0", atk:0.006,rel:1.8, desc:"Wavetable morphing — shifting"},
      {id:"granular_p", name:"GRANULAR",  color:"#70e8c8", atk:0.1,  rel:2.5, desc:"Granular piano — fragmented"},
      // ── NATURE / ACOUSTIQUE ────────────────────────────────
      {id:"rain_p",     name:"RAIN",      color:"#70b0d0", atk:0.01, rel:3.0, desc:"Rain drops on piano keys"},
      {id:"forest_p",   name:"FOREST",    color:"#60a050", atk:0.02, rel:3.5, desc:"Forest resonance — wood & air"},
      {id:"cave_p",     name:"CAVE",      color:"#809070", atk:0.015,rel:4.0, desc:"Cave echo — stone resonance"},
      {id:"ocean_p",    name:"OCEAN",     color:"#5090b0", atk:0.3,  rel:5.0, desc:"Ocean depth — slow waves"},
      {id:"wind_p",     name:"WIND",      color:"#80a0c0", atk:0.4,  rel:4.5, desc:"Wind through piano strings"},
      // ── BELL / MÉTALLIQUE ──────────────────────────────────
      {id:"church_bell",name:"CHURCH",    color:"#d0d0a0", atk:0.001,rel:4.0, desc:"Church bell — bronze resonance"},
      {id:"crystal",    name:"CRYSTAL",   color:"#c0e0f0", atk:0.001,rel:3.0, desc:"Crystal glass — pure sine"},
      {id:"metal_p",    name:"METAL",     color:"#a0b0c0", atk:0.002,rel:2.0, desc:"Metal plates — industrial"},
      {id:"tubular",    name:"TUBULAR",   color:"#b0c0d0", atk:0.001,rel:3.5, desc:"Tubular bells — orchestra"},
      {id:"bowl",       name:"BOWL",      color:"#c0d0e0", atk:0.005,rel:5.0, desc:"Tibetan bowl — meditation"},
      // ── BRISÉ / DAMAGED ────────────────────────────────────
      {id:"broken",     name:"BROKEN",    color:"#808080", atk:0.01, rel:1.5, desc:"Broken piano — missing notes"},
      {id:"ghost_p",    name:"GHOST",     color:"#b0b0b0", atk:0.02, rel:3.0, desc:"Ghost piano — half-heard"},
      {id:"haunted",    name:"HAUNTED",   color:"#909090", atk:0.03, rel:3.5, desc:"Haunted house piano — horror"},
      {id:"decayed",    name:"DECAYED",   color:"#a09090", atk:0.015,rel:2.5, desc:"Decayed strings — rotting wood"},
      {id:"warped",     name:"WARPED",    color:"#b0a0a0", atk:0.02, rel:2.0, desc:"Warped by heat — out of tune"},
      // ── MINIMALISTE ────────────────────────────────────────
      {id:"sine_p",     name:"SINE",      color:"#e0e0e0", atk:0.005,rel:2.0, desc:"Pure sine piano — minimal"},
      {id:"glass_p",    name:"GLASS",     color:"#d0e8f0", atk:0.003,rel:2.5, desc:"Philip Glass style — minimalism"},
      {id:"satie",      name:"SATIE",     color:"#d8e0f8", atk:0.008,rel:2.8, desc:"Satie Gymnopédie — naked beauty"},
      {id:"arvo",       name:"ARVO",      color:"#c8d8f0", atk:0.02, rel:4.0, desc:"Arvo Pärt tintinnabuli — sparse"},
      {id:"eno_p",      name:"ENO",       color:"#b8c8e8", atk:0.3,  rel:5.5, desc:"Brian Eno ambient piano"},
      // ── DRAMATIQUE ─────────────────────────────────────────
      {id:"storm",      name:"STORM",     color:"#6070c0", atk:0.005,rel:2.0, desc:"Stormy — fast & dramatic"},
      {id:"heroic",     name:"HEROIC",    color:"#7080d0", atk:0.003,rel:1.8, desc:"Heroic fanfare — triumphant"},
      {id:"tragic",     name:"TRAGIC",    color:"#5060b0", atk:0.01, rel:3.0, desc:"Tragic — descending darkness"},
      {id:"epic",       name:"EPIC",      color:"#8090e0", atk:0.008,rel:3.5, desc:"Epic orchestral — swelling"},
      {id:"lullaby",    name:"LULLABY",   color:"#a0b0e8", atk:0.02, rel:3.0, desc:"Lullaby — gentle & rocking"},
    ]
  },
  VOICES: {
    label:"🎤 VOICES", color:"#ff80cc",
    presets:[
      {id:"nuts",     name:"NUTS",    color:"#ff80cc", atk:0.35, rel:2.2, desc:"Haunted soft voice — Lil Peep"},
      // ── MASCULINES ─────────────────────────────────────────
      {id:"baritone", name:"BARI",    color:"#8060a0", atk:0.1,  rel:1.8, desc:"Deep baritone — commanding"},
      {id:"tenor",    name:"TENOR",   color:"#a080c0", atk:0.08, rel:1.5, desc:"Lyric tenor — operatic"},
      {id:"bass_v",   name:"BASS",    color:"#604080", atk:0.15, rel:2.0, desc:"Bass profundo — dark depths"},
      {id:"falsetto", name:"FALSETTO",color:"#c0a0e0", atk:0.05, rel:1.2, desc:"Male falsetto — airy & light"},
      {id:"croon",    name:"CROON",   color:"#9070b0", atk:0.12, rel:1.6, desc:"Crooner — velvet lounge"},
      // ── FÉMININES ──────────────────────────────────────────
      {id:"soprano",  name:"SOPRANO", color:"#ffb0e0", atk:0.06, rel:1.5, desc:"Classical soprano — soaring"},
      {id:"mezzo",    name:"MEZZO",   color:"#e090c8", atk:0.08, rel:1.8, desc:"Mezzo-soprano — rich warmth"},
      {id:"alto_v",   name:"ALTO",    color:"#d070b0", atk:0.1,  rel:2.0, desc:"Contralto — smoky depth"},
      {id:"breathy",  name:"BREATHY", color:"#ffd0f0", atk:0.04, rel:1.0, desc:"Breathy whisper — intimate"},
      {id:"belt",     name:"BELT",    color:"#ff50a0", atk:0.02, rel:0.8, desc:"Belting power — full chest"},
      // ── CHŒUR / ENSEMBLE ───────────────────────────────────
      {id:"choir",    name:"CHOIR",   color:"#e0c0f8", atk:0.3,  rel:3.0, desc:"Mixed choir — cathedral"},
      {id:"gospel",   name:"GOSPEL",  color:"#f0d060", atk:0.1,  rel:2.0, desc:"Gospel choir — soulful"},
      {id:"monks",    name:"MONKS",   color:"#c0c0a0", atk:0.5,  rel:4.0, desc:"Gregorian chant — ancient"},
      {id:"unison",   name:"UNISON",  color:"#d0e0f0", atk:0.08, rel:2.5, desc:"Unison voices — massive"},
      {id:"madrigal", name:"MADRI",   color:"#e8d0e0", atk:0.1,  rel:2.2, desc:"Renaissance madrigal — lush"},
      // ── TRAITÉ / PROCESSED ─────────────────────────────────
      {id:"vocoder",  name:"VOCODER", color:"#40e0ff", atk:0.02, rel:0.8, desc:"Vocoder — robotic harmony"},
      {id:"talkbox",  name:"TALKBOX", color:"#20d0e0", atk:0.01, rel:0.6, desc:"Talk box — funkadelic speech"},
      {id:"glitch_v", name:"GLITCH",  color:"#00ffcc", atk:0.005,rel:0.4, desc:"Glitched voice — chopped bytes"},
      {id:"pitch_v",  name:"PITCH",   color:"#80ffe0", atk:0.03, rel:1.0, desc:"Pitch-shifted alien voices"},
      {id:"formant",  name:"FORMANT", color:"#60d0c0", atk:0.04, rel:1.2, desc:"Formant shifted — morphing"},
      // ── STYLISÉES ──────────────────────────────────────────
      {id:"trap_v",   name:"TRAP",    color:"#ff4080", atk:0.01, rel:1.5, desc:"Auto-tune trap — 808 vocal"},
      {id:"rnb_v",    name:"RNB",     color:"#e06080", atk:0.02, rel:1.8, desc:"R&B run — melismatic soul"},
      {id:"pop_v",    name:"POP",     color:"#ff80b0", atk:0.01, rel:1.0, desc:"Pop vocal chop — clean cut"},
      {id:"jazz_v",   name:"JAZZ",    color:"#d0a040", atk:0.05, rel:1.5, desc:"Jazz scat — improvised syllables"},
      {id:"opera_v",  name:"OPERA",   color:"#c080e0", atk:0.08, rel:2.5, desc:"Operatic vibrato — grand hall"},
      // ── ETHNIQUES / WORLD ──────────────────────────────────
      {id:"throat",   name:"THROAT",  color:"#a08060", atk:0.2,  rel:3.0, desc:"Throat singing — overtone"},
      {id:"yodel",    name:"YODEL",   color:"#80a060", atk:0.05, rel:0.8, desc:"Alpine yodel — register break"},
      {id:"pygmy",    name:"PYGMY",   color:"#70b070", atk:0.08, rel:1.5, desc:"Pygmy polyphony — forest"},
      {id:"muezzin",  name:"MUEZZIN", color:"#d0a080", atk:0.1,  rel:2.0, desc:"Islamic call — resonant air"},
      {id:"siren_v",  name:"SIREN",   color:"#80d0ff", atk:0.3,  rel:3.5, desc:"Mythic siren — hypnotic call"},
    ]
  },
  LEADS: {
    label:"⚡ LEADS", color:"#ffe040",
    presets:[
      {id:"bladee",  name:"BLADEE",  color:"#80e8ff", atk:0.01,  rel:1.2, desc:"Metallic crystalline — Bladee"},
      {id:"suicide", name:"SUICIDE", color:"#9060ff", atk:0.02,  rel:1.8, desc:"Dark distorted scream — $uicideboy$"},
      {id:"kencar",  name:"KENCAR",  color:"#ffe040", atk:0.005, rel:0.8, desc:"Crispy bright supersaw — Ken Carson"},
      {id:"future",  name:"FUTURE",  color:"#40ff80", atk:0.03,  rel:1.5, desc:"808 synth mafia — Future"},
      {id:"travis",  name:"TRAVIS",  color:"#ff8040", atk:0.15,  rel:2.0, desc:"Ethereal flute atmosphere — Travis Scott"},
      {id:"carti",   name:"CARTI",   color:"#ff4060", atk:0.005, rel:0.6, desc:"Distorted rage — Playboi Carti"},
      // ── SYNTH CLASSIC ──────────────────────────────────────
      {id:"moog",    name:"MOOG",    color:"#ff9030", atk:0.01,  rel:1.0, desc:"Moog ladder filter — fat"},
      {id:"juno",    name:"JUNO",    color:"#30c0ff", atk:0.02,  rel:1.5, desc:"Juno chorus — lush 80s"},
      {id:"dx7",     name:"DX7",     color:"#60ff90", atk:0.005, rel:1.2, desc:"FM electric piano — bright"},
      {id:"prophet", name:"PROPHET", color:"#ff6030", atk:0.01,  rel:1.3, desc:"Prophet-5 — warm poly"},
      {id:"oberheim",name:"OB",      color:"#ff4050", atk:0.015, rel:1.6, desc:"Oberheim strings — lush"},
      // ── SUPERSAW / EDM ─────────────────────────────────────
      {id:"hyper",   name:"HYPER",   color:"#ff00ff", atk:0.005, rel:0.8, desc:"Hypersaw — festival anthem"},
      {id:"pluck",   name:"PLUCK",   color:"#ffff00", atk:0.001, rel:0.6, desc:"Supersaw pluck — trance"},
      {id:"stab",    name:"STAB",    color:"#ff8000", atk:0.001, rel:0.4, desc:"Hard stab — rave chord"},
      {id:"anthem",  name:"ANTHEM",  color:"#00ffff", atk:0.02,  rel:2.0, desc:"Anthem lead — euphoric"},
      {id:"riser",   name:"RISER",   color:"#ff0080", atk:2.0,   rel:0.1, desc:"Build-up riser — drop prep"},
      // ── ARPEGGIATED ────────────────────────────────────────
      {id:"arcade",  name:"ARCADE",  color:"#ff80ff", atk:0.001, rel:0.3, desc:"8-bit arcade — chiptune"},
      {id:"mono_arp",name:"ARP",     color:"#80ffff", atk:0.005, rel:0.5, desc:"Mono arpeggio — driving"},
      {id:"seq",     name:"SEQ",     color:"#ffff80", atk:0.01,  rel:0.6, desc:"Sequenced lead — Kraftwerk"},
      // ── EXPERIMENTAL ───────────────────────────────────────
      {id:"noise_l", name:"NOISE",   color:"#aaaaaa", atk:0.001, rel:0.3, desc:"White noise lead — industrial"},
      {id:"ring",    name:"RING",    color:"#d0e080", atk:0.002, rel:0.8, desc:"Ring modulation — metallic"},
      {id:"bitcrush",name:"BITCR",   color:"#b0c040", atk:0.001, rel:0.5, desc:"Bit crusher — lo-fi digital"},
      // ── GENRE-SPECIFIC ─────────────────────────────────────
      {id:"trance",  name:"TRANCE",  color:"#0080ff", atk:0.01,  rel:1.5, desc:"Trance lead — uplifting"},
      {id:"techno_l",name:"TECHNO",  color:"#404040", atk:0.005, rel:0.7, desc:"Techno lead — industrial dark"},
      {id:"afro",    name:"AFRO",    color:"#ff8840", atk:0.005, rel:0.6, desc:"Afro house lead — percussive"},
      {id:"reggaeton",name:"REG",    color:"#30d060", atk:0.008, rel:0.8, desc:"Reggaeton synth — despacito"},
      {id:"hyperpop",name:"HPOP",    color:"#ff40ff", atk:0.001, rel:0.4, desc:"Hyperpop distorted — PC Music"},
    ]
  },
  BASS: {
    label:"🔊 BASS", color:"#e04040",
    presets:[
      {id:"sub808",    name:"808",     color:"#e04040", atk:0.005, rel:2.5, desc:"Trap 808 — pitch slide + distorsion"},
      {id:"sub",       name:"SUB",     color:"#a060ff", atk:0.01,  rel:1.2, desc:"Sub pur — sine + sous-harmonique"},
      {id:"acid",      name:"ACID",    color:"#c0ff30", atk:0.002, rel:0.5, desc:"TB-303 — sweep filtre resonant"},
      {id:"growl",     name:"GROWL",   color:"#805000", atk:0.008, rel:1.0, desc:"Growl dubstep — LFO filtre agressif"},
      {id:"reese",     name:"REESE",   color:"#4060d0", atk:0.01,  rel:1.2, desc:"Reese DnB — saws désaccordés"},
      {id:"wobble",    name:"WOBBLE",  color:"#60a0e0", atk:0.005, rel:0.8, desc:"Wobble — dubstep LFO"},
      {id:"bass_pluck",name:"PLUCK",   color:"#e0c060", atk:0.001, rel:0.8, desc:"Pluck — Karplus-Strong approximation"},
      {id:"bass_moog", name:"MOOG",    color:"#ff6020", atk:0.01,  rel:1.0, desc:"Moog — ladder filter -24dB/oct"},
      {id:"bass_fuzz", name:"FUZZ",    color:"#cc2020", atk:0.002, rel:0.6, desc:"Fuzz — hard clip + presence"},
      {id:"bass_punch",name:"PUNCH",   color:"#ff4000", atk:0.001, rel:0.5, desc:"Punch — transient click + sine"},
      {id:"bass_orbit", name:"ORBIT",   color:"#8040ff", atk:0.005, rel:0.9, desc:"Orbit — sub sine + FM sideband punch"},
      {id:"bass_anlog", name:"ANLOG",   color:"#d4a040", atk:0.008, rel:1.0, desc:"Anlog — saw + 2-pole LP + warmth"},
      {id:"bass_tape", name:"TAPE",    color:"#c08050", atk:0.015, rel:1.0, desc:"Tape — wow/flutter + saturation"},
      {id:"bass_harm", name:"HARM",    color:"#40e080", atk:0.01,  rel:1.5, desc:"Harm — synthèse additive 6 harmoniques"},
      {id:"bass_funk", name:"FUNK",    color:"#ffcc00", atk:0.003, rel:0.7, desc:"Funk — auto-wah envelope filter"},
      {id:"bass_hum",  name:"HUM",     color:"#6080c0", atk:0.003, rel:1.1, desc:"Hum — saturated 5th power + body LP"},
      {id:"bass_metal",name:"METAL",   color:"#80a0c0", atk:0.005, rel:1.0, desc:"Metal — FM inharmonique décroissant"},
      {id:"bass_glitch",name:"GLITCH", color:"#00ffcc", atk:0.001, rel:0.5, desc:"Glitch — ring mod + sidebands"},
      {id:"bass_deep", name:"DEEP",    color:"#2040a0", atk:0.05,  rel:2.5, desc:"Deep — sub-sub octaves empilées"},
      {id:"bass_trap", name:"TRAP",    color:"#cc2040", atk:0.003, rel:3.0, desc:"Trap — 808 sombre slide long"},
      {id:"bass_mono", name:"MONO",    color:"#e0e0a0", atk:0.01,  rel:0.8, desc:"Mono — saw clean 2-pole LP"},
      {id:"bass_wind",  name:"WIND",   color:"#a0c0d0", atk:0.002, rel:0.7, desc:"Wind — noise burst attack + resonant body"},
      {id:"bass_piano",name:"PIANO",   color:"#f0d080", atk:0.002, rel:1.5, desc:"Piano — harmoniques à decay différent"},
      {id:"bass_dist", name:"DIST",    color:"#800020", atk:0.002, rel:0.6, desc:"Dist — foldback distortion + LP"},
      {id:"bass_stack",name:"STACK",   color:"#c0a0e0", atk:0.004, rel:0.8, desc:"Stack — 3 saws hard-sync + comb bite"},
    ]
  },
  GHIBLI: {
    label:"🌿 GHIBLI", color:"#4caf50",
    presets:[
      {id:"gh_musicbox", name:"MUSIC BOX", color:"#f0e0a0", atk:0.001, rel:1.8, desc:"Boîte à musique — tines métalliques"},
      {id:"gh_flute",    name:"FLUTE",     color:"#a0d0ff", atk:0.06,  rel:1.2, desc:"Flûte douce — sinus + souffle"},
      {id:"gh_accord",   name:"ACCORDION", color:"#e08040", atk:0.03,  rel:0.9, desc:"Accordéon — saws désaccordés + trémolo"},
      {id:"gh_celesta",  name:"CELESTA",   color:"#d0e8ff", atk:0.001, rel:2.2, desc:"Célesta — cristal chaud"},
      {id:"gh_harp",     name:"HARP",      color:"#c8f0b0", atk:0.001, rel:1.5, desc:"Harpe — pincé additif à decay différent"},
      {id:"gh_strings",  name:"STRINGS",   color:"#f0c0b0", atk:0.25,  rel:2.0, desc:"Cordes — ensemble chaud"},
      {id:"gh_oboe",     name:"OBOE",      color:"#d0a060", atk:0.04,  rel:0.8, desc:"Hautbois — ton nasal double anche"},
      {id:"gh_bells",    name:"BELLS",     color:"#b0e0ff", atk:0.001, rel:3.0, desc:"Cloches — partiels inharmoniques"},
      {id:"gh_horn",     name:"HORN",      color:"#e8c060", atk:0.12,  rel:1.0, desc:"Cor — chaleur cuivre rond"},
      {id:"gh_marimba",  name:"MARIMBA",   color:"#c0a060", atk:0.001, rel:0.9, desc:"Marimba — bois mallet decay naturel"},
      {id:"gh_koto",     name:"KOTO",      color:"#f0d0a0", atk:0.001, rel:1.3, desc:"Koto — corde pincée japonaise"},
      {id:"gh_shaku",    name:"SHAKUHACHI",color:"#b0c880", atk:0.08,  rel:1.0, desc:"Shakuhachi — bambou respiré"},
      {id:"gh_kalimba",  name:"KALIMBA",   color:"#e0b880", atk:0.001, rel:1.4, desc:"Kalimba — lamelles métalliques"},
      {id:"gh_lullaby",  name:"LULLABY",   color:"#d0c8f0", atk:0.4,   rel:2.5, desc:"Berceuse — pad triangles doux"},
      {id:"gh_totoro",   name:"TOTORO",    color:"#80a060", atk:0.05,  rel:2.0, desc:"Totoro — grave amical ronron"},
      {id:"gh_chime",    name:"CHIME",     color:"#c0f0e0", atk:0.001, rel:2.8, desc:"Carillon — éolien inharmonique"},
      {id:"gh_sprite",   name:"SPRITE",    color:"#f0e0ff", atk:0.001, rel:1.6, desc:"Lutin — clochettes hautes scintillantes"},
      {id:"gh_meadow",   name:"MEADOW",    color:"#a8d890", atk:0.5,   rel:3.0, desc:"Prairie — pad nature bruissant"},
    ]
  },
  DS: {
    label:"🎮 DS", color:"#e040fb",
    presets:[
      {id:"ds_chip",   name:"CHIP",    color:"#ff4444", atk:0.001, rel:0.5, desc:"Square wave chiptune classique"},
      {id:"ds_pulse",  name:"PULSE",   color:"#ff8800", atk:0.001, rel:0.5, desc:"Pulse 25% — Game Boy lead"},
      {id:"ds_tri8",   name:"TRI8",    color:"#44aaff", atk:0.001, rel:0.8, desc:"Triangle basse — NES bass channel"},
      {id:"ds_poke",   name:"POKE",    color:"#ffcc00", atk:0.002, rel:1.2, desc:"Son Pokemon — cloche douce chip"},
      {id:"ds_mario",  name:"MARIO",   color:"#ff2200", atk:0.001, rel:0.4, desc:"Square rebondissant + octave"},
      {id:"ds_zelda",  name:"ZELDA",   color:"#44dd44", atk:0.008, rel:0.9, desc:"Lead héroïque — 2 squares désaccordés"},
      {id:"ds_kirby",  name:"KIRBY",   color:"#ff88cc", atk:0.001, rel:0.7, desc:"Cute sine chip + vibrato lent"},
      {id:"ds_dung",   name:"DUNGEON", color:"#6644aa", atk:0.05,  rel:1.5, desc:"Pad sombre carré — ambiance donjon"},
      {id:"ds_battle", name:"BATTLE",  color:"#cc2200", atk:0.001, rel:0.6, desc:"Square agressif + distorsion bit"},
      {id:"ds_crystal",name:"CRYSTAL", color:"#aaddff", atk:0.001, rel:1.8, desc:"Partiels cristallins chip"},
      {id:"ds_echo",   name:"ECHO",    color:"#88ccff", atk:0.001, rel:1.0, desc:"Square + delay feedback chip"},
      {id:"ds_bass8",  name:"BASS8",   color:"#aa44ff", atk:0.001, rel:0.7, desc:"Bass triangle 8-bit octave basse"},
      {id:"ds_warp",   name:"WARP",    color:"#00ffcc", atk:0.001, rel:0.8, desc:"Sweep pitch + square — effet warp"},
      {id:"ds_noise",  name:"NOISE",   color:"#cccccc", atk:0.001, rel:0.4, desc:"Canal bruit filtré — snare chip"},
      {id:"ds_star",   name:"STAR",    color:"#ffee44", atk:0.001, rel:1.4, desc:"Étoile — sines aigus scintillants"},
    ]
  },
  ANIME: {
    label:"🌸 ANIME", color:"#ff69b4",
    presets:[
      {id:"an_epic",    name:"EPIC",      color:"#ff4488", atk:0.3,  rel:2.5, desc:"Pad cordes épiques", engine:"VAPOR",  params:{detuneCents:12,lpStart:600, lpEnd:4000,sweepTime:1.5,vibRate:0.20,waveType:"sawtooth"}},
      {id:"an_choir",   name:"CHOIR",     color:"#ffaadd", atk:0.6,  rel:3.0, desc:"Choeur dramatique",  engine:"VAPOR",  params:{detuneCents:5, lpStart:400, lpEnd:2000,sweepTime:2.0,vibRate:0.15,waveType:"sine"}},
      {id:"an_power",   name:"POWER",     color:"#ff2266", atk:0.05, rel:1.5, desc:"Montée épique",      engine:"VAPOR",  params:{detuneCents:8, lpStart:1500,lpEnd:6000,sweepTime:0.8,vibRate:0.30,waveType:"sawtooth"}},
      {id:"an_dream",   name:"DREAM",     color:"#cc88ff", atk:1.5,  rel:4.0, desc:"Séquence de rêve",   engine:"VAPOR",  params:{detuneCents:4, lpStart:300, lpEnd:1200,sweepTime:3.0,vibRate:0.10,waveType:"sine"}},
      {id:"an_ghost",   name:"GHOST",     color:"#eeeeff", atk:0.8,  rel:3.5, desc:"Esprit fantôme",     engine:"VAPOR",  params:{detuneCents:18,lpStart:200, lpEnd:1000,sweepTime:2.5,vibRate:0.08,waveType:"sine"}},
      {id:"an_opening", name:"OPENING",   color:"#ff8844", atk:0.01, rel:1.0, desc:"Générique ouverture",engine:"SCIFI",  params:{modRatio:3.5, modIndex:3,  lfoFreq:0.5, lpQ:5,  lfoDepth:2}},
      {id:"an_battle",  name:"BATTLE",    color:"#ff0044", atk:0.001,rel:0.7, desc:"Musique de combat",  engine:"SCIFI",  params:{modRatio:5.0, modIndex:6,  lfoFreq:2.5, lpQ:8,  lfoDepth:5}},
      {id:"an_hero",    name:"HERO",      color:"#ffcc00", atk:0.08, rel:1.2, desc:"Thème héros",        engine:"SCIFI",  params:{modRatio:2.0, modIndex:4,  lfoFreq:0.8, lpQ:4,  lfoDepth:3}},
      {id:"an_villain", name:"VILLAIN",   color:"#660033", atk:0.3,  rel:2.0, desc:"Thème antagoniste",  engine:"SCIFI",  params:{modRatio:1.5, modIndex:10, lfoFreq:0.2, lpQ:3,  lfoDepth:7}},
      {id:"an_mech",    name:"MECH",      color:"#4488cc", atk:0.02, rel:0.8, desc:"Mecha robot",        engine:"SCIFI",  params:{modRatio:7.0, modIndex:4,  lfoFreq:1.5, lpQ:9,  lfoDepth:4}},
      {id:"an_crystal", name:"CRYSTAL",   color:"#aaddff", atk:0.001,rel:2.0, desc:"Magie cristal",      engine:"SCIFI",  params:{modRatio:4.0, modIndex:2,  lfoFreq:0.3, lpQ:5,  lfoDepth:2}},
      {id:"an_portal",  name:"PORTAL",    color:"#8844ff", atk:0.1,  rel:1.8, desc:"Portail dimensionnel",engine:"SCIFI", params:{modRatio:0.5, modIndex:5,  lfoFreq:0.6, lpQ:4,  lfoDepth:3}},
      {id:"an_sakura",  name:"SAKURA",    color:"#ffbbcc", atk:1.0,  rel:3.5, desc:"Fleur de cerisier",  engine:"VAPOR",  params:{detuneCents:6, lpStart:500, lpEnd:2000,sweepTime:2.0,vibRate:0.18,waveType:"triangle"}},
      {id:"an_spirit",  name:"SPIRIT",    color:"#88ffee", atk:0.4,  rel:3.0, desc:"Esprit nature",      engine:"SCIFI",  params:{modRatio:1.01,modIndex:15, lfoFreq:0.1, lpQ:2,  lfoDepth:8}},
      {id:"an_rise",    name:"RISE",      color:"#ff6600", atk:0.2,  rel:2.5, desc:"Montée dramatique",  engine:"VAPOR",  params:{detuneCents:9, lpStart:400, lpEnd:5000,sweepTime:1.0,vibRate:0.22,waveType:"sawtooth"}},
      {id:"an_wind",    name:"WIND",      color:"#aaffcc", atk:0.6,  rel:2.5, desc:"Vent mystique",      engine:"VAPOR",  params:{detuneCents:7, lpStart:600, lpEnd:2500,sweepTime:1.8,vibRate:0.14,waveType:"triangle"}},
      {id:"an_fire",    name:"FIRE",      color:"#ff4400", atk:0.05, rel:1.2, desc:"Feu intérieur",      engine:"SCIFI",  params:{modRatio:4.5, modIndex:5,  lfoFreq:3.0, lpQ:7,  lfoDepth:4}},
      {id:"an_cyber2",  name:"CYBER",     color:"#00ffcc", atk:0.001,rel:0.5, desc:"Futur cyberpunk J",  engine:"SCIFI",  params:{modRatio:6.0, modIndex:4,  lfoFreq:2.0, lpQ:8,  lfoDepth:3}},
      {id:"an_tears",   name:"TEARS",     color:"#88aaff", atk:2.0,  rel:5.0, desc:"Émotion finale",     engine:"VAPOR",  params:{detuneCents:4, lpStart:200, lpEnd:900, sweepTime:4.0,vibRate:0.08,waveType:"sine"}},
    ]
  },
  RAP_FR: {
    label:"🥖 RAP FR", color:"#0055ff",
    presets:[
      {id:"rf_piano",   name:"PIANO MEL", color:"#f0d080", atk:0.002,rel:1.8, desc:"Piano mélancolique PNL",   engine:"VAPOR",  params:{detuneCents:3, lpStart:2000,lpEnd:6000,sweepTime:0.5,vibRate:0.10,waveType:"sine"}},
      {id:"rf_violin",  name:"VIOLIN",    color:"#cc8844", atk:0.05, rel:1.2, desc:"Violon stab orchestral",   engine:"VAPOR",  params:{detuneCents:3, lpStart:2500,lpEnd:7000,sweepTime:0.6,vibRate:0.35,waveType:"sawtooth"}},
      {id:"rf_strings", name:"STRINGS",   color:"#aa6633", atk:0.3,  rel:2.0, desc:"Cordes dramatiques",       engine:"VAPOR",  params:{detuneCents:10,lpStart:800, lpEnd:3500,sweepTime:1.2,vibRate:0.25,waveType:"sawtooth"}},
      {id:"rf_icy",     name:"ICY",       color:"#aaddff", atk:0.5,  rel:3.0, desc:"Synth froid PNL/SCH",      engine:"VAPOR",  params:{detuneCents:8, lpStart:1200,lpEnd:4000,sweepTime:1.5,vibRate:0.15,waveType:"sawtooth"}},
      {id:"rf_freeze",  name:"FREEZE",    color:"#224488", atk:1.0,  rel:4.0, desc:"Freeze Corleone dark",     engine:"VAPOR",  params:{detuneCents:15,lpStart:300, lpEnd:1200,sweepTime:2.5,vibRate:0.08,waveType:"sine"}},
      {id:"rf_sch",     name:"SCH",       color:"#330011", atk:0.1,  rel:2.0, desc:"Psychose SCH",             engine:"SCIFI",  params:{modRatio:1.5, modIndex:8,  lfoFreq:0.15,lpQ:3,  lfoDepth:5}},
      {id:"rf_nekfeu",  name:"NEKFEU",    color:"#4488cc", atk:0.05, rel:1.5, desc:"Conscious rap chill",      engine:"VAPOR",  params:{detuneCents:5, lpStart:1000,lpEnd:3500,sweepTime:1.5,vibRate:0.20,waveType:"triangle"}},
      {id:"rf_booba",   name:"BOOBA",     color:"#222288", atk:0.01, rel:1.0, desc:"Trap agressif Booba",      engine:"SCIFI",  params:{modRatio:2.0, modIndex:6,  lfoFreq:0.8, lpQ:5,  lfoDepth:4}},
      {id:"rf_church",  name:"ÉGLISE",    color:"#888866", atk:0.1,  rel:3.5, desc:"Cloche d'église",          engine:"VAPOR",  params:{detuneCents:2, lpStart:3000,lpEnd:8000,sweepTime:0.5,vibRate:0.05,waveType:"sine"}},
      {id:"rf_night",   name:"NUIT",      color:"#112244", atk:0.8,  rel:3.0, desc:"Nuit parisienne",          engine:"VAPOR",  params:{detuneCents:7, lpStart:400, lpEnd:1800,sweepTime:2.0,vibRate:0.12,waveType:"sine"}},
      {id:"rf_rain",    name:"PLUIE",     color:"#88aacc", atk:1.5,  rel:4.0, desc:"Pluie dans la cité",       engine:"VAPOR",  params:{detuneCents:18,lpStart:200, lpEnd:700, sweepTime:3.5,vibRate:0.08,waveType:"sine"}},
      {id:"rf_trap808", name:"808 FR",    color:"#ff3300", atk:0.005,rel:2.5, desc:"808 trap français",        engine:"BASS808",params:{slideFrom:2.0, slideDur:0.08,distAmount:2.5,slideTarget:1.0,subMix:0}},
      {id:"rf_bass_fr", name:"BASS FR",   color:"#cc2200", atk:0.005,rel:2.0, desc:"Basse trap FR",            engine:"BASS808",params:{slideFrom:1.8, slideDur:0.06,distAmount:3.0,slideTarget:0.95,subMix:0}},
      {id:"rf_organ",   name:"ORGUE",     color:"#664422", atk:0.02, rel:1.5, desc:"Orgue sombre",             engine:"VAPOR",  params:{detuneCents:4, lpStart:500, lpEnd:2000,sweepTime:1.0,vibRate:0.40,waveType:"sawtooth"}},
      {id:"rf_dark_pad",name:"DARK PAD",   color:"#1a0033", atk:1.0,  rel:4.0, desc:"Pad atmosphérique sombre", engine:"VAPOR",  params:{detuneCents:20,lpStart:150, lpEnd:600, sweepTime:3.0,vibRate:0.05,waveType:"sine"}},
      {id:"rf_soul",    name:"SOUL",      color:"#885533", atk:0.1,  rel:2.0, desc:"Sample soul chaud",        engine:"VAPOR",  params:{detuneCents:6, lpStart:800, lpEnd:2800,sweepTime:1.2,vibRate:0.30,waveType:"triangle"}},
      {id:"rf_guitar",  name:"GUITARE",   color:"#cc8833", atk:0.005,rel:1.0, desc:"Guitare classique douce",  engine:"VAPOR",  params:{detuneCents:2, lpStart:3000,lpEnd:7000,sweepTime:0.4,vibRate:0.15,waveType:"triangle"}},
      {id:"rf_brass",   name:"CUIVRES",   color:"#cc9900", atk:0.1,  rel:1.2, desc:"Stab cuivres orchestral",  engine:"VAPOR",  params:{detuneCents:8, lpStart:1500,lpEnd:5000,sweepTime:0.5,vibRate:0.28,waveType:"sawtooth"}},
      {id:"rf_drama",   name:"DRAMA",     color:"#8800cc", atk:0.4,  rel:3.0, desc:"Drame cinématique",        engine:"VAPOR",  params:{detuneCents:12,lpStart:600, lpEnd:3000,sweepTime:1.5,vibRate:0.18,waveType:"sawtooth"}},
      {id:"rf_fog",     name:"BROUILLARD",color:"#aabbcc", atk:2.0,  rel:5.0, desc:"Brouillard du soir",       engine:"VAPOR",  params:{detuneCents:22,lpStart:150, lpEnd:600, sweepTime:4.0,vibRate:0.06,waveType:"sine"}},
      {id:"rf_clock",   name:"HORLOGE",   color:"#887755", atk:0.001,rel:1.5, desc:"Carillon mystérieux",      engine:"SCIFI",  params:{modRatio:4.0, modIndex:1.5,lfoFreq:0.1, lpQ:6,  lfoDepth:2}},
      {id:"rf_ambi",    name:"AMBIANCE",  color:"#445566", atk:1.5,  rel:4.5, desc:"Ambiance cité nocturne",   engine:"VAPOR",  params:{detuneCents:10,lpStart:300, lpEnd:1500,sweepTime:2.5,vibRate:0.10,waveType:"sawtooth"}},
      {id:"rf_jul",     name:"JUL",       color:"#ffcc00", atk:0.05, rel:1.0, desc:"Énergie marseillaise",     engine:"SCIFI",  params:{modRatio:3.0, modIndex:3,  lfoFreq:1.5, lpQ:5,  lfoDepth:3}},
    ]
  },
  SCIFI: {
    label:"🚀 SCI-FI", color:"#00e5ff",
    presets:[
      {id:"sf_laser",     name:"LASER",      color:"#00ffff", atk:0.001,rel:0.5, desc:"Rayon laser", engine:"SCIFI", params:{modRatio:7,   modIndex:8,  lfoFreq:3.0, lpQ:8,  lfoDepth:5}},
      {id:"sf_hyper",     name:"HYPERSPACE", color:"#0088ff", atk:0.3,  rel:2.5, desc:"Saut hyperspatial", engine:"SCIFI", params:{modRatio:2,   modIndex:12, lfoFreq:0.1, lpQ:3,  lfoDepth:8}},
      {id:"sf_android",   name:"ANDROID",    color:"#44ffcc", atk:0.02, rel:1.0, desc:"Voix androïde", engine:"SCIFI", params:{modRatio:3.5, modIndex:3,  lfoFreq:0.8, lpQ:5,  lfoDepth:3}},
      {id:"sf_plasma",    name:"PLASMA",     color:"#ff44ff", atk:0.001,rel:0.7, desc:"Canon plasma", engine:"SCIFI", params:{modRatio:5,   modIndex:6,  lfoFreq:4.0, lpQ:9,  lfoDepth:6}},
      {id:"sf_void",      name:"VOID",       color:"#220033", atk:0.5,  rel:3.0, desc:"Vide cosmique", engine:"SCIFI", params:{modRatio:1.5, modIndex:15, lfoFreq:0.05,lpQ:2,  lfoDepth:12}},
      {id:"sf_wormhole",  name:"WORMHOLE",   color:"#6600cc", atk:0.1,  rel:2.0, desc:"Trou de ver", engine:"SCIFI", params:{modRatio:0.5, modIndex:4,  lfoFreq:0.3, lpQ:4,  lfoDepth:2}},
      {id:"sf_cyber",     name:"CYBERPUNK",  color:"#ff0066", atk:0.005,rel:0.8, desc:"Neon cyberpunk", engine:"SCIFI", params:{modRatio:4,   modIndex:5,  lfoFreq:2.0, lpQ:7,  lfoDepth:4}},
      {id:"sf_matrix",    name:"MATRIX",     color:"#00ff44", atk:0.001,rel:0.6, desc:"Code numérique", engine:"SCIFI", params:{modRatio:7.1, modIndex:3,  lfoFreq:1.5, lpQ:6,  lfoDepth:3}},
      {id:"sf_ion",       name:"ION",        color:"#88ccff", atk:0.01, rel:1.2, desc:"Propulsion ionique", engine:"SCIFI", params:{modRatio:2.5, modIndex:8,  lfoFreq:0.6, lpQ:5,  lfoDepth:5}},
      {id:"sf_quantum",   name:"QUANTUM",    color:"#aaffee", atk:0.2,  rel:1.8, desc:"Superposition quantique", engine:"SCIFI", params:{modRatio:3,   modIndex:10, lfoFreq:0.4, lpQ:4,  lfoDepth:7}},
      {id:"sf_singul",    name:"SINGULARITY",color:"#ff8800", atk:1.0,  rel:3.5, desc:"Singularité", engine:"SCIFI", params:{modRatio:0.25,modIndex:6,  lfoFreq:0.02,lpQ:1,  lfoDepth:4}},
      {id:"sf_nebula",    name:"NEBULA",     color:"#cc44ff", atk:0.6,  rel:3.0, desc:"Nébuleuse", engine:"SCIFI", params:{modRatio:1.01,modIndex:20, lfoFreq:0.15,lpQ:2,  lfoDepth:10}},
      {id:"sf_galactic",  name:"GALACTIC",   color:"#4444ff", atk:0.1,  rel:2.2, desc:"Galaxie lointaine", engine:"SCIFI", params:{modRatio:6,   modIndex:4,  lfoFreq:0.25,lpQ:4,  lfoDepth:3}},
      {id:"sf_binary",    name:"BINARY",     color:"#ffffff", atk:0.001,rel:0.4, desc:"Code binaire", engine:"SCIFI", params:{modRatio:8,   modIndex:2,  lfoFreq:5.0, lpQ:10, lfoDepth:4}},
      {id:"sf_electron",  name:"ELECTRON",   color:"#ffff00", atk:0.001,rel:0.6, desc:"Électron libre", engine:"SCIFI", params:{modRatio:5.5, modIndex:7,  lfoFreq:3.5, lpQ:8,  lfoDepth:5}},
      {id:"sf_cosmos",    name:"COSMOS",     color:"#000088", atk:0.8,  rel:4.0, desc:"Cosmos infini", engine:"SCIFI", params:{modRatio:2,   modIndex:5,  lfoFreq:0.08,lpQ:2,  lfoDepth:6}},
      {id:"sf_photon",    name:"PHOTON",     color:"#ffffcc", atk:0.001,rel:0.3, desc:"Vitesse lumière", engine:"SCIFI", params:{modRatio:10,  modIndex:3,  lfoFreq:6.0, lpQ:12, lfoDepth:6}},
      {id:"sf_neutron",   name:"NEUTRON",    color:"#888888", atk:0.05, rel:1.5, desc:"Étoile à neutrons", engine:"SCIFI", params:{modRatio:1.5, modIndex:8,  lfoFreq:0.7, lpQ:6,  lfoDepth:4}},
      {id:"sf_quasar",    name:"QUASAR",     color:"#ff6600", atk:0.3,  rel:2.8, desc:"Quasar brillant", engine:"SCIFI", params:{modRatio:4.5, modIndex:9,  lfoFreq:0.2, lpQ:5,  lfoDepth:7}},
      {id:"sf_reactor",   name:"REACTOR",    color:"#00ff00", atk:0.02, rel:1.0, desc:"Réacteur nucléaire", engine:"SCIFI", params:{modRatio:7,   modIndex:5,  lfoFreq:1.2, lpQ:14, lfoDepth:5}},
      {id:"sf_warp",      name:"WARP",       color:"#88ffff", atk:0.001,rel:0.9, desc:"Warp drive", engine:"SCIFI", params:{modRatio:2.8, modIndex:7,  lfoFreq:2.5, lpQ:7,  lfoDepth:5}},
      {id:"sf_starfield", name:"STARFIELD",  color:"#ccccff", atk:0.4,  rel:3.5, desc:"Champ d'étoiles", engine:"SCIFI", params:{modRatio:3.7, modIndex:4,  lfoFreq:0.12,lpQ:3,  lfoDepth:3}},
      {id:"sf_darkmatter",name:"DARK MATTER",color:"#111133", atk:1.5,  rel:4.0, desc:"Matière noire", engine:"SCIFI", params:{modRatio:1.2, modIndex:12, lfoFreq:0.03,lpQ:1,  lfoDepth:9}},
      {id:"sf_pulsar",    name:"PULSAR",     color:"#ff00aa", atk:0.001,rel:0.8, desc:"Pulsar rythmique", engine:"SCIFI", params:{modRatio:9,   modIndex:4,  lfoFreq:8.0, lpQ:10, lfoDepth:5}},
      {id:"sf_tachyon",   name:"TACHYON",    color:"#ff4444", atk:0.001,rel:0.4, desc:"Particule supraluminique", engine:"SCIFI", params:{modRatio:12,  modIndex:2,  lfoFreq:10,  lpQ:15, lfoDepth:7}},
    ]
  },
  VIKINGS: {
    label:"⚔️ VIKINGS", color:"#8b4513",
    presets:[
      {id:"vk_odin",      name:"ODIN",       color:"#2244aa", atk:0.1,  rel:2.0, desc:"Père des dieux", engine:"VIKINGS", params:{detuneCents:20,subGain:0.50,lpFreq:280,saturation:3.0,waves:3}},
      {id:"vk_thor",      name:"THOR",       color:"#4488ff", atk:0.02, rel:1.2, desc:"Dieu du tonnerre", engine:"VIKINGS", params:{detuneCents:12,subGain:0.40,lpFreq:500,saturation:2.5,waves:3}},
      {id:"vk_valhalla",  name:"VALHALLA",   color:"#ffcc44", atk:0.3,  rel:2.5, desc:"Salle des héros", engine:"VIKINGS", params:{detuneCents:25,subGain:0.45,lpFreq:200,saturation:2.0,waves:3}},
      {id:"vk_berserk",   name:"BERSERKER",  color:"#cc2200", atk:0.001,rel:0.8, desc:"Guerrier frénétique", engine:"VIKINGS", params:{detuneCents:10,subGain:0.30,lpFreq:600,saturation:4.0,waves:3}},
      {id:"vk_longship",  name:"LONGSHIP",   color:"#8888aa", atk:0.15, rel:1.5, desc:"Navire viking", engine:"VIKINGS", params:{detuneCents:15,subGain:0.35,lpFreq:400,saturation:2.0,waves:3}},
      {id:"vk_mjolnir",   name:"MJOLNIR",    color:"#aaaacc", atk:0.001,rel:0.9, desc:"Marteau de Thor", engine:"VIKINGS", params:{detuneCents:8, subGain:0.55,lpFreq:350,saturation:3.5,waves:3}},
      {id:"vk_rune",      name:"RUNE",       color:"#884422", atk:0.08, rel:1.8, desc:"Rune ancienne", engine:"VIKINGS", params:{detuneCents:5, subGain:0.30,lpFreq:800,saturation:1.5,waves:2}},
      {id:"vk_glacier",   name:"GLACIER",    color:"#aaddff", atk:0.6,  rel:3.0, desc:"Glacier nordique", engine:"VIKINGS", params:{detuneCents:30,subGain:0.60,lpFreq:180,saturation:1.5,waves:3}},
      {id:"vk_elder",     name:"ELDER",      color:"#886644", atk:0.2,  rel:2.0, desc:"Ancien sage", engine:"VIKINGS", params:{detuneCents:8, subGain:0.40,lpFreq:300,saturation:1.8,waves:3}},
      {id:"vk_saga",      name:"SAGA",       color:"#cc9944", atk:0.1,  rel:1.5, desc:"Épopée nordique", engine:"VIKINGS", params:{detuneCents:12,subGain:0.35,lpFreq:500,saturation:2.2,waves:3}},
      {id:"vk_frost",     name:"FROST",      color:"#cceeff", atk:0.3,  rel:2.2, desc:"Froid glacial", engine:"VIKINGS", params:{detuneCents:18,subGain:0.20,lpFreq:200,saturation:1.2,waves:3}},
      {id:"vk_wolf",      name:"WOLF",       color:"#666666", atk:0.01, rel:1.0, desc:"Loup des glaces", engine:"VIKINGS", params:{detuneCents:14,subGain:0.45,lpFreq:400,saturation:3.5,waves:3}},
      {id:"vk_raven",     name:"RAVEN",      color:"#222222", atk:0.05, rel:1.5, desc:"Corbeau d'Odin", engine:"VIKINGS", params:{detuneCents:10,subGain:0.30,lpFreq:250,saturation:2.5,waves:2}},
      {id:"vk_shield",    name:"SHIELD",     color:"#8888cc", atk:0.02, rel:1.0, desc:"Bouclier de guerre", engine:"VIKINGS", params:{detuneCents:6, subGain:0.35,lpFreq:450,saturation:2.8,waves:3}},
      {id:"vk_horn",      name:"HORN",       color:"#cc8844", atk:0.15, rel:1.8, desc:"Cor de guerre", engine:"VIKINGS", params:{detuneCents:8, subGain:0.50,lpFreq:500,saturation:1.8,waves:2}},
      {id:"vk_blood",     name:"BLOODLUST",  color:"#880000", atk:0.001,rel:0.6, desc:"Soif de combat", engine:"VIKINGS", params:{detuneCents:10,subGain:0.20,lpFreq:600,saturation:5.0,waves:3}},
      {id:"vk_yggdrasil", name:"YGGDRASIL",  color:"#226622", atk:0.5,  rel:3.5, desc:"Arbre du monde", engine:"VIKINGS", params:{detuneCents:22,subGain:0.45,lpFreq:400,saturation:2.0,waves:3}},
      {id:"vk_iron",      name:"IRON",       color:"#888888", atk:0.001,rel:0.7, desc:"Fer forgé", engine:"VIKINGS", params:{detuneCents:5, subGain:0.30,lpFreq:500,saturation:6.0,waves:3}},
      {id:"vk_valkyrie",  name:"VALKYRIE",   color:"#ffaacc", atk:0.1,  rel:1.5, desc:"Valkyrie guerrière", engine:"VIKINGS", params:{detuneCents:8, subGain:0.20,lpFreq:800,saturation:1.5,waves:2}},
      {id:"vk_mead",      name:"MEAD",       color:"#ddaa22", atk:0.12, rel:1.8, desc:"Hydromel festif", engine:"VIKINGS", params:{detuneCents:10,subGain:0.45,lpFreq:600,saturation:2.0,waves:3}},
      {id:"vk_conquest",  name:"CONQUEST",   color:"#ff2200", atk:0.001,rel:0.5, desc:"Conquête absolue", engine:"VIKINGS", params:{detuneCents:15,subGain:0.25,lpFreq:700,saturation:7.0,waves:3}},
    ]
  },
  GYM: {
    label:"💪 GYM", color:"#ff6600",
    presets:[
      {id:"gy_pump",      name:"PUMP",       color:"#ff4400", atk:0.001,rel:0.5, desc:"Pompe maximale", engine:"GYM", params:{waveType:"square",  clipAmount:0.70,boostFreq:2000,boostGain:8, subMix:0.2}},
      {id:"gy_crunch",    name:"CRUNCH",     color:"#cc3300", atk:0.001,rel:0.4, desc:"Crunch agressif", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.60,boostFreq:1800,boostGain:10,subMix:0}},
      {id:"gy_beast",     name:"BEAST",      color:"#880000", atk:0.002,rel:0.6, desc:"Mode bête", engine:"GYM", params:{waveType:"square",  clipAmount:0.50,boostFreq:2500,boostGain:12,subMix:0.3}},
      {id:"gy_sweat",     name:"SWEAT",      color:"#ff8844", atk:0.001,rel:0.4, desc:"Effort maximal", engine:"GYM", params:{waveType:"square",  clipAmount:0.80,boostFreq:1500,boostGain:6, subMix:0.1}},
      {id:"gy_iron",      name:"IRON",       color:"#666666", atk:0.001,rel:0.5, desc:"Métal pur", engine:"GYM", params:{waveType:"square",  clipAmount:0.55,boostFreq:3000,boostGain:8, subMix:0}},
      {id:"gy_prework",   name:"PREWORK",    color:"#ff0000", atk:0.001,rel:0.3, desc:"Pré-workout", engine:"GYM", params:{waveType:"square",  clipAmount:0.40,boostFreq:3500,boostGain:14,subMix:0}},
      {id:"gy_arena",     name:"ARENA",      color:"#ffaa00", atk:0.005,rel:0.7, desc:"Arène de combat", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.65,boostFreq:2200,boostGain:9, subMix:0.25}},
      {id:"gy_titan",     name:"TITAN",      color:"#aa4400", atk:0.01, rel:0.8, desc:"Titan invincible", engine:"GYM", params:{waveType:"square",  clipAmount:0.45,boostFreq:1200,boostGain:10,subMix:0.4}},
      {id:"gy_warrior",   name:"WARRIOR",    color:"#cc2200", atk:0.001,rel:0.5, desc:"Guerrier acharné", engine:"GYM", params:{waveType:"square",  clipAmount:0.60,boostFreq:2800,boostGain:10,subMix:0.15}},
      {id:"gy_power",     name:"POWER",      color:"#ff6600", atk:0.001,rel:0.6, desc:"Puissance brute", engine:"GYM", params:{waveType:"square",  clipAmount:0.75,boostFreq:1600,boostGain:7, subMix:0.3}},
      {id:"gy_rush",      name:"RUSH",       color:"#ff2244", atk:0.001,rel:0.3, desc:"Rush d'adrénaline", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.50,boostFreq:4000,boostGain:12,subMix:0}},
      {id:"gy_grind",     name:"GRIND",      color:"#884422", atk:0.002,rel:0.5, desc:"Mouture intense", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.60,boostFreq:2600,boostGain:9, subMix:0}},
      {id:"gy_fury",      name:"FURY",       color:"#ff0044", atk:0.001,rel:0.4, desc:"Furie incontrôlable", engine:"GYM", params:{waveType:"square",  clipAmount:0.35,boostFreq:3200,boostGain:15,subMix:0}},
      {id:"gy_strength",  name:"STRENGTH",   color:"#884400", atk:0.01, rel:1.0, desc:"Force maximale", engine:"GYM", params:{waveType:"square",  clipAmount:0.55,boostFreq:1000,boostGain:8, subMix:0.5}},
      {id:"gy_reps",      name:"REPS",       color:"#ff8800", atk:0.001,rel:0.4, desc:"Répétitions", engine:"GYM", params:{waveType:"square",  clipAmount:0.70,boostFreq:2000,boostGain:10,subMix:0.1}},
      {id:"gy_gains",     name:"GAINS",      color:"#ffcc00", atk:0.005,rel:0.6, desc:"Prise de masse", engine:"GYM", params:{waveType:"square",  clipAmount:0.65,boostFreq:800, boostGain:8, subMix:0.6}},
      {id:"gy_core",      name:"CORE",       color:"#cc6600", atk:0.001,rel:0.5, desc:"Gainage central", engine:"GYM", params:{waveType:"square",  clipAmount:0.60,boostFreq:1800,boostGain:9, subMix:0.2}},
      {id:"gy_endure",    name:"ENDURANCE",  color:"#886644", atk:0.05, rel:1.5, desc:"Endurance longue", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.65,boostFreq:1500,boostGain:7, subMix:0.2}},
      {id:"gy_tempo",     name:"TEMPO",      color:"#ff6633", atk:0.001,rel:0.4, desc:"Rythme de travail", engine:"GYM", params:{waveType:"square",  clipAmount:0.70,boostFreq:2400,boostGain:8, subMix:0.1}},
      {id:"gy_flex",      name:"FLEX",       color:"#ff9900", atk:0.001,rel:0.3, desc:"Contraction", engine:"GYM", params:{waveType:"square",  clipAmount:0.45,boostFreq:3800,boostGain:12,subMix:0}},
      {id:"gy_peak",      name:"PEAK",       color:"#ff3300", atk:0.001,rel:0.4, desc:"Pic d'intensité", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.55,boostFreq:2000,boostGain:11,subMix:0}},
      {id:"gy_hustle",    name:"HUSTLE",     color:"#cc4400", atk:0.001,rel:0.5, desc:"Effort continu", engine:"GYM", params:{waveType:"square",  clipAmount:0.60,boostFreq:2200,boostGain:9, subMix:0.15}},
      {id:"gy_grind2",    name:"GRIND II",   color:"#882200", atk:0.001,rel:0.4, desc:"Deuxième souffle", engine:"GYM", params:{waveType:"square",  clipAmount:0.50,boostFreq:2800,boostGain:11,subMix:0}},
      {id:"gy_champ",     name:"CHAMPION",   color:"#ffdd00", atk:0.01, rel:0.8, desc:"Champion du monde", engine:"GYM", params:{waveType:"sawtooth", clipAmount:0.65,boostFreq:1600,boostGain:8, subMix:0.35}},
      {id:"gy_overdrive", name:"OVERDRIVE",  color:"#ff0000", atk:0.001,rel:0.3, desc:"Surrégime total", engine:"GYM", params:{waveType:"square",  clipAmount:0.30,boostFreq:4500,boostGain:18,subMix:0}},
    ]
  },
  BASS808: {
    label:"🥁 808",  color:"#ff3300",
    presets:[
      {id:"b8_atlanta",  name:"ATLANTA",    color:"#ff2200", atk:0.005,rel:2.5, desc:"808 ATL classique",       engine:"BASS808", params:{slideFrom:2.2, slideDur:0.06, distAmount:2.5, slideTarget:1.0,subMix:0}},
      {id:"b8_houston",  name:"HOUSTON",    color:"#ee3300", atk:0.005,rel:3.0, desc:"808 Houston long",        engine:"BASS808", params:{slideFrom:2.5, slideDur:0.10, distAmount:2.0, slideTarget:1.0,subMix:0}},
      {id:"b8_memphis",  name:"MEMPHIS",    color:"#cc2200", atk:0.005,rel:2.8, desc:"808 Memphis sombre",      engine:"BASS808", params:{slideFrom:1.8, slideDur:0.07, distAmount:3.5, slideTarget:0.9,subMix:0}},
      {id:"b8_chicago",  name:"CHICAGO",    color:"#ff4400", atk:0.005,rel:2.0, desc:"808 Chicago rapide",      engine:"BASS808", params:{slideFrom:3.0, slideDur:0.04, distAmount:2.0, slideTarget:1.0,subMix:0}},
      {id:"b8_detroit",  name:"DETROIT",    color:"#aa1100", atk:0.005,rel:2.2, desc:"808 Detroit dur",         engine:"BASS808", params:{slideFrom:2.0, slideDur:0.06, distAmount:4.5, slideTarget:1.0,subMix:0}},
      {id:"b8_london",   name:"LONDON",     color:"#8888aa", atk:0.005,rel:2.0, desc:"808 UK variation",        engine:"BASS808", params:{slideFrom:2.0, slideDur:0.08, distAmount:2.0, slideTarget:1.1,subMix:0}},
      {id:"b8_paris",    name:"PARIS",      color:"#aaaacc", atk:0.005,rel:2.5, desc:"808 Paris épuré",         engine:"BASS808", params:{slideFrom:1.5, slideDur:0.09, distAmount:1.5, slideTarget:1.0,subMix:0}},
      {id:"b8_tokyo",    name:"TOKYO",      color:"#ff4488", atk:0.005,rel:1.8, desc:"808 Tokyo précis",        engine:"BASS808", params:{slideFrom:2.8, slideDur:0.03, distAmount:2.2, slideTarget:1.0,subMix:0}},
      {id:"b8_cloud",    name:"CLOUD",      color:"#aaccff", atk:0.005,rel:4.5, desc:"808 long cloud rap",      engine:"BASS808", params:{slideFrom:2.0, slideDur:0.12, distAmount:2.0, slideTarget:0.98,subMix:0}},
      {id:"b8_dark",     name:"DARK",       color:"#330011", atk:0.005,rel:3.0, desc:"808 très sombre",         engine:"BASS808", params:{slideFrom:1.6, slideDur:0.08, distAmount:5.0, slideTarget:0.85,subMix:0}},
      {id:"b8_bright",   name:"BRIGHT",     color:"#ff8844", atk:0.005,rel:2.0, desc:"808 cible haute",         engine:"BASS808", params:{slideFrom:2.0, slideDur:0.06, distAmount:1.8, slideTarget:1.15,subMix:0}},
      {id:"b8_fat",      name:"FAT",        color:"#cc4400", atk:0.005,rel:2.5, desc:"808 gras et lourd",       engine:"BASS808", params:{slideFrom:2.0, slideDur:0.08, distAmount:6.0, slideTarget:1.0, subMix:0.3}},
      {id:"b8_clean",    name:"CLEAN",      color:"#ffffff", atk:0.005,rel:2.0, desc:"808 pur sans distorsion", engine:"BASS808", params:{slideFrom:2.0, slideDur:0.07, distAmount:0.8, slideTarget:1.0,subMix:0}},
      {id:"b8_trap_a",   name:"TRAP A",     color:"#ff2233", atk:0.005,rel:2.2, desc:"808 trap standard",       engine:"BASS808", params:{slideFrom:2.1, slideDur:0.07, distAmount:2.5, slideTarget:1.0,subMix:0}},
      {id:"b8_trap_b",   name:"TRAP B",     color:"#ee1122", atk:0.005,rel:2.8, desc:"808 trap long",           engine:"BASS808", params:{slideFrom:2.4, slideDur:0.09, distAmount:2.8, slideTarget:0.95,subMix:0}},
      {id:"b8_trap_c",   name:"TRAP C",     color:"#dd0011", atk:0.005,rel:1.8, desc:"808 trap court",          engine:"BASS808", params:{slideFrom:3.2, slideDur:0.05, distAmount:2.2, slideTarget:1.0,subMix:0}},
      {id:"b8_trap_d",   name:"TRAP D",     color:"#cc0000", atk:0.005,rel:3.2, desc:"808 trap cloud",          engine:"BASS808", params:{slideFrom:1.9, slideDur:0.11, distAmount:2.0, slideTarget:0.92,subMix:0}},
      {id:"b8_trap_e",   name:"TRAP E",     color:"#bb1111", atk:0.005,rel:2.4, desc:"808 trap disto",          engine:"BASS808", params:{slideFrom:2.3, slideDur:0.06, distAmount:4.0, slideTarget:1.0,subMix:0}},
      {id:"b8_trap_f",   name:"TRAP F",     color:"#aa2222", atk:0.005,rel:2.0, desc:"808 trap bright",         engine:"BASS808", params:{slideFrom:2.6, slideDur:0.05, distAmount:1.8, slideTarget:1.1,subMix:0}},
      {id:"b8_trap_g",   name:"TRAP G",     color:"#993333", atk:0.005,rel:3.5, desc:"808 trap mega long",      engine:"BASS808", params:{slideFrom:2.0, slideDur:0.14, distAmount:2.5, slideTarget:0.88,subMix:0}},
      {id:"b8_trap_h",   name:"TRAP H",     color:"#884444", atk:0.005,rel:2.2, desc:"808 trap sub heavy",      engine:"BASS808", params:{slideFrom:2.0, slideDur:0.07, distAmount:2.5, slideTarget:1.0, subMix:0.5}},
      {id:"b8_trap_i",   name:"TRAP I",     color:"#774455", atk:0.005,rel:2.0, desc:"808 trap punchy",         engine:"BASS808", params:{slideFrom:4.0, slideDur:0.04, distAmount:3.0, slideTarget:1.0,subMix:0}},
      {id:"b8_trap_j",   name:"TRAP J",     color:"#664466", atk:0.005,rel:2.5, desc:"808 trap mellow",         engine:"BASS808", params:{slideFrom:1.4, slideDur:0.10, distAmount:1.5, slideTarget:0.97,subMix:0}},
      {id:"b8_bounce",   name:"BOUNCE",     color:"#ff6644", atk:0.005,rel:1.5, desc:"808 bounce",              engine:"BASS808", params:{slideFrom:3.5, slideDur:0.03, distAmount:2.5, slideTarget:1.05,subMix:0}},
      {id:"b8_slap",     name:"SLAP",       color:"#ff4422", atk:0.005,rel:1.2, desc:"808 slap court",          engine:"BASS808", params:{slideFrom:5.0, slideDur:0.02, distAmount:3.0, slideTarget:1.0,subMix:0}},
    ]
  },
  VAPOR: {
    label:"🌆 VAPOR", color:"#ff44cc",
    presets:[
      {id:"vp_mall",     name:"MALL",       color:"#ff88dd", atk:1.0, rel:3.0, desc:"Mallsoft classic",     engine:"VAPOR", params:{detuneCents:8, lpStart:600, lpEnd:2500,sweepTime:1.5,vibRate:0.25,waveType:"sawtooth"}},
      {id:"vp_sunset",   name:"SUNSET",     color:"#ff8844", atk:1.2, rel:3.5, desc:"Coucher de soleil",    engine:"VAPOR", params:{detuneCents:6, lpStart:800, lpEnd:3000,sweepTime:2.0,vibRate:0.20,waveType:"sawtooth"}},
      {id:"vp_neon",     name:"NEON",       color:"#ff00ff", atk:0.5, rel:2.5, desc:"Néons urbains",        engine:"VAPOR", params:{detuneCents:10,lpStart:1200,lpEnd:4000,sweepTime:1.0,vibRate:0.35,waveType:"sawtooth"}},
      {id:"vp_city",     name:"CITY",       color:"#8844ff", atk:0.8, rel:2.8, desc:"Nuit urbaine",         engine:"VAPOR", params:{detuneCents:12,lpStart:500, lpEnd:2000,sweepTime:1.8,vibRate:0.18,waveType:"sawtooth"}},
      {id:"vp_dream",    name:"DREAM",      color:"#aa88ff", atk:1.5, rel:4.0, desc:"Rêve éveillé",         engine:"VAPOR", params:{detuneCents:5, lpStart:400, lpEnd:1500,sweepTime:2.5,vibRate:0.15,waveType:"triangle"}},
      {id:"vp_retro",    name:"RETRO",      color:"#ff4488", atk:0.6, rel:2.5, desc:"Nostalgie 80s",        engine:"VAPOR", params:{detuneCents:9, lpStart:700, lpEnd:2800,sweepTime:1.2,vibRate:0.30,waveType:"sawtooth"}},
      {id:"vp_tape",     name:"TAPE",       color:"#cc8844", atk:0.4, rel:2.0, desc:"Cassette lo-fi",       engine:"VAPOR", params:{detuneCents:15,lpStart:500, lpEnd:1800,sweepTime:1.5,vibRate:0.40,waveType:"sawtooth"}},
      {id:"vp_float",    name:"FLOAT",      color:"#88ccff", atk:2.0, rel:4.5, desc:"Flottement",           engine:"VAPOR", params:{detuneCents:4, lpStart:300, lpEnd:1200,sweepTime:3.0,vibRate:0.12,waveType:"sine"}},
      {id:"vp_gloss",    name:"GLOSS",      color:"#ffccee", atk:0.3, rel:2.0, desc:"Brillant synthétique", engine:"VAPOR", params:{detuneCents:7, lpStart:1500,lpEnd:5000,sweepTime:0.8,vibRate:0.28,waveType:"sawtooth"}},
      {id:"vp_pink",     name:"PINK",       color:"#ff88bb", atk:0.8, rel:3.0, desc:"Esthétique rose",      engine:"VAPOR", params:{detuneCents:6, lpStart:900, lpEnd:3200,sweepTime:1.5,vibRate:0.22,waveType:"triangle"}},
      {id:"vp_aqua",     name:"AQUA",       color:"#44ffdd", atk:1.0, rel:3.2, desc:"Eau vaporwave",        engine:"VAPOR", params:{detuneCents:8, lpStart:700, lpEnd:2600,sweepTime:1.8,vibRate:0.18,waveType:"sawtooth"}},
      {id:"vp_chrome",   name:"CHROME",     color:"#cccccc", atk:0.4, rel:2.2, desc:"Chrome métallique",    engine:"VAPOR", params:{detuneCents:5, lpStart:2000,lpEnd:6000,sweepTime:0.6,vibRate:0.32,waveType:"sawtooth"}},
      {id:"vp_prism",    name:"PRISM",      color:"#ffffff", atk:0.6, rel:2.8, desc:"Prisme de couleurs",   engine:"VAPOR", params:{detuneCents:11,lpStart:800, lpEnd:3500,sweepTime:1.3,vibRate:0.25,waveType:"sawtooth"}},
      {id:"vp_dusk",     name:"DUSK",       color:"#ff6644", atk:1.2, rel:3.8, desc:"Crépuscule",           engine:"VAPOR", params:{detuneCents:7, lpStart:400, lpEnd:1600,sweepTime:2.2,vibRate:0.16,waveType:"sawtooth"}},
      {id:"vp_dawn",     name:"DAWN",       color:"#ffeeaa", atk:1.5, rel:4.0, desc:"Aurore",               engine:"VAPOR", params:{detuneCents:5, lpStart:500, lpEnd:2000,sweepTime:2.5,vibRate:0.14,waveType:"triangle"}},
      {id:"vp_haze",     name:"HAZE",       color:"#ccbbff", atk:1.8, rel:4.5, desc:"Brume vaporeuse",      engine:"VAPOR", params:{detuneCents:14,lpStart:300, lpEnd:1100,sweepTime:3.0,vibRate:0.10,waveType:"sawtooth"}},
      {id:"vp_glow",     name:"GLOW",       color:"#ffff88", atk:0.7, rel:2.5, desc:"Lueur néon",           engine:"VAPOR", params:{detuneCents:8, lpStart:1000,lpEnd:3800,sweepTime:1.0,vibRate:0.30,waveType:"sawtooth"}},
      {id:"vp_echo",     name:"ECHO",       color:"#88aaff", atk:0.5, rel:3.5, desc:"Écho lointain",        engine:"VAPOR", params:{detuneCents:12,lpStart:600, lpEnd:2200,sweepTime:2.0,vibRate:0.20,waveType:"sawtooth"}},
      {id:"vp_mist",     name:"MIST",       color:"#ddeeff", atk:2.0, rel:5.0, desc:"Brouillard",           engine:"VAPOR", params:{detuneCents:18,lpStart:200, lpEnd:800, sweepTime:3.5,vibRate:0.08,waveType:"sine"}},
      {id:"vp_silk",     name:"SILK",       color:"#ffeeff", atk:0.6, rel:2.8, desc:"Soie veloutée",        engine:"VAPOR", params:{detuneCents:4, lpStart:800, lpEnd:2800,sweepTime:1.5,vibRate:0.22,waveType:"triangle"}},
      {id:"vp_marble",   name:"MARBLE",     color:"#eeddcc", atk:0.4, rel:2.2, desc:"Marbre texturé",       engine:"VAPOR", params:{detuneCents:6, lpStart:1200,lpEnd:4000,sweepTime:1.0,vibRate:0.28,waveType:"sawtooth"}},
      {id:"vp_cloud",    name:"CLOUD",      color:"#cceeff", atk:2.5, rel:5.0, desc:"Nuage éthéré",         engine:"VAPOR", params:{detuneCents:20,lpStart:200, lpEnd:700, sweepTime:4.0,vibRate:0.06,waveType:"sine"}},
      {id:"vp_drift",    name:"DRIFT",      color:"#aabbdd", atk:1.5, rel:4.2, desc:"Dérive lente",         engine:"VAPOR", params:{detuneCents:9, lpStart:400, lpEnd:1500,sweepTime:2.8,vibRate:0.12,waveType:"sawtooth"}},
      {id:"vp_velvet",   name:"VELVET",     color:"#cc88aa", atk:0.8, rel:3.0, desc:"Velours doux",         engine:"VAPOR", params:{detuneCents:5, lpStart:700, lpEnd:2400,sweepTime:1.6,vibRate:0.20,waveType:"triangle"}},
      {id:"vp_luxe",     name:"LUXE",       color:"#ddaa66", atk:0.5, rel:2.5, desc:"Luxe synthétique",     engine:"VAPOR", params:{detuneCents:7, lpStart:1100,lpEnd:3600,sweepTime:1.2,vibRate:0.26,waveType:"sawtooth"}},
    ]
  },
  HORROR: {
    label:"💀 HORROR", color:"#880000",
    presets:[
      {id:"ho_terror",   name:"TERROR",     color:"#ff0000", atk:0.001,rel:1.5, desc:"Terreur pure",           engine:"HORROR", params:{modRatio:1.013,driftAmount:0.025,bitSteps:8,  lpFreq:2000,lpQ:3}},
      {id:"ho_dread",    name:"DREAD",      color:"#440000", atk:1.0, rel:3.0, desc:"Angoisse profonde",       engine:"HORROR", params:{modRatio:1.007,driftAmount:0.040,bitSteps:16, lpFreq:1200,lpQ:2}},
      {id:"ho_crypt",    name:"CRYPT",      color:"#332211", atk:0.3,  rel:2.5, desc:"Crypte sombre",          engine:"HORROR", params:{modRatio:1.020,driftAmount:0.015,bitSteps:6,  lpFreq:800, lpQ:4}},
      {id:"ho_ghost",    name:"GHOST",      color:"#eeeeff", atk:0.5,  rel:3.5, desc:"Présence fantomatique",  engine:"HORROR", params:{modRatio:1.002,driftAmount:0.060,bitSteps:20, lpFreq:3000,lpQ:1}},
      {id:"ho_shadow",   name:"SHADOW",     color:"#222222", atk:0.2,  rel:2.0, desc:"Ombre menaçante",        engine:"HORROR", params:{modRatio:1.018,driftAmount:0.020,bitSteps:10, lpFreq:1500,lpQ:2}},
      {id:"ho_scream",   name:"SCREAM",     color:"#ff2200", atk:0.001,rel:0.8, desc:"Cri de terreur",         engine:"HORROR", params:{modRatio:1.050,driftAmount:0.050,bitSteps:4,  lpFreq:5000,lpQ:6}},
      {id:"ho_blood",    name:"BLOOD",      color:"#880000", atk:0.001,rel:1.2, desc:"Rouge sang",             engine:"HORROR", params:{modRatio:1.023,driftAmount:0.030,bitSteps:7,  lpFreq:1800,lpQ:3}},
      {id:"ho_curse",    name:"CURSE",      color:"#441100", atk:0.6,  rel:3.0, desc:"Malédiction ancienne",   engine:"HORROR", params:{modRatio:1.009,driftAmount:0.045,bitSteps:14, lpFreq:900, lpQ:2}},
      {id:"ho_demon",    name:"DEMON",      color:"#660000", atk:0.1,  rel:2.0, desc:"Entité démoniaque",      engine:"HORROR", params:{modRatio:1.031,driftAmount:0.035,bitSteps:5,  lpFreq:2500,lpQ:4}},
      {id:"ho_void",     name:"VOID",       color:"#000011", atk:2.0,  rel:5.0, desc:"Néant absolu",           engine:"HORROR", params:{modRatio:1.001,driftAmount:0.070,bitSteps:24, lpFreq:600, lpQ:1}},
      {id:"ho_abyss",    name:"ABYSS",      color:"#001133", atk:1.5,  rel:4.0, desc:"Abîme sans fond",        engine:"HORROR", params:{modRatio:1.004,driftAmount:0.055,bitSteps:18, lpFreq:700, lpQ:1}},
      {id:"ho_omen",     name:"OMEN",       color:"#333300", atk:0.4,  rel:2.8, desc:"Mauvais présage",        engine:"HORROR", params:{modRatio:1.015,driftAmount:0.028,bitSteps:12, lpFreq:1000,lpQ:2}},
      {id:"ho_stalk",    name:"STALK",      color:"#223300", atk:0.05, rel:1.5, desc:"Tension du prédateur",   engine:"HORROR", params:{modRatio:1.011,driftAmount:0.022,bitSteps:9,  lpFreq:1600,lpQ:3}},
      {id:"ho_creep",    name:"CREEP",      color:"#334400", atk:0.3,  rel:2.2, desc:"Rampement sinistre",     engine:"HORROR", params:{modRatio:1.017,driftAmount:0.032,bitSteps:11, lpFreq:1300,lpQ:2}},
      {id:"ho_doom",     name:"DOOM",       color:"#110000", atk:0.8,  rel:3.5, desc:"Destin inévitable",      engine:"HORROR", params:{modRatio:1.006,driftAmount:0.048,bitSteps:15, lpFreq:800, lpQ:2}},
      {id:"ho_grave",    name:"GRAVE",      color:"#444433", atk:0.5,  rel:3.0, desc:"Au-delà de la mort",     engine:"HORROR", params:{modRatio:1.014,driftAmount:0.025,bitSteps:10, lpFreq:1100,lpQ:2}},
      {id:"ho_ritual",   name:"RITUAL",     color:"#553300", atk:0.4,  rel:2.5, desc:"Rituel obscur",          engine:"HORROR", params:{modRatio:1.025,driftAmount:0.038,bitSteps:8,  lpFreq:1400,lpQ:3}},
      {id:"ho_plague",   name:"PLAGUE",     color:"#336600", atk:0.6,  rel:3.0, desc:"Peste corruptrice",      engine:"HORROR", params:{modRatio:1.019,driftAmount:0.042,bitSteps:7,  lpFreq:1000,lpQ:2}},
      {id:"ho_madness",  name:"MADNESS",    color:"#664422", atk:0.001,rel:1.0, desc:"Folie totale",           engine:"HORROR", params:{modRatio:1.055,driftAmount:0.080,bitSteps:3,  lpFreq:4000,lpQ:7}},
      {id:"ho_specter",  name:"SPECTER II", color:"#ccccdd", atk:1.0,  rel:4.0, desc:"Spectre errant",         engine:"HORROR", params:{modRatio:1.003,driftAmount:0.065,bitSteps:20, lpFreq:2500,lpQ:1}},
      {id:"ho_asylum",   name:"ASYLUM",     color:"#aaaaaa", atk:0.2,  rel:2.5, desc:"Asile psychiatrique",    engine:"HORROR", params:{modRatio:1.029,driftAmount:0.033,bitSteps:6,  lpFreq:1700,lpQ:3}},
      {id:"ho_decay",    name:"DECAY",      color:"#445522", atk:0.7,  rel:3.5, desc:"Décomposition lente",    engine:"HORROR", params:{modRatio:1.010,driftAmount:0.050,bitSteps:13, lpFreq:900, lpQ:2}},
      {id:"ho_hunt",     name:"HUNT",       color:"#334422", atk:0.05, rel:1.8, desc:"Chasse nocturne",        engine:"HORROR", params:{modRatio:1.022,driftAmount:0.028,bitSteps:9,  lpFreq:2000,lpQ:3}},
      {id:"ho_nightmare",name:"NIGHTMARE",  color:"#221133", atk:0.8,  rel:3.5, desc:"Cauchemar vivant",       engine:"HORROR", params:{modRatio:1.008,driftAmount:0.058,bitSteps:16, lpFreq:1000,lpQ:2}},
      {id:"ho_darkness", name:"DARKNESS",   color:"#000000", atk:2.0,  rel:5.0, desc:"Obscurité absolue",      engine:"HORROR", params:{modRatio:1.001,driftAmount:0.080,bitSteps:28, lpFreq:400, lpQ:1}},
    ]
  },
  SAMURAI: {
    label:"⚡ SAMURAI", color:"#c0a030",
    presets:[
      // ── PLUCK BOISÉ ───────────────────────────────────────────────────────
      {id:"sam_katana",   name:"KATANA SLASH",  color:"#c0a030", atk:0.001, rel:0.6,  engine:"SAMURAI", params:{pluckDecay:0.30, resonance:10, harmMix:0.30}, desc:"Coupure nette — acier froid"},
      {id:"sam_ronin",    name:"RONIN SPIRIT",  color:"#a08820", atk:0.001, rel:1.2,  engine:"SAMURAI", params:{pluckDecay:0.55, resonance:7,  harmMix:0.20}, desc:"Errant — résonance longue et sèche"},
      {id:"sam_bamboo",   name:"BAMBOO TRAP",   color:"#90b040", atk:0.001, rel:0.4,  engine:"SAMURAI", params:{pluckDecay:0.18, resonance:12, harmMix:0.40}, desc:"Bois creux — decay ultra court"},
      {id:"sam_shogun",   name:"SHOGUN GATE",   color:"#c86020", atk:0.001, rel:1.5,  engine:"SAMURAI", params:{pluckDecay:0.70, resonance:5,  harmMix:0.15}, desc:"Lourd et solennel — graves larges"},
      {id:"sam_zen",      name:"ZEN BLADE",     color:"#e0e0c0", atk:0.001, rel:0.9,  engine:"SAMURAI", params:{pluckDecay:0.40, resonance:8,  harmMix:0.22}, desc:"Silence avant l'impact"},
      // ── ATMOSPHÉRIQUE ─────────────────────────────────────────────────────
      {id:"sam_kyoto",    name:"KYOTO MIST",    color:"#b0c8e0", atk:0.05,  rel:2.0,  engine:"SAMURAI", params:{pluckDecay:0.80, resonance:4,  harmMix:0.10}, desc:"Brume matinale — attaque douce"},
      {id:"sam_silk",     name:"SILK & STEEL",  color:"#e8d0a0", atk:0.001, rel:1.0,  engine:"SAMURAI", params:{pluckDecay:0.45, resonance:6,  harmMix:0.35}, desc:"Douceur et tranchant mêlés"},
      {id:"sam_kabuto",   name:"KABUTO",        color:"#808060", atk:0.001, rel:0.7,  engine:"SAMURAI", params:{pluckDecay:0.28, resonance:13, harmMix:0.28}, desc:"Casque de fer — métal tendu"},
      {id:"sam_seppu",    name:"SEPPUKU LOW",   color:"#601010", atk:0.001, rel:1.8,  engine:"SAMURAI", params:{pluckDecay:0.65, resonance:5,  harmMix:0.12}, desc:"Grave solennel — honneur perdu"},
      {id:"sam_dojo",     name:"DOJO FLOOR",    color:"#a07040", atk:0.001, rel:0.5,  engine:"SAMURAI", params:{pluckDecay:0.20, resonance:11, harmMix:0.45}, desc:"Bois de tatami — sec et net"},
      // ── MÉTAL ET RÉSONANCE ────────────────────────────────────────────────
      {id:"sam_tsuba",    name:"TSUBA RING",    color:"#c0c0c0", atk:0.001, rel:1.4,  engine:"SAMURAI", params:{pluckDecay:0.60, resonance:14, harmMix:0.18}, desc:"Garde métallique — résonance aiguë"},
      {id:"sam_tanto",    name:"TANTO",         color:"#d0a060", atk:0.001, rel:0.5,  engine:"SAMURAI", params:{pluckDecay:0.22, resonance:9,  harmMix:0.50}, desc:"Lame courte — harmoniques riches"},
      {id:"sam_naginata", name:"NAGINATA",      color:"#806030", atk:0.001, rel:1.1,  engine:"SAMURAI", params:{pluckDecay:0.48, resonance:7,  harmMix:0.25}, desc:"Hampe boisée — corps chaud"},
      {id:"sam_arrow",    name:"ARROW FLIGHT",  color:"#c0d080", atk:0.001, rel:0.3,  engine:"SAMURAI", params:{pluckDecay:0.12, resonance:15, harmMix:0.60}, desc:"Décoche — decay éclair"},
      {id:"sam_drum",     name:"TAIKO HIT",     color:"#a04020", atk:0.001, rel:0.6,  engine:"SAMURAI", params:{pluckDecay:0.25, resonance:6,  harmMix:0.08}, desc:"Peau tendue — impact pur"},
      // ── NATURE / MÉDITATION ───────────────────────────────────────────────
      {id:"sam_cherry",   name:"CHERRY FALL",   color:"#f0a0b0", atk:0.03,  rel:2.5,  engine:"SAMURAI", params:{pluckDecay:0.90, resonance:3,  harmMix:0.08}, desc:"Pétale de cerisier — sustain long"},
      {id:"sam_stone",    name:"STONE GARDEN",  color:"#888878", atk:0.001, rel:0.8,  engine:"SAMURAI", params:{pluckDecay:0.35, resonance:8,  harmMix:0.32}, desc:"Gravier ratissé — méditation"},
      {id:"sam_temple",   name:"TEMPLE BELL",   color:"#d0b040", atk:0.001, rel:3.0,  engine:"SAMURAI", params:{pluckDecay:1.00, resonance:12, harmMix:0.20}, desc:"Cloche de temple — sustain infini"},
      {id:"sam_fog",      name:"WAR FOG",       color:"#808898", atk:0.02,  rel:1.5,  engine:"SAMURAI", params:{pluckDecay:0.70, resonance:4,  harmMix:0.14}, desc:"Brume de guerre — flou menaçant"},
      {id:"sam_water",    name:"WATER STRIKE",  color:"#60a0c0", atk:0.001, rel:0.7,  engine:"SAMURAI", params:{pluckDecay:0.32, resonance:10, harmMix:0.38}, desc:"Frappe liquide — clarté totale"},
      // ── TRAP / MODERN ─────────────────────────────────────────────────────
      {id:"sam_trap",     name:"NINJA TRAP",    color:"#202020", atk:0.001, rel:0.4,  engine:"SAMURAI", params:{pluckDecay:0.15, resonance:14, harmMix:0.55}, desc:"Trap japonais — ultra sec"},
      {id:"sam_koto",     name:"WAR KOTO",      color:"#e0c080", atk:0.001, rel:1.0,  engine:"SAMURAI", params:{pluckDecay:0.42, resonance:8,  harmMix:0.30}, desc:"Koto de bataille — pincé tendu"},
      {id:"sam_night",    name:"SHADOW NIGHT",  color:"#181828", atk:0.001, rel:1.3,  engine:"SAMURAI", params:{pluckDecay:0.58, resonance:6,  harmMix:0.18}, desc:"Nuit du ninja — grave furtif"},
      {id:"sam_honor",    name:"LAST HONOR",    color:"#ff4040", atk:0.001, rel:2.0,  engine:"SAMURAI", params:{pluckDecay:0.85, resonance:5,  harmMix:0.10}, desc:"Dernier combat — résonance lente"},
      {id:"sam_steel",    name:"COLD STEEL",    color:"#a8c0d0", atk:0.001, rel:0.6,  engine:"SAMURAI", params:{pluckDecay:0.26, resonance:11, harmMix:0.42}, desc:"Acier froid — attaque métallique"},
    ]
  },
  CHERNOBYL: {
    label:"☢️ CHERNOBYL", color:"#66ff00",
    presets:[
      // ── BITCRUSH SALE ─────────────────────────────────────────────────────
      {id:"che_reactor",  name:"REACTOR 4",     color:"#66ff00", atk:0.001, rel:1.2,  engine:"CHERNOBYL", params:{bitSteps:5,  noiseAmt:0.12, satAmount:3.5}, desc:"Cœur du réacteur — instable"},
      {id:"che_radleak",  name:"RAD LEAK",      color:"#aaff00", atk:0.001, rel:0.8,  engine:"CHERNOBYL", params:{bitSteps:3,  noiseAmt:0.20, satAmount:4.0}, desc:"Fuite radioactive — bitcrush extrême"},
      {id:"che_rusty",    name:"RUSTY PIPE",    color:"#a06020", atk:0.001, rel:0.6,  engine:"CHERNOBYL", params:{bitSteps:7,  noiseAmt:0.08, satAmount:2.8}, desc:"Tuyau rouillé — harmoniques sales"},
      {id:"che_geiger",   name:"GEIGER PULSE",  color:"#00ff88", atk:0.001, rel:0.3,  engine:"CHERNOBYL", params:{bitSteps:2,  noiseAmt:0.30, satAmount:5.0}, desc:"Compteur Geiger — pulses brefs"},
      {id:"che_sarco",    name:"SARCOPHAGUS",   color:"#505040", atk:0.1,   rel:2.5,  engine:"CHERNOBYL", params:{bitSteps:10, noiseAmt:0.05, satAmount:2.0}, desc:"Dalle de béton — grave étouffé"},
      // ── INDUSTRIEL ────────────────────────────────────────────────────────
      {id:"che_lead",     name:"LEAD SHIELD",   color:"#888880", atk:0.001, rel:1.0,  engine:"CHERNOBYL", params:{bitSteps:8,  noiseAmt:0.06, satAmount:2.5}, desc:"Blindage lourd — fréquences basses"},
      {id:"che_steam",    name:"STEAM VALVE",   color:"#c0c0b0", atk:0.02,  rel:0.7,  engine:"CHERNOBYL", params:{bitSteps:4,  noiseAmt:0.18, satAmount:3.8}, desc:"Soupape vapeur — sifflement sale"},
      {id:"che_liquidat", name:"LIQUIDATOR",    color:"#40d080", atk:0.001, rel:0.9,  engine:"CHERNOBYL", params:{bitSteps:6,  noiseAmt:0.14, satAmount:3.2}, desc:"Équipe de nettoyage — charge lourde"},
      {id:"che_redfor",   name:"RED FOREST",    color:"#cc2200", atk:0.05,  rel:2.0,  engine:"CHERNOBYL", params:{bitSteps:9,  noiseAmt:0.07, satAmount:2.2}, desc:"Pins rouges — radiation silencieuse"},
      {id:"che_pripyat",  name:"PRIPYAT ECHO",  color:"#90a0b0", atk:0.08,  rel:3.0,  engine:"CHERNOBYL", params:{bitSteps:11, noiseAmt:0.04, satAmount:1.8}, desc:"Ville abandonnée — résonance creuse"},
      // ── BRUIT BLANC ET TEXTURE ────────────────────────────────────────────
      {id:"che_static",   name:"STATIC NOISE",  color:"#cccccc", atk:0.001, rel:0.5,  engine:"CHERNOBYL", params:{bitSteps:2,  noiseAmt:0.35, satAmount:4.5}, desc:"Parasite pur — bruit dominant"},
      {id:"che_zoneecho",  name:"ZONE ECHO",    color:"#4488aa", atk:0.1,   rel:2.8,  engine:"CHERNOBYL", params:{bitSteps:12, noiseAmt:0.03, satAmount:1.5}, desc:"Zone exclusion — silence hanté"},
      {id:"che_glitch",   name:"GLITCH MELT",   color:"#ff8800", atk:0.001, rel:0.4,  engine:"CHERNOBYL", params:{bitSteps:2,  noiseAmt:0.25, satAmount:5.5}, desc:"Fusion données — chaos numérique"},
      {id:"che_corium",   name:"CORIUM FLOW",   color:"#ff4400", atk:0.001, rel:1.5,  engine:"CHERNOBYL", params:{bitSteps:4,  noiseAmt:0.16, satAmount:4.2}, desc:"Lave nucléaire — distorsion organique"},
      {id:"che_void",     name:"DEAD ZONE",     color:"#101018", atk:0.2,   rel:3.5,  engine:"CHERNOBYL", params:{bitSteps:14, noiseAmt:0.02, satAmount:1.2}, desc:"Zone morte — sub étouffé"},
      // ── TRAP / ÉLECTRO ────────────────────────────────────────────────────
      {id:"che_trap",     name:"NUKE TRAP",     color:"#00ffcc", atk:0.001, rel:0.7,  engine:"CHERNOBYL", params:{bitSteps:3,  noiseAmt:0.22, satAmount:4.8}, desc:"Trap nucléaire — square ultra sale"},
      {id:"che_808rad",   name:"808 RADIATION", color:"#ff0066", atk:0.001, rel:1.4,  engine:"CHERNOBYL", params:{bitSteps:5,  noiseAmt:0.10, satAmount:3.0}, desc:"808 irradié — pitch + bitcrush"},
      {id:"che_drill",    name:"DRILL MELT",    color:"#cc0044", atk:0.001, rel:0.6,  engine:"CHERNOBYL", params:{bitSteps:3,  noiseAmt:0.18, satAmount:4.5}, desc:"UK Drill — square massacré"},
      {id:"che_bunker",   name:"BUNKER SUB",    color:"#304050", atk:0.001, rel:2.0,  engine:"CHERNOBYL", params:{bitSteps:8,  noiseAmt:0.08, satAmount:2.8}, desc:"Abri nucléaire — sub épais"},
      {id:"che_fallout",  name:"FALLOUT BASS",  color:"#88aa00", atk:0.001, rel:1.1,  engine:"CHERNOBYL", params:{bitSteps:6,  noiseAmt:0.12, satAmount:3.3}, desc:"Retombées — grave contaminé"},
      // ── EXPÉRIMENTAL ──────────────────────────────────────────────────────
      {id:"che_decay",    name:"DECAY CHAIN",   color:"#446600", atk:0.001, rel:0.8,  engine:"CHERNOBYL", params:{bitSteps:4,  noiseAmt:0.20, satAmount:4.0}, desc:"Chaîne désintégration — instable"},
      {id:"che_isotope",  name:"ISOTOPE",       color:"#aaff44", atk:0.001, rel:1.0,  engine:"CHERNOBYL", params:{bitSteps:7,  noiseAmt:0.09, satAmount:2.6}, desc:"Élément instable — harmoniques brisées"},
      {id:"che_meltdown", name:"MELTDOWN",      color:"#ff6600", atk:0.001, rel:0.5,  engine:"CHERNOBYL", params:{bitSteps:1,  noiseAmt:0.40, satAmount:6.0}, desc:"Fusion totale — chaos maximal"},
      {id:"che_shelter",  name:"SHELTER 8",     color:"#607080", atk:0.05,  rel:1.8,  engine:"CHERNOBYL", params:{bitSteps:9,  noiseAmt:0.06, satAmount:2.3}, desc:"Abri n°8 — béton et rouille"},
      {id:"che_smoke",    name:"SMOKE STACK",   color:"#aaaaaa", atk:0.03,  rel:1.3,  engine:"CHERNOBYL", params:{bitSteps:5,  noiseAmt:0.15, satAmount:3.6}, desc:"Cheminée — fumée dense et sale"},
    ]
  },
  PIRATES: {
    label:"🏴‍☠️ PIRATES", color:"#e8a020",
    presets:[
      // ── ACCORDÉON / BOIS ──────────────────────────────────────────────────
      {id:"pir_blackpearl",name:"BLACK PEARL",  color:"#181818", atk:0.03,  rel:1.8,  engine:"PIRATES", params:{detuneCents:25, vibRate:4.5, vibDepth:0.014, bpQ:3.5}, desc:"Vaisseau maudit — accordéon sombre"},
      {id:"pir_rum",       name:"RUM BARREL",   color:"#a05018", atk:0.05,  rel:1.2,  engine:"PIRATES", params:{detuneCents:18, vibRate:6.0, vibDepth:0.010, bpQ:2.5}, desc:"Tonneau de rhum — chaud et ivre"},
      {id:"pir_kraken",    name:"KRAKEN DEEP",  color:"#102040", atk:0.001, rel:2.5,  engine:"PIRATES", params:{detuneCents:30, vibRate:2.5, vibDepth:0.020, bpQ:5.0}, desc:"Tentacules — sub marin profond"},
      {id:"pir_ghost",     name:"GHOST SHIP",   color:"#d0d0e8", atk:0.15,  rel:3.0,  engine:"PIRATES", params:{detuneCents:15, vibRate:3.0, vibDepth:0.018, bpQ:4.0}, desc:"Navire fantôme — vapeur froide"},
      {id:"pir_tortuga",   name:"TORTUGA NIGHT",color:"#203040", atk:0.02,  rel:1.5,  engine:"PIRATES", params:{detuneCents:20, vibRate:5.0, vibDepth:0.012, bpQ:3.0}, desc:"Port clandestin — nuit de trahison"},
      // ── ÉPIQUE ────────────────────────────────────────────────────────────
      {id:"pir_anchor",    name:"ANCHOR DROP",  color:"#606880", atk:0.001, rel:1.0,  engine:"PIRATES", params:{detuneCents:28, vibRate:7.0, vibDepth:0.008, bpQ:2.0}, desc:"Chute de l'ancre — lourd et métallique"},
      {id:"pir_davyjones", name:"DAVY JONES",   color:"#003050", atk:0.001, rel:2.8,  engine:"PIRATES", params:{detuneCents:35, vibRate:2.0, vibDepth:0.025, bpQ:5.5}, desc:"Locker de Davy Jones — abysse"},
      {id:"pir_cannon",    name:"CANNON BLAST", color:"#d04010", atk:0.001, rel:0.6,  engine:"PIRATES", params:{detuneCents:12, vibRate:8.0, vibDepth:0.006, bpQ:1.5}, desc:"Boulet de canon — impact brutal"},
      {id:"pir_jolly",     name:"JOLLY ROGER",  color:"#f0f0f0", atk:0.02,  rel:1.3,  engine:"PIRATES", params:{detuneCents:22, vibRate:5.5, vibDepth:0.013, bpQ:3.2}, desc:"Pavillon noir — menaçant et fier"},
      {id:"pir_board",     name:"PLANK WALK",   color:"#805030", atk:0.001, rel:0.8,  engine:"PIRATES", params:{detuneCents:10, vibRate:6.5, vibDepth:0.009, bpQ:2.8}, desc:"Planche — bois qui craque sur l'eau"},
      // ── ATMOSPHÉRIQUE ─────────────────────────────────────────────────────
      {id:"pir_storm",     name:"STORM SAIL",   color:"#4060a0", atk:0.08,  rel:2.2,  engine:"PIRATES", params:{detuneCents:32, vibRate:3.5, vibDepth:0.022, bpQ:4.5}, desc:"Voile déchirée — tempête rugissante"},
      {id:"pir_tavern",    name:"TAVERN SONG",  color:"#d08020", atk:0.001, rel:0.9,  engine:"PIRATES", params:{detuneCents:16, vibRate:7.5, vibDepth:0.007, bpQ:2.2}, desc:"Chanson de taverne — ivre et festif"},
      {id:"pir_fog",       name:"SEA FOG",      color:"#a0b0c0", atk:0.12,  rel:2.5,  engine:"PIRATES", params:{detuneCents:14, vibRate:2.8, vibDepth:0.016, bpQ:3.8}, desc:"Brouillard marin — vibrato lent"},
      {id:"pir_treasure",  name:"TREASURE MAP", color:"#e0c060", atk:0.001, rel:1.4,  engine:"PIRATES", params:{detuneCents:20, vibRate:4.8, vibDepth:0.011, bpQ:3.0}, desc:"Carte au trésor — mystère doré"},
      {id:"pir_coral",     name:"CORAL REEF",   color:"#ff8060", atk:0.04,  rel:2.0,  engine:"PIRATES", params:{detuneCents:8,  vibRate:5.8, vibDepth:0.010, bpQ:4.2}, desc:"Récif de corail — coloré et vibrant"},
      // ── SOMBRE / GRAVE ────────────────────────────────────────────────────
      {id:"pir_mutiny",    name:"MUTINY",       color:"#801010", atk:0.001, rel:1.6,  engine:"PIRATES", params:{detuneCents:38, vibRate:3.2, vibDepth:0.028, bpQ:5.8}, desc:"Mutinerie — tension extrême"},
      {id:"pir_depths",    name:"OCEAN DEPTHS", color:"#001830", atk:0.2,   rel:3.5,  engine:"PIRATES", params:{detuneCents:40, vibRate:1.8, vibDepth:0.030, bpQ:6.0}, desc:"Profondeurs abyssales — noir total"},
      {id:"pir_blood",     name:"BLOOD TIDE",   color:"#880020", atk:0.001, rel:1.0,  engine:"PIRATES", params:{detuneCents:26, vibRate:6.2, vibDepth:0.015, bpQ:3.8}, desc:"Marée de sang — basse agressive"},
      {id:"pir_wreck",     name:"SHIPWRECK",    color:"#604830", atk:0.001, rel:1.8,  engine:"PIRATES", params:{detuneCents:24, vibRate:4.0, vibDepth:0.018, bpQ:4.0}, desc:"Épave — bois pourri sous les flots"},
      {id:"pir_curse",     name:"SEA CURSE",    color:"#300840", atk:0.1,   rel:2.8,  engine:"PIRATES", params:{detuneCents:34, vibRate:2.2, vibDepth:0.026, bpQ:5.2}, desc:"Malédiction maritime — voix étrange"},
      // ── COMBAT ────────────────────────────────────────────────────────────
      {id:"pir_battle",    name:"BATTLE DECK",  color:"#c04000", atk:0.001, rel:0.7,  engine:"PIRATES", params:{detuneCents:12, vibRate:7.8, vibDepth:0.007, bpQ:1.8}, desc:"Pont de combat — rapide et brutal"},
      {id:"pir_buccaneer", name:"BUCCANEER",    color:"#e85020", atk:0.001, rel:0.9,  engine:"PIRATES", params:{detuneCents:18, vibRate:6.8, vibDepth:0.009, bpQ:2.4}, desc:"Flibustier — attaque vive"},
      {id:"pir_siren",     name:"SIREN CALL",   color:"#40c0e0", atk:0.06,  rel:2.2,  engine:"PIRATES", params:{detuneCents:10, vibRate:3.8, vibDepth:0.020, bpQ:4.5}, desc:"Chant de sirène — envoûtant et lent"},
      {id:"pir_galleon",   name:"GALLEON BASS", color:"#e8a020", atk:0.001, rel:1.5,  engine:"PIRATES", params:{detuneCents:22, vibRate:5.2, vibDepth:0.012, bpQ:3.0}, desc:"Galion lourd — sub boisé vibrant"},
      {id:"pir_horizon",   name:"HORIZON LINE", color:"#60a8d0", atk:0.1,   rel:2.0,  engine:"PIRATES", params:{detuneCents:16, vibRate:4.2, vibDepth:0.014, bpQ:3.5}, desc:"Horizon infini — espoir et liberté"},
    ]
  },
  TRIBAL: {
    label:"🥁 TRIBAL", color:"#cc6600",
    presets:[
      // ── PERCUSSION COURTE ─────────────────────────────────────────────────
      {id:"tri_jungle",    name:"JUNGLE FEVER",  color:"#508020", atk:0.001, rel:0.4,  engine:"TRIBAL", params:{decay:0.15, formantHz:700,  punch:5}, desc:"Fièvre jungle — attaque sèche"},
      {id:"tri_ritual",    name:"RITUAL DRUM",   color:"#802010", atk:0.001, rel:0.5,  engine:"TRIBAL", params:{decay:0.20, formantHz:500,  punch:6}, desc:"Tambour rituel — impact grave"},
      {id:"tri_shaman",    name:"SHAMAN VISION", color:"#c06000", atk:0.001, rel:0.7,  engine:"TRIBAL", params:{decay:0.30, formantHz:900,  punch:4}, desc:"Vision chamanique — résonance vocale"},
      {id:"tri_animal",    name:"ANIMAL INST",   color:"#806010", atk:0.001, rel:0.3,  engine:"TRIBAL", params:{decay:0.12, formantHz:1200, punch:7}, desc:"Instinct animal — court et primitif"},
      {id:"tri_voodoo",    name:"VOODOO PULSE",  color:"#400840", atk:0.001, rel:0.6,  engine:"TRIBAL", params:{decay:0.25, formantHz:800,  punch:5}, desc:"Pulsation vaudou — rythmique hypnotique"},
      // ── FORMANT VOCAL ─────────────────────────────────────────────────────
      {id:"tri_totem",     name:"TOTEM BASS",    color:"#a04010", atk:0.001, rel:0.9,  engine:"TRIBAL", params:{decay:0.40, formantHz:400,  punch:4}, desc:"Totem — grave et ancestral"},
      {id:"tri_ancestral", name:"ANCESTRAL",     color:"#c08030", atk:0.001, rel:1.0,  engine:"TRIBAL", params:{decay:0.45, formantHz:350,  punch:3}, desc:"Appel des ancêtres — résonance basse"},
      {id:"tri_amazon",    name:"AMAZON RAIN",   color:"#408030", atk:0.001, rel:0.5,  engine:"TRIBAL", params:{decay:0.22, formantHz:1500, punch:6}, desc:"Pluie amazonienne — aiguë et perçante"},
      {id:"tri_spirit",    name:"WAR SPIRIT",    color:"#d02020", atk:0.001, rel:0.4,  engine:"TRIBAL", params:{decay:0.14, formantHz:1100, punch:8}, desc:"Esprit guerrier — percussif et fort"},
      {id:"tri_bone",      name:"BONE RATTLE",   color:"#d0c0a0", atk:0.001, rel:0.3,  engine:"TRIBAL", params:{decay:0.10, formantHz:1800, punch:7}, desc:"Os qui s'entrechoquent — aigu sec"},
      // ── SUB ORGANIQUE ─────────────────────────────────────────────────────
      {id:"tri_earth",     name:"EARTH DRUM",    color:"#604020", atk:0.001, rel:0.8,  engine:"TRIBAL", params:{decay:0.35, formantHz:300,  punch:3}, desc:"Tambour de terre — sub organique"},
      {id:"tri_thunder",   name:"THUNDER GOD",   color:"#303060", atk:0.001, rel:1.2,  engine:"TRIBAL", params:{decay:0.55, formantHz:250,  punch:2}, desc:"Dieu tonnerre — sub grave profond"},
      {id:"tri_pulse",     name:"HEARTBEAT",     color:"#cc2020", atk:0.001, rel:0.6,  engine:"TRIBAL", params:{decay:0.26, formantHz:450,  punch:4}, desc:"Battement cardiaque — pulsation primaire"},
      {id:"tri_cave",      name:"CAVE DRUM",     color:"#504030", atk:0.001, rel:1.0,  engine:"TRIBAL", params:{decay:0.48, formantHz:380,  punch:3}, desc:"Grotte — résonance de pierre"},
      {id:"tri_low",       name:"DEEP TRIBES",   color:"#201010", atk:0.001, rel:1.5,  engine:"TRIBAL", params:{decay:0.70, formantHz:280,  punch:2}, desc:"Tribus profondes — grave maximal"},
      // ── PERCUSSIF MODERNE ─────────────────────────────────────────────────
      {id:"tri_kick",      name:"TRIBAL KICK",   color:"#ff4000", atk:0.001, rel:0.4,  engine:"TRIBAL", params:{decay:0.16, formantHz:600,  punch:6}, desc:"Kick tribal — trap moderne"},
      {id:"tri_perc",      name:"SYNTH PERC",    color:"#ff8020", atk:0.001, rel:0.2,  engine:"TRIBAL", params:{decay:0.08, formantHz:2000, punch:8}, desc:"Percussion synthétique — ultra court"},
      {id:"tri_clap",      name:"TRIBE CLAP",    color:"#e0a040", atk:0.001, rel:0.3,  engine:"TRIBAL", params:{decay:0.10, formantHz:1600, punch:7}, desc:"Clap tribal — aigu et claquant"},
      {id:"tri_stomp",     name:"WAR STOMP",     color:"#804020", atk:0.001, rel:0.5,  engine:"TRIBAL", params:{decay:0.20, formantHz:550,  punch:5}, desc:"Piétinement de guerre — lourd"},
      {id:"tri_fire",      name:"FIRE DANCE",    color:"#ff6010", atk:0.001, rel:0.4,  engine:"TRIBAL", params:{decay:0.17, formantHz:950,  punch:5}, desc:"Danse du feu — chaleur rythmique"},
      // ── HYPNOTIQUE ────────────────────────────────────────────────────────
      {id:"tri_trance",    name:"TRANCE RITUAL", color:"#8040c0", atk:0.001, rel:0.8,  engine:"TRIBAL", params:{decay:0.36, formantHz:750,  punch:4}, desc:"Rituel en transe — boucle hypnotique"},
      {id:"tri_circle",    name:"DRUM CIRCLE",   color:"#a06030", atk:0.001, rel:0.6,  engine:"TRIBAL", params:{decay:0.24, formantHz:680,  punch:5}, desc:"Cercle de tambours — groove collectif"},
      {id:"tri_tribal808", name:"TRIBAL 808",    color:"#cc4020", atk:0.001, rel:1.0,  engine:"TRIBAL", params:{decay:0.45, formantHz:420,  punch:3}, desc:"808 tribal — sub avec couleur vocale"},
      {id:"tri_mask",      name:"WAR MASK",      color:"#c03020", atk:0.001, rel:0.5,  engine:"TRIBAL", params:{decay:0.21, formantHz:1050, punch:6}, desc:"Masque de guerre — cri formaté"},
      {id:"tri_night",     name:"NIGHT CHANT",   color:"#101828", atk:0.02,  rel:1.2,  engine:"TRIBAL", params:{decay:0.55, formantHz:520,  punch:3}, desc:"Chant nocturne — atmosphère rituelle"},
    ]
  },
  CURIOSITY: {
    label:"🔬 CURIOSITY", color:"#40d0ff",
    presets:[
      // ── CLOCHES / MÉTAL ───────────────────────────────────────────────────
      {id:"cu_glassbell",  name:"GLASS BELL",       color:"#c0f0ff", atk:0.001, rel:3.0,  engine:"SCIFI",   params:{modRatio:3.5, modIndex:0.8, lfoFreq:0.1, lpQ:8,  lfoDepth:0.5}, desc:"Cloche de verre — FM pur, long sustain"},
      {id:"cu_crystal",    name:"CRYSTAL MALLET",   color:"#a0e8ff", atk:0.001, rel:2.2,  engine:"SCIFI",   params:{modRatio:4.0, modIndex:1.2, lfoFreq:0.2, lpQ:6,  lfoDepth:0.3}, desc:"Maillet cristal — attaque pure et froide"},
      {id:"cu_steeltongue",name:"STEEL TONGUE",      color:"#80d0e0", atk:0.001, rel:2.8,  engine:"SCIFI",   params:{modRatio:2.8, modIndex:1.5, lfoFreq:0.15,lpQ:7,  lfoDepth:0.4}, desc:"Steel tongue drum — partiel métallique"},
      {id:"cu_celesta",    name:"CELESTA",           color:"#d0eeff", atk:0.001, rel:1.8,  engine:"SCIFI",   params:{modRatio:5.0, modIndex:0.6, lfoFreq:0.1, lpQ:5,  lfoDepth:0.2}, desc:"Célesta — FM harmoniques pures"},
      {id:"cu_vibraphone", name:"VIBRAPHONE",        color:"#60c8e8", atk:0.001, rel:2.5,  engine:"SCIFI",   params:{modRatio:3.1, modIndex:1.0, lfoFreq:6.0, lpQ:4,  lfoDepth:1.2}, desc:"Vibraphone — trémolo moteur + FM"},
      // ── CORDES ────────────────────────────────────────────────────────────
      {id:"cu_eleccello",  name:"ELECTRIC CELLO",   color:"#e08060", atk:0.08,  rel:2.0,  engine:"VAPOR",   params:{detuneCents:4, lpStart:600, lpEnd:3500,sweepTime:1.0,vibRate:5.0,waveType:"sawtooth"}, desc:"Violoncelle électrique — archet synthétique"},
      {id:"cu_cybviolin",  name:"CYBER VIOLIN",     color:"#ff8040", atk:0.04,  rel:1.5,  engine:"VAPOR",   params:{detuneCents:3, lpStart:800, lpEnd:5000,sweepTime:0.7,vibRate:6.5,waveType:"sawtooth"}, desc:"Violon cyberpunk — high BP vibrato"},
      {id:"cu_sitar",      name:"SITAR SIM",         color:"#e0c050", atk:0.001, rel:1.4,  engine:"VAPOR",   params:{detuneCents:12,lpStart:400, lpEnd:2500,sweepTime:0.6,vibRate:7.0,waveType:"sawtooth"}, desc:"Sitar synthétique — corde indienne"},
      {id:"cu_oud",        name:"OUD",               color:"#c89040", atk:0.001, rel:1.2,  engine:"VAPOR",   params:{detuneCents:8, lpStart:300, lpEnd:2000,sweepTime:0.5,vibRate:4.0,waveType:"sawtooth"}, desc:"Oud arabe — pluck grave et chaud"},
      {id:"cu_koto",       name:"KOTO ATTACK",      color:"#f0d080", atk:0.001, rel:1.0,  engine:"SAMURAI", params:{pluckDecay:0.45,resonance:7, harmMix:0.35}, desc:"Koto moderne — pincé tendu"},
      // ── VENTS ─────────────────────────────────────────────────────────────
      {id:"cu_neoflute",   name:"NEO-FLUTE",         color:"#a0ffd0", atk:0.06,  rel:1.0,  engine:"VAPOR",   params:{detuneCents:2, lpStart:1200,lpEnd:5000,sweepTime:0.8,vibRate:5.5,waveType:"sine"},     desc:"Flûte synthétique — souffle pur"},
      {id:"cu_digitoboe",  name:"DIGI-OBOE",         color:"#80e0a0", atk:0.04,  rel:0.9,  engine:"SCIFI",   params:{modRatio:2.0, modIndex:2.5, lfoFreq:5.5, lpQ:6,  lfoDepth:2.0}, desc:"Hautbois numérique — nasal FM"},
      {id:"cu_synthhorn",  name:"SYNTH HORN",        color:"#c0d060", atk:0.12,  rel:1.4,  engine:"VAPOR",   params:{detuneCents:6, lpStart:500, lpEnd:2500,sweepTime:1.2,vibRate:4.0,waveType:"sawtooth"}, desc:"Cor de synthèse — cuivre numérique"},
      {id:"cu_orgpipe",    name:"ORGAN PIPE",        color:"#e8d040", atk:0.05,  rel:1.8,  engine:"VIKINGS", params:{detuneCents:8, subGain:0.5, lpFreq:3000,saturation:1.5,waves:2},                       desc:"Tuyau d'orgue — unisson + sub"},
      {id:"cu_shakuhachi", name:"SHAKUHACHI",        color:"#b0d8a0", atk:0.10,  rel:1.2,  engine:"VAPOR",   params:{detuneCents:3, lpStart:900, lpEnd:3500,sweepTime:1.0,vibRate:3.5,waveType:"triangle"},  desc:"Shakuhachi — bambou filtré"},
      // ── CLAVIERS HYBRIDES ─────────────────────────────────────────────────
      {id:"cu_digharpsi",  name:"DIGI-HARPSI",      color:"#ffe080", atk:0.001, rel:0.7,  engine:"SAMURAI", params:{pluckDecay:0.22,resonance:11,harmMix:0.50}, desc:"Clavecin numérique — sec et brillant"},
      {id:"cu_toypiano",   name:"TOY PIANO",         color:"#ff80c0", atk:0.001, rel:0.8,  engine:"SCIFI",   params:{modRatio:6.0, modIndex:0.5, lfoFreq:0.1, lpQ:3,  lfoDepth:0.1}, desc:"Piano jouet — partiel FM doux"},
      {id:"cu_plastmallet",name:"PLASTIC MALLET",   color:"#c0a0ff", atk:0.001, rel:1.0,  engine:"SAMURAI", params:{pluckDecay:0.38,resonance:6, harmMix:0.42}, desc:"Maillet plastique — attaque molle"},
      {id:"cu_marimba",    name:"MARIMBA",           color:"#d4a060", atk:0.001, rel:0.9,  engine:"SAMURAI", params:{pluckDecay:0.32,resonance:5, harmMix:0.30}, desc:"Marimba — bois mellow, decay doux"},
      {id:"cu_thumbpiano", name:"THUMB PIANO",       color:"#e8b070", atk:0.001, rel:1.6,  engine:"SCIFI",   params:{modRatio:2.2, modIndex:1.8, lfoFreq:0.1, lpQ:5,  lfoDepth:0.2}, desc:"Piano à pouces — tine FM harmonique"},
      // ── HYBRIDES ÉTRANGES ─────────────────────────────────────────────────
      {id:"cu_theremin",   name:"THEREMIN",          color:"#40ffcc", atk:0.15,  rel:1.5,  engine:"SCIFI",   params:{modRatio:1.0, modIndex:0.3, lfoFreq:5.0, lpQ:2,  lfoDepth:2.5}, desc:"Thérémine — onde pure + LFO pitch"},
      {id:"cu_banjo",      name:"BANJO SIM",         color:"#e8c060", atk:0.001, rel:0.6,  engine:"SAMURAI", params:{pluckDecay:0.18,resonance:13,harmMix:0.60}, desc:"Banjo — pluck brillant ultra sec"},
      {id:"cu_dulcimer",   name:"DULCIMER",          color:"#c09050", atk:0.001, rel:1.3,  engine:"SAMURAI", params:{pluckDecay:0.52,resonance:7, harmMix:0.28}, desc:"Dulcimer — cordes frappées, wood"},
      {id:"cu_mandolin",   name:"MANDOLIN",          color:"#d0a040", atk:0.001, rel:0.5,  engine:"SAMURAI", params:{pluckDecay:0.14,resonance:10,harmMix:0.55}, desc:"Mandoline — trémolo rapide"},
      {id:"cu_balalaika",  name:"BALALAIKA",         color:"#ff6040", atk:0.001, rel:0.9,  engine:"SAMURAI", params:{pluckDecay:0.40,resonance:8, harmMix:0.32}, desc:"Balalaïka russe — triangulaire"},
    ]
  },
  XFILES: {
    label:"👽 X-FILES", color:"#8040ff",
    presets:[
      // ── FM ALIEN ──────────────────────────────────────────────────────────
      {id:"xf_abduction",  name:"ABDUCTION PULSE",  color:"#8040ff", atk:0.001, rel:1.5,  engine:"SCIFI",  params:{modRatio:7.3,  modIndex:18,  lfoFreq:8.0,  lpQ:12, lfoDepth:12}, desc:"Modulation FM incontrôlable — alien"},
      {id:"xf_blackhole",  name:"BLACK HOLE",        color:"#000022", atk:1.5,   rel:5.0,  engine:"HORROR", params:{modRatio:1.001,driftAmount:0.090,bitSteps:32, lpFreq:300, lpQ:1},  desc:"Singularité — temps qui s'effondre"},
      {id:"xf_area51",     name:"AREA 51 WHISPER",  color:"#00ff88", atk:0.3,   rel:3.0,  engine:"SCIFI",  params:{modRatio:0.25, modIndex:6,   lfoFreq:0.05, lpQ:3,  lfoDepth:8},  desc:"Sub-harmonique FM — voix secrète"},
      {id:"xf_telepathy",  name:"TELEPATHY GLITCH", color:"#ff00ff", atk:0.001, rel:0.8,  engine:"HORROR", params:{modRatio:1.077,driftAmount:0.065,bitSteps:3,  lpFreq:4500,lpQ:8},  desc:"Glitch mental — bitcrush + dérive"},
      {id:"xf_mutant",     name:"MUTANT ORGANISM",  color:"#40ff40", atk:0.05,  rel:2.5,  engine:"SCIFI",  params:{modRatio:1.618,modIndex:9,   lfoFreq:2.3,  lpQ:7,  lfoDepth:6},  desc:"Ratio d'or FM — croissance organique"},
      // ── PORTAILS / DIMENSIONS ─────────────────────────────────────────────
      {id:"xf_portal",     name:"DIMENSION PORTAL", color:"#6000ff", atk:0.08,  rel:3.5,  engine:"SCIFI",  params:{modRatio:0.5,  modIndex:14,  lfoFreq:0.8,  lpQ:5,  lfoDepth:10}, desc:"Sub FM géant — portail qui s'ouvre"},
      {id:"xf_ghost",      name:"GHOST IN MACHINE",  color:"#d0d0ff", atk:0.2,   rel:4.0,  engine:"HORROR", params:{modRatio:1.003,driftAmount:0.075,bitSteps:22, lpFreq:2200,lpQ:1},  desc:"Signal fantôme — spectre numérique"},
      {id:"xf_deepcreature",name:"DEEP CREATURE",   color:"#003060", atk:0.001, rel:2.0,  engine:"SCIFI",  params:{modRatio:0.13, modIndex:20,  lfoFreq:0.3,  lpQ:9,  lfoDepth:15}, desc:"Sub FM infra-basse — créature abyssale"},
      {id:"xf_biolum",     name:"BIOLUMINESCENCE",  color:"#00ffaa", atk:0.4,   rel:3.5,  engine:"SCIFI",  params:{modRatio:3.14, modIndex:2,   lfoFreq:1.2,  lpQ:4,  lfoDepth:3},  desc:"FM π — pulsation organique douce"},
      {id:"xf_quantum",    name:"QUANTUM FOAM",     color:"#ff80ff", atk:0.001, rel:0.6,  engine:"HORROR", params:{modRatio:1.033,driftAmount:0.045,bitSteps:5,  lpFreq:6000,lpQ:10}, desc:"Mousse quantique — chaos haute fréq"},
      // ── PSYCHIQUE / MENTALE ───────────────────────────────────────────────
      {id:"xf_psychic",    name:"PSYCHIC WAVE",     color:"#c080ff", atk:0.001, rel:2.0,  engine:"SCIFI",  params:{modRatio:9.0,  modIndex:5,   lfoFreq:12.0, lpQ:6,  lfoDepth:8},  desc:"LFO rapide sur pitch — onde cérébrale"},
      {id:"xf_mindbend",   name:"MIND BEND",        color:"#ff40ff", atk:0.001, rel:1.2,  engine:"SCIFI",  params:{modRatio:2.71, modIndex:12,  lfoFreq:3.5,  lpQ:9,  lfoDepth:9},  desc:"FM e-ratio — instabilité harmonique"},
      {id:"xf_timefrac",   name:"TIME FRACTURE",    color:"#8080ff", atk:0.001, rel:0.4,  engine:"HORROR", params:{modRatio:1.099,driftAmount:0.055,bitSteps:4,  lpFreq:3500,lpQ:6},  desc:"Fracture temporelle — glitch extrême"},
      {id:"xf_neural",     name:"NEURAL DECAY",     color:"#ff6080", atk:0.001, rel:1.8,  engine:"HORROR", params:{modRatio:1.041,driftAmount:0.038,bitSteps:8,  lpFreq:1600,lpQ:3},  desc:"Déclin neuronal — dérive lente"},
      {id:"xf_dnamutation",name:"DNA MUTATION",     color:"#40ffaa", atk:0.02,  rel:2.2,  engine:"SCIFI",  params:{modRatio:1.5,  modIndex:7,   lfoFreq:0.4,  lpQ:5,  lfoDepth:5},  desc:"FM harmonique — mutation biologique"},
      // ── COSMIQUE ──────────────────────────────────────────────────────────
      {id:"xf_darkmatter",  name:"DARK MATTER",     color:"#100820", atk:0.8,   rel:5.0,  engine:"HORROR", params:{modRatio:1.000,driftAmount:0.100,bitSteps:40, lpFreq:200, lpQ:1},  desc:"Matière noire — sub infra, dérive max"},
      {id:"xf_voidwhistle", name:"VOID WHISTLE",    color:"#ffffff", atk:0.001, rel:2.5,  engine:"SCIFI",  params:{modRatio:11.0, modIndex:1,   lfoFreq:0.15, lpQ:15, lfoDepth:1},  desc:"Sifflet du vide — aigu FM pur"},
      {id:"xf_empulse",    name:"EMP PULSE",        color:"#ffff00", atk:0.001, rel:0.3,  engine:"CHERNOBYL",params:{bitSteps:1, noiseAmt:0.45, satAmount:7.0},                      desc:"Impulsion électromagnétique — chaos"},
      {id:"xf_cosmic",     name:"COSMIC HORROR",   color:"#300030", atk:1.0,   rel:6.0,  engine:"HORROR", params:{modRatio:1.002,driftAmount:0.085,bitSteps:35, lpFreq:350, lpQ:1},  desc:"Lovecraftien — terreur incompréhensible"},
      {id:"xf_entropy",    name:"ENTROPY",          color:"#404040", atk:0.001, rel:1.0,  engine:"HORROR", params:{modRatio:1.062,driftAmount:0.060,bitSteps:6,  lpFreq:2800,lpQ:4},  desc:"Entropie — désordre croissant"},
      // ── GLITCH / MACHINE ──────────────────────────────────────────────────
      {id:"xf_singularity",name:"SINGULARITY",     color:"#ff8000", atk:0.001, rel:0.8,  engine:"SCIFI",  params:{modRatio:4.44, modIndex:22,  lfoFreq:15.0, lpQ:14, lfoDepth:18}, desc:"LFO ultra-rapide — singularité FM"},
      {id:"xf_xenomorph",  name:"XENOMORPH",        color:"#003300", atk:0.001, rel:1.4,  engine:"HORROR", params:{modRatio:1.047,driftAmount:0.042,bitSteps:7,  lpFreq:1900,lpQ:5},  desc:"Morphologie alien — texture visqueuse"},
      {id:"xf_astral",     name:"ASTRAL PROJECT",  color:"#c0c0ff", atk:0.5,   rel:4.5,  engine:"SCIFI",  params:{modRatio:0.33, modIndex:3,   lfoFreq:0.08, lpQ:2,  lfoDepth:4},  desc:"Sub-1/3 FM — corps astral flottant"},
      {id:"xf_membrane",   name:"MEMBRANE VIB",    color:"#80c0a0", atk:0.001, rel:1.6,  engine:"SCIFI",  params:{modRatio:2.0,  modIndex:15,  lfoFreq:22.0, lpQ:8,  lfoDepth:14}, desc:"Vibration membranaire — LFO ultrason"},
      {id:"xf_voidsignal", name:"VOID SIGNAL",     color:"#004040", atk:0.1,   rel:3.0,  engine:"SCIFI",  params:{modRatio:5.5,  modIndex:4,   lfoFreq:0.02, lpQ:10, lfoDepth:6},  desc:"Signal de l'infini — LFO quasi-statique"},
    ]
  },
  FLUTES: {
    label:"🎵 FLUTES", color:"#a0e8c0",
    presets:[
      // ── FLÛTES ASIATIQUES ─────────────────────────────────────────────────
      {id:"fl_bansuri",    name:"ZEN BANSURI",     color:"#c0f0d0", atk:0.10,  rel:1.5,  engine:"VAPOR", params:{detuneCents:2, lpStart:1800,lpEnd:4500,sweepTime:0.9, vibRate:4.8, vibDepth:0.004, waveType:"sine"},     desc:"Bansuri indien — souffle pur, vibrato lent"},
      {id:"fl_shakuhachi", name:"SHAKUHACHI",      color:"#a0d0b0", atk:0.12,  rel:1.8,  engine:"VAPOR", params:{detuneCents:3, lpStart:1200,lpEnd:3500,sweepTime:1.2, vibRate:3.5, vibDepth:0.006, waveType:"triangle"}, desc:"Bambou japonais — breath naturel"},
      {id:"fl_dizi",       name:"DIZI CHINESE",    color:"#80e0c0", atk:0.06,  rel:1.0,  engine:"VAPOR", params:{detuneCents:2, lpStart:2500,lpEnd:6000,sweepTime:0.5, vibRate:6.5, vibDepth:0.005, waveType:"sine"},     desc:"Dizi transverse — brillant et aigu"},
      {id:"fl_xiao",       name:"XIAO",            color:"#60c0a0", atk:0.15,  rel:2.0,  engine:"VAPOR", params:{detuneCents:1, lpStart:900, lpEnd:2800,sweepTime:1.5, vibRate:3.0, vibDepth:0.007, waveType:"sine"},     desc:"Xiao vertical — grave et méditatif"},
      {id:"fl_kagurabue",  name:"KAGURA BUE",      color:"#b0f0e0", atk:0.08,  rel:1.2,  engine:"VAPOR", params:{detuneCents:2, lpStart:3000,lpEnd:7000,sweepTime:0.6, vibRate:7.0, vibDepth:0.004, waveType:"sine"},     desc:"Flûte rituelle shinto — aiguë et sacrée"},
      // ── FLÛTES ANDINES ────────────────────────────────────────────────────
      {id:"fl_quena",      name:"QUENA ANDEAN",    color:"#e0d080", atk:0.10,  rel:1.4,  engine:"VAPOR", params:{detuneCents:5, lpStart:1400,lpEnd:4000,sweepTime:0.8, vibRate:5.0, vibDepth:0.008, waveType:"triangle"}, desc:"Quena andine — boisé, vibrato montagnard"},
      {id:"fl_panflute",   name:"CYBER PANFLUTE",  color:"#40ffa0", atk:0.08,  rel:1.6,  engine:"VAPOR", params:{detuneCents:6, lpStart:1600,lpEnd:5000,sweepTime:0.7, vibRate:5.5, vibDepth:0.006, waveType:"sine"},     desc:"Pan flûte synthétique — doux et aérien"},
      {id:"fl_siku",       name:"ANDEAN WIND",     color:"#d0e060", atk:0.14,  rel:1.8,  engine:"VAPOR", params:{detuneCents:8, lpStart:1000,lpEnd:3200,sweepTime:1.0, vibRate:4.2, vibDepth:0.009, waveType:"triangle"}, desc:"Siku bolivien — souffle large et grave"},
      {id:"fl_ocarina",    name:"MISTY OCARINA",   color:"#f0e0a0", atk:0.09,  rel:1.3,  engine:"VAPOR", params:{detuneCents:3, lpStart:2000,lpEnd:4500,sweepTime:0.6, vibRate:4.5, vibDepth:0.005, waveType:"sine"},     desc:"Ocarina argile — rond et chaud"},
      {id:"fl_antara",     name:"ANTARA NIGHT",    color:"#a0b040", atk:0.18,  rel:2.2,  engine:"VAPOR", params:{detuneCents:7, lpStart:800, lpEnd:2500,sweepTime:1.4, vibRate:3.2, vibDepth:0.010, waveType:"triangle"}, desc:"Flûte de nuit andine — lente et sombre"},
      // ── FLÛTES EUROPÉENNES ────────────────────────────────────────────────
      {id:"fl_concert",    name:"CONCERT FLUTE",   color:"#e0f0ff", atk:0.07,  rel:1.2,  engine:"VAPOR", params:{detuneCents:2, lpStart:2200,lpEnd:6500,sweepTime:0.6, vibRate:5.8, vibDepth:0.004, waveType:"sine"},     desc:"Flûte traversière classique — brillante"},
      {id:"fl_piccolo",    name:"SILVER PICCOLO",  color:"#c0e0ff", atk:0.04,  rel:0.8,  engine:"VAPOR", params:{detuneCents:1, lpStart:4000,lpEnd:9000,sweepTime:0.4, vibRate:7.5, vibDepth:0.003, waveType:"sine"},     desc:"Piccolo — octave haute, vibrato serré"},
      {id:"fl_alto",       name:"ALTO FLUTE",      color:"#a0d0e8", atk:0.12,  rel:1.6,  engine:"VAPOR", params:{detuneCents:3, lpStart:1400,lpEnd:3500,sweepTime:1.0, vibRate:4.5, vibDepth:0.006, waveType:"sine"},     desc:"Flûte alto — timbre grave et chaleureux"},
      {id:"fl_bass",       name:"BASS FLUTE",      color:"#6080c0", atk:0.16,  rel:2.0,  engine:"VAPOR", params:{detuneCents:4, lpStart:700, lpEnd:2000,sweepTime:1.3, vibRate:3.8, vibDepth:0.008, waveType:"triangle"}, desc:"Flûte basse — profonde et rare"},
      {id:"fl_recorder",   name:"DIGITAL RECORDER",color:"#d0e8c0", atk:0.06,  rel:1.0,  engine:"VAPOR", params:{detuneCents:2, lpStart:1800,lpEnd:4000,sweepTime:0.5, vibRate:5.0, vibDepth:0.004, waveType:"triangle"}, desc:"Flûte à bec numérique — pure et directe"},
      // ── FLÛTES DU MONDE ───────────────────────────────────────────────────
      {id:"fl_ney",        name:"NEY PERSIAN",     color:"#c0a060", atk:0.14,  rel:1.6,  engine:"VAPOR", params:{detuneCents:4, lpStart:1100,lpEnd:3200,sweepTime:1.1, vibRate:4.0, vibDepth:0.009, waveType:"triangle"}, desc:"Ney soufie — roseau, ton voilé"},
      {id:"fl_bawu",       name:"BAWU YUNNAN",     color:"#80c080", atk:0.08,  rel:1.1,  engine:"VAPOR", params:{detuneCents:3, lpStart:1600,lpEnd:4200,sweepTime:0.7, vibRate:5.5, vibDepth:0.006, waveType:"triangle"}, desc:"Bawu transverse — métal-bois yunnanais"},
      {id:"fl_tinwhistle", name:"TIN WHISTLE",     color:"#d0e0a0", atk:0.04,  rel:0.9,  engine:"VAPOR", params:{detuneCents:2, lpStart:3200,lpEnd:7500,sweepTime:0.4, vibRate:6.0, vibDepth:0.004, waveType:"sine"},     desc:"Tin whistle irlandais — vif et dansant"},
      {id:"fl_fujara",     name:"FUJARA FOLK",     color:"#b09060", atk:0.20,  rel:2.5,  engine:"VAPOR", params:{detuneCents:5, lpStart:600, lpEnd:1800,sweepTime:1.8, vibRate:2.8, vibDepth:0.012, waveType:"triangle"}, desc:"Fujara slovaque — longue flûte grave"},
      {id:"fl_temple",     name:"TEMPLE FLUTE",    color:"#f0d0a0", atk:0.12,  rel:2.0,  engine:"VAPOR", params:{detuneCents:3, lpStart:1300,lpEnd:3600,sweepTime:1.0, vibRate:4.0, vibDepth:0.007, waveType:"sine"},     desc:"Flûte de temple — calme et rituelle"},
      // ── FLÛTES SYNTHÉTIQUES ───────────────────────────────────────────────
      {id:"fl_bamboo",     name:"BAMBOO BREATH",   color:"#90c840", atk:0.15,  rel:1.5,  engine:"VAPOR", params:{detuneCents:4, lpStart:1000,lpEnd:2800,sweepTime:1.2, vibRate:4.5, vibDepth:0.008, waveType:"triangle"}, desc:"Bambou — souffle + texture boisée"},
      {id:"fl_glass",      name:"GLASS FLUTE",     color:"#c0f0ff", atk:0.08,  rel:2.5,  engine:"SCIFI", params:{modRatio:1.0,  modIndex:0.4, lfoFreq:5.2, lpQ:3,  lfoDepth:1.8},                                        desc:"Flûte de verre — FM pure + LFO lent"},
      {id:"fl_overtone",   name:"OVERTONE FLUTE",  color:"#80e0ff", atk:0.10,  rel:2.0,  engine:"SCIFI", params:{modRatio:2.0,  modIndex:0.8, lfoFreq:4.8, lpQ:4,  lfoDepth:2.2},                                        desc:"Flûte à harmoniques — 2e partiel FM"},
      {id:"fl_frost",      name:"FROST BREATH",    color:"#d0f8ff", atk:0.18,  rel:2.2,  engine:"VAPOR", params:{detuneCents:5, lpStart:600, lpEnd:2000,sweepTime:1.8, vibRate:3.0, vibDepth:0.010, waveType:"sine"},     desc:"Souffle glacé — lent et cristallin"},
      {id:"fl_lofi",       name:"LOFI FLUTE",      color:"#d0c090", atk:0.10,  rel:1.4,  engine:"VAPOR", params:{detuneCents:7, lpStart:900, lpEnd:2500,sweepTime:1.0, vibRate:5.0, vibDepth:0.012, waveType:"triangle"}, desc:"Flûte lo-fi — légèrement désaccordée"},
    ]
  },
  GUITARS: {
    label:"🎸 GUITARS", color:"#e06030",
    presets:[
      // ── ACOUSTIQUES — corps naturel + snap ────────────────────────────────
      {id:"gt_nylon",      name:"NYLON SNAP",       color:"#e8d080", atk:0.001, rel:0.4,  engine:"GUITAR", params:{waveType:"triangle",filterOpen:3500, filterClose:500, filterTime:0.18, filterQ:1.5, distAmount:1.1, bodyDecay:0.22, subMix:0.15}, desc:"Corde nylon — clac doux + corps"},
      {id:"gt_steel",      name:"STEEL PLUCK",      color:"#c0a050", atk:0.001, rel:0.35, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:6000, filterClose:900, filterTime:0.10, filterQ:2.0, distAmount:1.3, bodyDecay:0.18, subMix:0.10}, desc:"Acier — brillant, snap immédiat"},
      {id:"gt_hardpick",   name:"HARD PICK",        color:"#ff6020", atk:0.001, rel:0.30, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:7000, filterClose:1200,filterTime:0.08, filterQ:2.5, distAmount:1.5, bodyDecay:0.14, subMix:0.0},  desc:"Médiator fort — attaque maxima"},
      {id:"gt_fingerpick", name:"FINGER PLUCK",     color:"#d0c060", atk:0.001, rel:0.45, engine:"GUITAR", params:{waveType:"triangle",filterOpen:4000, filterClose:600, filterTime:0.20, filterQ:1.8, distAmount:1.1, bodyDecay:0.25, subMix:0.12}, desc:"Picking doigt — chaleureux, naturel"},
      {id:"gt_midnight",   name:"MIDNIGHT STRUM",   color:"#303020", atk:0.001, rel:0.5,  engine:"GUITAR", params:{waveType:"triangle",filterOpen:2500, filterClose:350, filterTime:0.25, filterQ:1.2, distAmount:1.0, bodyDecay:0.30, subMix:0.20}, desc:"Acoustique grave — nuit calme"},
      // ── ÉLECTRIQUES CLEAN ─────────────────────────────────────────────────
      {id:"gt_tele",       name:"TELE BITE",        color:"#e05020", atk:0.001, rel:0.30, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:8000, filterClose:1500,filterTime:0.07, filterQ:3.0, distAmount:1.4, bodyDecay:0.16, subMix:0.0},  desc:"Telecaster — twang mordant, clac net"},
      {id:"gt_strat",      name:"MUTED CHUNK",      color:"#c04010", atk:0.001, rel:0.20, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:3000, filterClose:400, filterTime:0.05, filterQ:2.0, distAmount:1.3, bodyDecay:0.10, subMix:0.0},  desc:"Palm mute — étouffé, chunky"},
      {id:"gt_jazzclean",  name:"JAZZ PLUCK",       color:"#d09030", atk:0.001, rel:0.50, engine:"GUITAR", params:{waveType:"triangle",filterOpen:2200, filterClose:300, filterTime:0.22, filterQ:1.0, distAmount:1.0, bodyDecay:0.28, subMix:0.25}, desc:"Jazz clean — rond et chaud"},
      {id:"gt_archtop",    name:"ARCHTOP SNAP",     color:"#c08020", atk:0.001, rel:0.45, engine:"GUITAR", params:{waveType:"triangle",filterOpen:2800, filterClose:380, filterTime:0.20, filterQ:1.2, distAmount:1.0, bodyDecay:0.24, subMix:0.18}, desc:"Hollow body — corps profond"},
      {id:"gt_funky",      name:"FUNK SCRATCH",     color:"#ffcc00", atk:0.001, rel:0.15, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:5000, filterClose:800, filterTime:0.04, filterQ:4.0, distAmount:1.6, bodyDecay:0.08, subMix:0.0},  desc:"Scratch wah — ultra court, funk"},
      // ── ÉLECTRIQUES COLORÉES ──────────────────────────────────────────────
      {id:"gt_country",    name:"COUNTRY TWANG",    color:"#e0b040", atk:0.001, rel:0.35, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:9000, filterClose:1800,filterTime:0.06, filterQ:3.5, distAmount:1.2, bodyDecay:0.15, subMix:0.0},  desc:"Twang country — très brillant, pin"},
      {id:"gt_flamenco",   name:"FLAMENCO NAIL",    color:"#ff8030", atk:0.001, rel:0.30, engine:"GUITAR", params:{waveType:"triangle",filterOpen:5500, filterClose:700, filterTime:0.09, filterQ:2.8, distAmount:1.2, bodyDecay:0.16, subMix:0.08}, desc:"Ongle flamenco — clac rapide précis"},
      {id:"gt_rockabilly", name:"SLAP ROCK",        color:"#ff4040", atk:0.001, rel:0.25, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:7500, filterClose:1100,filterTime:0.06, filterQ:2.5, distAmount:1.5, bodyDecay:0.12, subMix:0.0},  desc:"Slap rockabilly — sec et mordant"},
      {id:"gt_bossa",      name:"BOSSA NAIL",       color:"#60c060", atk:0.001, rel:0.40, engine:"GUITAR", params:{waveType:"triangle",filterOpen:3200, filterClose:450, filterTime:0.16, filterQ:1.6, distAmount:1.0, bodyDecay:0.20, subMix:0.14}, desc:"Nylon brésilien — pluck lumineux"},
      {id:"gt_surf",       name:"SURF PING",        color:"#40c0e0", atk:0.001, rel:0.35, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:10000,filterClose:2000,filterTime:0.05, filterQ:4.0, distAmount:1.2, bodyDecay:0.12, subMix:0.0},  desc:"Surf twang — résonance aiguë brillante"},
      // ── DISTORSION / CRUNCH ───────────────────────────────────────────────
      {id:"gt_crunch",     name:"CRUNCH CHORD",     color:"#804020", atk:0.001, rel:0.35, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:4500, filterClose:600, filterTime:0.08, filterQ:2.0, distAmount:3.0, bodyDecay:0.18, subMix:0.0},  desc:"Power chord crunch — drive moyen"},
      {id:"gt_grunge",     name:"GRUNGE PLUCK",     color:"#505050", atk:0.001, rel:0.40, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:3500, filterClose:500, filterTime:0.10, filterQ:1.8, distAmount:4.5, bodyDecay:0.22, subMix:0.0},  desc:"Grunge — saturation + decay court"},
      {id:"gt_metal",      name:"METAL CHUNK",      color:"#202020", atk:0.001, rel:0.25, engine:"GUITAR", params:{waveType:"square",   filterOpen:4000, filterClose:800, filterTime:0.06, filterQ:2.5, distAmount:5.5, bodyDecay:0.14, subMix:0.0},  desc:"Metal carré — attaque tranchante"},
      {id:"gt_djent",      name:"DJENT CLIP",       color:"#303030", atk:0.001, rel:0.20, engine:"GUITAR", params:{waveType:"square",   filterOpen:3000, filterClose:500, filterTime:0.04, filterQ:3.0, distAmount:6.5, bodyDecay:0.10, subMix:0.0},  desc:"Djent — mute + distorsion extrême"},
      {id:"gt_dirtypower", name:"DIRTY POWERCHORD", color:"#602020", atk:0.001, rel:0.45, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:4000, filterClose:550, filterTime:0.12, filterQ:2.2, distAmount:4.0, detuneCents:8, bodyDecay:0.20, subMix:0.05}, desc:"Power chord sale — detune + drive"},
      // ── SPÉCIALES ─────────────────────────────────────────────────────────
      {id:"gt_12string",   name:"12-STRING SNAP",   color:"#d0b060", atk:0.001, rel:0.45, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:7000, filterClose:1000,filterTime:0.08, filterQ:2.0, distAmount:1.3, detuneCents:10,bodyDecay:0.20, subMix:0.0},  desc:"12 cordes — chorus naturel, brillant"},
      {id:"gt_baritone",   name:"BARITONE PLUCK",   color:"#603040", atk:0.001, rel:0.50, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:3000, filterClose:400, filterTime:0.15, filterQ:1.5, distAmount:1.8, bodyDecay:0.28, subMix:0.20}, desc:"Baryton — grave + snap lent"},
      {id:"gt_lapsteel",   name:"LAP STEEL SNAP",   color:"#80a0c0", atk:0.001, rel:0.55, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:5500, filterClose:700, filterTime:0.12, filterQ:2.2, distAmount:1.4, bodyDecay:0.26, subMix:0.10}, desc:"Lap steel — slide + snap ouvert"},
      {id:"gt_piezo",      name:"PIEZO CRACK",      color:"#e0e0c0", atk:0.001, rel:0.25, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:11000,filterClose:2500,filterTime:0.04, filterQ:5.0, distAmount:1.2, bodyDecay:0.10, subMix:0.0},  desc:"Piezo micro — crisp harsh, ultrason"},
      {id:"gt_resonator",  name:"RESONATOR CLACK",  color:"#a0b0b0", atk:0.001, rel:0.40, engine:"GUITAR", params:{waveType:"sawtooth", filterOpen:6000, filterClose:850, filterTime:0.09, filterQ:3.2, distAmount:1.6, bodyDecay:0.19, subMix:0.12}, desc:"Dobro résonateur — métal + snap net"},
    ]
  },
  JOLA_EP: {
    label:"🎹 JOLA EP", color:"#60a8e0",
    presets:[
      // ── RHODES CLASSIQUE ──────────────────────────────────────────────────
      {id:"ep_jola",      name:"JOLA RHODES",     color:"#60a8e0", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:3.0, tremoloDepth:0.07, detuneCents:4,  lpHz:1300, lpQ:1.2, clickAmount:0.14, decayTime:1.5, sustainLevel:0.20, warmth:1.8}, desc:"Le son signataire — chaud, mélancolique"},
      {id:"ep_bluerain",  name:"BLUE RAIN",        color:"#4080c0", atk:0.01, rel:0.6, engine:"JOLA_EP", params:{tremoloRate:2.2, tremoloDepth:0.10, detuneCents:5,  lpHz:1000, lpQ:1.5, clickAmount:0.10, decayTime:1.8, sustainLevel:0.18, warmth:2.0}, desc:"Pluie bleue — tremolo lent, très sombre"},
      {id:"ep_82keys",    name:"82 KEYS",          color:"#8070c0", atk:0.01, rel:0.4, engine:"JOLA_EP", params:{tremoloRate:3.5, tremoloDepth:0.06, detuneCents:3,  lpHz:1600, lpQ:1.0, clickAmount:0.18, decayTime:1.2, sustainLevel:0.22, warmth:1.5}, desc:"Vintage 1982 — click présent, decay moyen"},
      {id:"ep_coldnight", name:"COLD NIGHTS",      color:"#3060a0", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:4.5, tremoloDepth:0.12, detuneCents:6,  lpHz:900,  lpQ:2.0, clickAmount:0.08, decayTime:2.0, sustainLevel:0.15, warmth:1.6}, desc:"Nuits froides — tremolo plus rapide, LP bas"},
      {id:"ep_cloudy",    name:"CLOUDY ELECTRIC",  color:"#90b0d8", atk:0.01, rel:0.6, engine:"JOLA_EP", params:{tremoloRate:2.8, tremoloDepth:0.14, detuneCents:8,  lpHz:1100, lpQ:1.3, clickAmount:0.06, decayTime:2.2, sustainLevel:0.17, warmth:2.2}, desc:"Électrique nuageux — chorus large, planant"},
      // ── SOUL / VINTAGE ────────────────────────────────────────────────────
      {id:"ep_vintsoul",  name:"VINTAGE SOUL",     color:"#d09040", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:3.2, tremoloDepth:0.05, detuneCents:3,  lpHz:1500, lpQ:0.9, clickAmount:0.20, decayTime:1.3, sustainLevel:0.25, warmth:2.5}, desc:"Soul vintage — click net, chaleur saturée"},
      {id:"ep_midnightep",name:"MIDNIGHT EP",      color:"#202840", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:2.0, tremoloDepth:0.08, detuneCents:5,  lpHz:750,  lpQ:1.8, clickAmount:0.08, decayTime:2.5, sustainLevel:0.12, warmth:1.4}, desc:"EP de minuit — LP très bas, grave et sombre"},
      {id:"ep_wave",      name:"WAVE PIANO",       color:"#40c0b0", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:1.8, tremoloDepth:0.18, detuneCents:4,  lpHz:1200, lpQ:1.4, clickAmount:0.10, decayTime:1.6, sustainLevel:0.20, warmth:1.7}, desc:"Piano vague — tremolo profond et lent"},
      // ── MÉLANCOLIQUE / NOCTURNE ───────────────────────────────────────────
      {id:"ep_melrhode",  name:"MELANCHOLY RHODE", color:"#6060a0", atk:0.01, rel:0.6, engine:"JOLA_EP", params:{tremoloRate:2.5, tremoloDepth:0.09, detuneCents:5,  lpHz:1050, lpQ:1.5, clickAmount:0.12, decayTime:2.0, sustainLevel:0.18, warmth:1.9}, desc:"Rhode mélancolique — comme une larme"},
      {id:"ep_tapeflut",  name:"TAPE FLUTTER",     color:"#c09060", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:6.0, tremoloDepth:0.14, detuneCents:9,  lpHz:950,  lpQ:1.8, clickAmount:0.06, decayTime:1.4, sustainLevel:0.16, warmth:3.0}, desc:"Cassette instable — flutter rapide + saturation"},
      {id:"ep_oldhotel",  name:"OLD HOTEL",        color:"#a08060", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:2.8, tremoloDepth:0.07, detuneCents:4,  lpHz:900,  lpQ:1.6, clickAmount:0.16, decayTime:1.8, sustainLevel:0.20, warmth:2.8}, desc:"Vieil hôtel — saturation chaude, ambiance"},
      // ── JAZZ / NOCTURNE ───────────────────────────────────────────────────
      {id:"ep_jazznoir",  name:"JAZZ NOIR",        color:"#302030", atk:0.01, rel:0.3, engine:"JOLA_EP", params:{tremoloRate:3.8, tremoloDepth:0.04, detuneCents:2,  lpHz:1800, lpQ:0.8, clickAmount:0.22, decayTime:0.9, sustainLevel:0.25, warmth:1.4}, desc:"Jazz noir — click fort, decay rapide, propre"},
      {id:"ep_lasttrain", name:"LAST TRAIN",       color:"#405070", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:3.4, tremoloDepth:0.10, detuneCents:6,  lpHz:1000, lpQ:1.5, clickAmount:0.11, decayTime:1.9, sustainLevel:0.18, warmth:1.8}, desc:"Dernier train — rythme dans le tremolo"},
      // ── EXPÉRIMENTAL / TEXTURÉ ────────────────────────────────────────────
      {id:"ep_feverdream", name:"FEVER DREAM",     color:"#c040a0", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:7.0, tremoloDepth:0.18, detuneCents:8,  lpHz:900,  lpQ:2.5, clickAmount:0.05, decayTime:1.4, sustainLevel:0.14, warmth:2.0}, desc:"Rêve fiévreux — tremolo rapide et instable"},
      {id:"ep_broken",    name:"BROKEN KEYS",      color:"#808070", atk:0.01, rel:0.4, engine:"JOLA_EP", params:{tremoloRate:4.8, tremoloDepth:0.16, detuneCents:12, lpHz:800,  lpQ:3.0, clickAmount:0.08, decayTime:1.2, sustainLevel:0.12, warmth:2.6}, desc:"Touches brisées — chorus large + tremolo vif"},
      {id:"ep_fmshadow",  name:"FM SHADOW",        color:"#404060", atk:0.01, rel:0.5, engine:"JOLA_EP", params:{tremoloRate:2.2, tremoloDepth:0.09, detuneCents:6,  lpHz:1400, lpQ:2.8, clickAmount:0.12, decayTime:2.0, sustainLevel:0.16, warmth:1.0}, desc:"Ombre FM — haute résonance, froid métallique"},
      {id:"ep_warmwood",  name:"WARM WOOD",        color:"#c0804a", atk:0.01, rel:0.6, engine:"JOLA_EP", params:{tremoloRate:2.4, tremoloDepth:0.06, detuneCents:3,  lpHz:950,  lpQ:1.1, clickAmount:0.14, decayTime:2.2, sustainLevel:0.23, warmth:4.0}, desc:"Bois chaud — saturation max, très analogique"},
    ]
  },
  BAGPIPES: {
    label:"🏴󠁧󠁢󠁳󠁣󠁴󠁿 BAGPIPES", color:"#4ca840",
    presets:[
      // ── CLASSIQUES ÉCOSSAIS ────────────────────────────────────────────────
      {id:"bp_highland",   name:"HIGHLAND BRAVE",   color:"#4ca840", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.22, droneGain:0.35, droneLPHz:280, vibratoRate:6.0, vibratoDepth:0.008, brightness:3200, nasalQ:2.5}, desc:"Cornemuse écossaise classique — criard et fier"},
      {id:"bp_skirl",      name:"SKIRL OF WAR",     color:"#cc2020", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.18, droneGain:0.40, droneLPHz:320, vibratoRate:7.0, vibratoDepth:0.010, brightness:4500, nasalQ:3.5}, desc:"Cri de guerre — aigu, hostile, maximum"},
      {id:"bp_march",      name:"HIGHLAND MARCH",   color:"#20a840", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.20, droneGain:0.38, droneLPHz:300, vibratoRate:6.5, vibratoDepth:0.009, brightness:3800, nasalQ:3.0}, desc:"Marche militaire — puissant et rythmique"},
      {id:"bp_braveheart", name:"BRAVEHEART",       color:"#3060e0", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.24, droneGain:0.45, droneLPHz:350, vibratoRate:5.5, vibratoDepth:0.007, brightness:3000, nasalQ:2.8}, desc:"Épique cinématique — plein et profond"},
      {id:"bp_clan",       name:"CLAN RALLY",       color:"#e0a020", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.21, droneGain:0.42, droneLPHz:310, vibratoRate:6.8, vibratoDepth:0.009, brightness:3500, nasalQ:3.2}, desc:"Rassemblement du clan — large et fort"},
      // ── ATMOSPHÉRIQUES / LAMENT ───────────────────────────────────────────
      {id:"bp_lament",     name:"PIPER'S LAMENT",   color:"#6080c0", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.28, droneGain:0.30, droneLPHz:220, vibratoRate:5.0, vibratoDepth:0.006, brightness:2400, nasalQ:2.0}, desc:"Complainte du joueur — mélancolique"},
      {id:"bp_glen",       name:"MISTY GLEN",       color:"#80c0a0", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.30, droneGain:0.28, droneLPHz:200, vibratoRate:4.5, vibratoDepth:0.005, brightness:2000, nasalQ:1.8}, desc:"Vallée brumeuse — doux et nostalgique"},
      {id:"bp_funeral",    name:"FUNERAL PIPE",     color:"#303040", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.32, droneGain:0.50, droneLPHz:180, vibratoRate:4.0, vibratoDepth:0.004, brightness:1800, nasalQ:1.5}, desc:"Pipe funèbre — grave et solennel"},
      {id:"bp_moorland",   name:"MOORLAND",         color:"#808860", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.26, droneGain:0.32, droneLPHz:240, vibratoRate:5.2, vibratoDepth:0.006, brightness:2600, nasalQ:2.2}, desc:"Lande écossaise — vent et horizon"},
      {id:"bp_northsea",   name:"NORTH SEA WIND",   color:"#5080b0", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.25, droneGain:0.25, droneLPHz:250, vibratoRate:8.0, vibratoDepth:0.012, brightness:2800, nasalQ:2.0}, desc:"Vent du Nord — vibrato turbulent"},
      // ── MÉDIÉVAL / RITUEL ─────────────────────────────────────────────────
      {id:"bp_medieval",   name:"MEDIEVAL REED",    color:"#806030", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.15, droneGain:0.45, droneLPHz:260, vibratoRate:5.8, vibratoDepth:0.007, brightness:2500, nasalQ:3.8}, desc:"Anche médiévale — très nasal, ancien"},
      {id:"bp_siege",      name:"CASTLE SIEGE",     color:"#a04020", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.16, droneGain:0.55, droneLPHz:380, vibratoRate:7.5, vibratoDepth:0.011, brightness:4000, nasalQ:4.0}, desc:"Siège de château — brutal, assiégeant"},
      {id:"bp_stone",      name:"STONE CIRCLE",     color:"#909090", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.27, droneGain:0.48, droneLPHz:200, vibratoRate:4.8, vibratoDepth:0.005, brightness:2200, nasalQ:2.6}, desc:"Cercle de pierres — rituel druidique"},
      {id:"bp_ancient",    name:"ANCIENT RITE",     color:"#704030", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.13, droneGain:0.52, droneLPHz:170, vibratoRate:4.2, vibratoDepth:0.004, brightness:1900, nasalQ:4.5}, desc:"Rite ancien — très nasal et grave"},
      {id:"bp_border",     name:"BORDER REIVER",    color:"#c08040", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.19, droneGain:0.38, droneLPHz:290, vibratoRate:6.2, vibratoDepth:0.008, brightness:3400, nasalQ:3.0}, desc:"Pillard frontalier — agressif et dur"},
      // ── GUERRE / COMBAT ───────────────────────────────────────────────────
      {id:"bp_bloodridge",  name:"BLOOD RIDGE",     color:"#880000", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.17, droneGain:0.60, droneLPHz:400, vibratoRate:7.8, vibratoDepth:0.012, brightness:5000, nasalQ:4.5}, desc:"Crête sanglante — cornemuse de charge"},
      {id:"bp_pipes",      name:"PIPES OF WAR",     color:"#c01010", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.20, droneGain:0.55, droneLPHz:350, vibratoRate:7.2, vibratoDepth:0.010, brightness:4200, nasalQ:3.8}, desc:"Pipes militaires — assaut en ligne"},
      {id:"bp_ironlung",   name:"IRON LUNG",        color:"#505060", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.12, droneGain:0.65, droneLPHz:420, vibratoRate:6.5, vibratoDepth:0.009, brightness:4800, nasalQ:5.0}, desc:"Poumon de fer — le plus dur, le plus nasal"},
      {id:"bp_highland2",  name:"HIGHLAND FLING",   color:"#50c050", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.23, droneGain:0.30, droneLPHz:260, vibratoRate:6.0, vibratoDepth:0.007, brightness:3600, nasalQ:2.5}, desc:"Danse highland — vif et dansant"},
      {id:"bp_gaelic",     name:"GAELIC WAIL",      color:"#e04080", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.29, droneGain:0.35, droneLPHz:230, vibratoRate:5.5, vibratoDepth:0.006, brightness:2100, nasalQ:2.3}, desc:"Lamentation gaélique — cri déchirant"},
      // ── VARIATIONS RÉGIONALES ─────────────────────────────────────────────
      {id:"bp_celtic",     name:"CELTIC DRONE",     color:"#40b0c0", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.35, droneGain:0.70, droneLPHz:160, vibratoRate:3.5, vibratoDepth:0.003, brightness:1600, nasalQ:1.2}, desc:"Drone celtique — bourdon très présent"},
      {id:"bp_scottish",   name:"SCOTTISH DRONE",   color:"#3080a0", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.22, droneGain:0.60, droneLPHz:200, vibratoRate:5.0, vibratoDepth:0.005, brightness:2800, nasalQ:2.4}, desc:"Drone écossais — mélodie dans le bourdon"},
      {id:"bp_northumb",   name:"NORTHUMBRIAN",     color:"#80a060", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.30, droneGain:0.22, droneLPHz:180, vibratoRate:4.8, vibratoDepth:0.005, brightness:2300, nasalQ:1.6}, desc:"Cornemuse northumbrienne — plus douce"},
      {id:"bp_uilleann",   name:"IRISH UILLEANN",   color:"#40a040", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.28, droneGain:0.28, droneLPHz:210, vibratoRate:5.2, vibratoDepth:0.006, brightness:2500, nasalQ:2.0}, desc:"Uilleann irlandaise — plus veloutée"},
      {id:"bp_islay",      name:"ISLAY MALT",       color:"#c0a860", atk:0.001, rel:0.10, engine:"BAGPIPES", params:{pulseWidth:0.24, droneGain:0.40, droneLPHz:240, vibratoRate:5.8, vibratoDepth:0.007, brightness:3000, nasalQ:2.2}, desc:"Île d'Islay — chaleureux comme le whisky"},
    ]
  },

  // ── OCTOBER — Drake / 40 : underwater muffled keys ──────────────────────────
  OCTOBER: {
    label:"🌙 OCTOBER", color:"#2040a0",
    presets:[
      // Très doux — pure sine, LP très fermé, aucun square
      {id:"oct_6am",      name:"6AM IN TORONTO",   color:"#1a2a6c", atk:0.10, rel:3.0, engine:"OCTOBER", params:{lpHz:380, lpQ:0.6, subMix:0.20, squareMix:0.0, detune:3}, desc:"Son signature de Drake — nuit très douce"},
      {id:"oct_marvins",  name:"MARVIN'S ROOM",    color:"#1a0a30", atk:0.18, rel:4.0, engine:"OCTOBER", params:{lpHz:320, lpQ:0.5, subMix:0.12, squareMix:0.0, detune:5}, desc:"Chambre sombre — sine pur, très étouffé"},
      {id:"oct_hold",     name:"HOLD ON WE GO",    color:"#304060", atk:0.14, rel:3.5, engine:"OCTOBER", params:{lpHz:420, lpQ:0.7, subMix:0.18, squareMix:0.0, detune:4}, desc:"Douceur totale — piano étouffé chaleureux"},
      {id:"oct_passi",    name:"PASSION FRUIT",    color:"#e08040", atk:0.09, rel:2.8, engine:"OCTOBER", params:{lpHz:520, lpQ:0.8, subMix:0.22, squareMix:0.0, detune:3}, desc:"Fruit de la passion — plus ouvert, encore doux"},
      {id:"oct_under",    name:"UNDERWATER KEYS",  color:"#0a1a40", atk:0.16, rel:4.2, engine:"OCTOBER", params:{lpHz:280, lpQ:0.5, subMix:0.15, squareMix:0.0, detune:6}, desc:"Complètement immergé — ultra muffled"},
      {id:"oct_float",    name:"MIDNIGHT FLOAT",   color:"#08080a", atk:0.20, rel:4.5, engine:"OCTOBER", params:{lpHz:300, lpQ:0.5, subMix:0.10, squareMix:0.0, detune:4}, desc:"3h du matin — quasi-silence, flottant"},
      {id:"oct_weston",   name:"WESTON ROAD",      color:"#283868", atk:0.10, rel:3.2, engine:"OCTOBER", params:{lpHz:450, lpQ:0.7, subMix:0.25, squareMix:0.0, detune:4}, desc:"Route nostalgique — sine plein et doux"},
      {id:"oct_softly",   name:"SOFTLY",           color:"#8090c0", atk:0.22, rel:4.8, engine:"OCTOBER", params:{lpHz:260, lpQ:0.4, subMix:0.08, squareMix:0.0, detune:5}, desc:"Murmure — le plus doux de la série"},
      {id:"oct_ovo",      name:"OVO KEYS",         color:"#c0a000", atk:0.08, rel:2.6, engine:"OCTOBER", params:{lpHz:500, lpQ:0.8, subMix:0.28, squareMix:0.0, detune:3}, desc:"Golden OVO — chaud et doré, encore étouffé"},
      {id:"oct_fromtime", name:"FROM TIME",        color:"#6070a0", atk:0.15, rel:3.8, engine:"OCTOBER", params:{lpHz:350, lpQ:0.6, subMix:0.16, squareMix:0.0, detune:4}, desc:"From Time — très intimiste, sine pur"},
      // Sub plus présent, légèrement plus de corps
      {id:"oct_views",    name:"VIEWS SUB",        color:"#203060", atk:0.06, rel:2.4, engine:"OCTOBER", params:{lpHz:480, lpQ:0.8, subMix:0.42, squareMix:0.0, detune:3}, desc:"Views — basse sub douce, piano effacé"},
      {id:"oct_gods",     name:"GODS PLAN",        color:"#d0a820", atk:0.08, rel:2.6, engine:"OCTOBER", params:{lpHz:550, lpQ:0.9, subMix:0.38, squareMix:0.0, detune:3}, desc:"Plan divin — sub chaud, lead doux"},
      {id:"oct_certified",name:"CERTIFIED",        color:"#c0c0c0", atk:0.07, rel:2.4, engine:"OCTOBER", params:{lpHz:580, lpQ:0.9, subMix:0.32, squareMix:0.0, detune:4}, desc:"Certifié lover boy — doux et plein"},
      {id:"oct_dark",     name:"DARK LANE",        color:"#0a0a14", atk:0.12, rel:3.4, engine:"OCTOBER", params:{lpHz:340, lpQ:0.6, subMix:0.20, squareMix:0.0, detune:5}, desc:"Voie sombre — profond et étouffé"},
      {id:"oct_sneaky",   name:"SNEAKIN",          color:"#202840", atk:0.08, rel:2.8, engine:"OCTOBER", params:{lpHz:410, lpQ:0.7, subMix:0.30, squareMix:0.0, detune:4}, desc:"Furtif — glisse sous le mix"},
      // Légèrement plus ouvert (maximum 650Hz) pour 5 presets
      {id:"oct_papi",     name:"PAPI PASSION",     color:"#2a2060", atk:0.07, rel:2.6, engine:"OCTOBER", params:{lpHz:600, lpQ:1.0, subMix:0.26, squareMix:0.0, detune:3}, desc:"Chaleur soul — le plus ouvert de la série"},
      {id:"oct_summer",   name:"SUMMER LOVE",      color:"#e0c060", atk:0.05, rel:2.2, engine:"OCTOBER", params:{lpHz:640, lpQ:1.0, subMix:0.22, squareMix:0.0, detune:3}, desc:"Été Toronto — léger et doux"},
      {id:"oct_blessed",  name:"BLESSED",          color:"#a08000", atk:0.06, rel:2.4, engine:"OCTOBER", params:{lpHz:620, lpQ:1.0, subMix:0.28, squareMix:0.0, detune:4}, desc:"Béni — gratitude, doux et lumineux"},
      {id:"oct_notice",   name:"NOTICE ME",        color:"#3050c0", atk:0.10, rel:3.0, engine:"OCTOBER", params:{lpHz:460, lpQ:0.8, subMix:0.18, squareMix:0.0, detune:4}, desc:"Notice me — introverti, effacé"},
      {id:"oct_4422",     name:"LOVE YOU ALWAYS",  color:"#2030a0", atk:0.09, rel:3.0, engine:"OCTOBER", params:{lpHz:400, lpQ:0.7, subMix:0.24, squareMix:0.0, detune:4}, desc:"Amour tranquille — chaleureux et doux"},
      // Detune plus large pour une couleur unique
      {id:"oct_choir",    name:"GHOST CHOIR",      color:"#4050c0", atk:0.14, rel:4.0, engine:"OCTOBER", params:{lpHz:360, lpQ:0.6, subMix:0.14, squareMix:0.0, detune:9}, desc:"Chœur fantôme — large et éthéré, étouffé"},
      {id:"oct_warm",     name:"WARM NIGHT",       color:"#c08050", atk:0.11, rel:3.2, engine:"OCTOBER", params:{lpHz:490, lpQ:0.8, subMix:0.30, squareMix:0.0, detune:6}, desc:"Nuit chaude — detuning doux et plein"},
      {id:"oct_haze",     name:"TORONTO HAZE",     color:"#708090", atk:0.18, rel:4.0, engine:"OCTOBER", params:{lpHz:320, lpQ:0.5, subMix:0.18, squareMix:0.0, detune:7}, desc:"Brume de Toronto — flou, étouffé, profond"},
      {id:"oct_slow",     name:"SLOW DOWN",        color:"#404878", atk:0.25, rel:5.0, engine:"OCTOBER", params:{lpHz:290, lpQ:0.5, subMix:0.10, squareMix:0.0, detune:5}, desc:"Ralentir — le plus lent et doux"},
      {id:"oct_came",     name:"CAME UP",          color:"#d0b040", atk:0.06, rel:2.2, engine:"OCTOBER", params:{lpHz:560, lpQ:0.9, subMix:0.35, squareMix:0.0, detune:3}, desc:"Je suis arrivé — sub présent, mélodie douce"},
    ]
  },

  // ── KDOT — Kendrick Lamar / West Coast G-Funk ────────────────────────────────
  KDOT: {
    label:"👑 KDOT", color:"#8b0000",
    presets:[
      // Pas de portamento (portaDur:0) — sons directs, West Coast pur
      {id:"kd_compton",   name:"COMPTON GFUNK",    color:"#8b0000", atk:0.04, rel:2.0, engine:"GFUNK", params:{detuneCents:14, portaDur:0.0, satAmount:1.8, lpHz:2200, lpQ:1.2, subMix:0.20}, desc:"G-Funk de Compton — classique Dre/Kendrick"},
      {id:"kd_humble",    name:"HUMBLE BASS",      color:"#400000", atk:0.03, rel:1.6, engine:"GFUNK", params:{detuneCents:5,  portaDur:0.0, satAmount:2.2, lpHz:1600, lpQ:0.9, subMix:0.38}, desc:"Sit down — basse grave, sature légère"},
      {id:"kd_damn",      name:"DAMN SAW",         color:"#d03000", atk:0.02, rel:1.2, engine:"GFUNK", params:{detuneCents:8,  portaDur:0.0, satAmount:3.2, lpHz:5000, lpQ:2.0, subMix:0.05}, desc:"DAMN — scie agressive, très brillant"},
      {id:"kd_nottf",     name:"NOT LIKE US",      color:"#ff2000", atk:0.01, rel:0.9, engine:"GFUNK", params:{detuneCents:4,  portaDur:0.0, satAmount:4.0, lpHz:7000, lpQ:2.5, subMix:0.00}, desc:"Not Like Us — le plus agressif et brillant"},
      {id:"kd_euphoria",  name:"EUPHORIA LEAD",    color:"#d08000", atk:0.02, rel:1.2, engine:"GFUNK", params:{detuneCents:6,  portaDur:0.0, satAmount:3.5, lpHz:4500, lpQ:2.2, subMix:0.05}, desc:"Euphorie — lead mordant et présent"},
      {id:"kd_element",   name:"ELEMENT",          color:"#e04000", atk:0.02, rel:1.3, engine:"GFUNK", params:{detuneCents:20, portaDur:0.0, satAmount:2.8, lpHz:3000, lpQ:1.6, subMix:0.10}, desc:"Element — detune large, mid saturé"},
      {id:"kd_wicked",    name:"WICKED",           color:"#401040", atk:0.03, rel:1.5, engine:"GFUNK", params:{detuneCents:25, portaDur:0.0, satAmount:2.0, lpHz:2000, lpQ:1.2, subMix:0.22}, desc:"Wicked — épais, sombre, west coast"},
      {id:"kd_crown",     name:"CROWN",            color:"#ffd700", atk:0.05, rel:2.0, engine:"GFUNK", params:{detuneCents:16, portaDur:0.0, satAmount:1.5, lpHz:2800, lpQ:1.3, subMix:0.14}, desc:"Couronne — large et chaud, TPAB vibes"},
      {id:"kd_alright",   name:"ALRIGHT",          color:"#20c040", atk:0.06, rel:2.2, engine:"GFUNK", params:{detuneCents:18, portaDur:0.0, satAmount:1.4, lpHz:2400, lpQ:1.1, subMix:0.18}, desc:"Alright — espoir, positif, grand"},
      // Portamento très court (0.04s) — léger glisse musical
      {id:"kd_kung",      name:"KUNG FU GLIDE",    color:"#e09020", atk:0.04, rel:1.8, engine:"GFUNK", params:{detuneCents:10, portaDur:0.04, satAmount:1.6, lpHz:3500, lpQ:1.5, subMix:0.12}, desc:"Kung Fu Kenny — glisse court et musical"},
      {id:"kd_count",     name:"COUNT ME OUT",     color:"#a02020", atk:0.03, rel:1.4, engine:"GFUNK", params:{detuneCents:7,  portaDur:0.04, satAmount:2.6, lpHz:3800, lpQ:1.8, subMix:0.10}, desc:"Count me out — direct, petit glisse"},
      // Sons doux/soul — detune large, saturation basse, LP bas
      {id:"kd_butterfly", name:"BUTTERFLY KEYS",   color:"#6040c0", atk:0.14, rel:3.2, engine:"GFUNK", params:{detuneCents:22, portaDur:0.0, satAmount:0.9, lpHz:1400, lpQ:0.8, subMix:0.12}, desc:"To Pimp a Butterfly — jazz soul doux"},
      {id:"kd_mortal",    name:"MORTAL MAN",       color:"#304080", atk:0.18, rel:3.5, engine:"GFUNK", params:{detuneCents:28, portaDur:0.0, satAmount:0.7, lpHz:1200, lpQ:0.7, subMix:0.08}, desc:"Mortal Man — épique et lent, large"},
      {id:"kd_mother",    name:"MOTHER I SOBER",   color:"#c0a080", atk:0.20, rel:4.0, engine:"GFUNK", params:{detuneCents:30, portaDur:0.0, satAmount:0.6, lpHz:1000, lpQ:0.6, subMix:0.06}, desc:"Intimité totale — le plus doux"},
      {id:"kd_sing",      name:"SING ABOUT ME",    color:"#6080a0", atk:0.16, rel:3.8, engine:"GFUNK", params:{detuneCents:24, portaDur:0.0, satAmount:0.8, lpHz:1500, lpQ:0.8, subMix:0.10}, desc:"Chante pour moi — mélancolique"},
      {id:"kd_poetic",    name:"POETIC JUSTICE",   color:"#c080e0", atk:0.10, rel:2.8, engine:"GFUNK", params:{detuneCents:20, portaDur:0.0, satAmount:1.1, lpHz:1800, lpQ:1.0, subMix:0.18}, desc:"Justice poétique — romantique, soul"},
      // Vinyl / sample-flip vibe — saturation + LP medium
      {id:"kd_vinyl",     name:"VINYL WEST",       color:"#704020", atk:0.08, rel:2.4, engine:"GFUNK", params:{detuneCents:16, portaDur:0.0, satAmount:2.5, lpHz:1800, lpQ:0.9, subMix:0.22}, desc:"Vinyle West Coast — sample vibe chaud"},
      {id:"kd_good",      name:"GOOD KID",         color:"#805030", atk:0.06, rel:2.2, engine:"GFUNK", params:{detuneCents:12, portaDur:0.0, satAmount:1.8, lpHz:2000, lpQ:1.0, subMix:0.16}, desc:"Good Kid — chaleureux, narratif"},
      {id:"kd_mirror",    name:"MIRROR",           color:"#80a0c0", atk:0.12, rel:2.8, engine:"GFUNK", params:{detuneCents:18, portaDur:0.0, satAmount:1.2, lpHz:1700, lpQ:0.9, subMix:0.14}, desc:"Mirror — introspectif, pur"},
      {id:"kd_rich",      name:"RICH SPIRIT",      color:"#e0c000", atk:0.04, rel:1.8, engine:"GFUNK", params:{detuneCents:10, portaDur:0.0, satAmount:2.0, lpHz:2600, lpQ:1.4, subMix:0.16}, desc:"Rich Spirit — confiant, G-Funk moderne"},
      // Sons sub-bass dominants
      {id:"kd_maad",      name:"MAAD CITY",        color:"#202020", atk:0.03, rel:1.5, engine:"GFUNK", params:{detuneCents:6,  portaDur:0.0, satAmount:2.4, lpHz:2200, lpQ:1.3, subMix:0.30}, desc:"M.A.A.D City — urbain, sub tendu"},
      {id:"kd_swim",      name:"SWIM LANES",       color:"#004080", atk:0.07, rel:2.0, engine:"GFUNK", params:{detuneCents:14, portaDur:0.0, satAmount:1.7, lpHz:2400, lpQ:1.2, subMix:0.26}, desc:"Swimming lanes — sub fluide"},
      {id:"kd_duckworth", name:"DUCKWORTH",        color:"#905020", atk:0.04, rel:1.7, engine:"GFUNK", params:{detuneCents:9,  portaDur:0.0, satAmount:2.1, lpHz:2200, lpQ:1.1, subMix:0.20}, desc:"Duckworth — boucle la saga DAMN"},
      {id:"kd_nle",       name:"COMPTON NIGHTS",   color:"#0a0a20", atk:0.06, rel:2.2, engine:"GFUNK", params:{detuneCents:15, portaDur:0.0, satAmount:1.9, lpHz:2000, lpQ:1.0, subMix:0.24}, desc:"Nuits de Compton — nostalgique, sub"},
      {id:"kd_dna",       name:"DNA LEAD",         color:"#c04040", atk:0.02, rel:1.2, engine:"GFUNK", params:{detuneCents:4,  portaDur:0.0, satAmount:3.8, lpHz:6000, lpQ:2.0, subMix:0.08}, desc:"DNA — lead perçant, très saturé"},
    ]
  },

  // ── STARBOY — The Weeknd / 80s Synthwave SuperSaw ────────────────────────────
  STARBOY: {
    label:"⭐ STARBOY", color:"#c0003c",
    presets:[
      // Thin / clean (3 saws, peu de detune)
      {id:"sb_trilogy",   name:"TRILOGY SAW",      color:"#202020", atk:0.03, rel:1.8, engine:"SUPERSAW", params:{detuneCents:8,  numSaws:3, satAmount:1.2, lpHz:6000, lpQ:1.6}, desc:"Trilogy — 3 saws, son pur et froid"},
      {id:"sb_heartless", name:"HEARTLESS",        color:"#101010", atk:0.02, rel:1.4, engine:"SUPERSAW", params:{detuneCents:6,  numSaws:3, satAmount:2.0, lpHz:8000, lpQ:2.0}, desc:"Heartless — 3 saws brillants, minimal"},
      {id:"sb_sacrifice", name:"SACRIFICE",        color:"#ff0040", atk:0.01, rel:1.2, engine:"SUPERSAW", params:{detuneCents:6,  numSaws:3, satAmount:3.0, lpHz:12000,lpQ:2.5}, desc:"Sacrifice — 3 saws percutants, très aigu"},
      {id:"sb_gasoline",  name:"GASOLINE",         color:"#e08000", atk:0.02, rel:1.4, engine:"SUPERSAW", params:{detuneCents:10, numSaws:3, satAmount:2.8, lpHz:10000,lpQ:2.2}, desc:"Gasoline — brûlant, 3 saws saturés"},
      {id:"sb_take",      name:"TAKE MY BREATH",   color:"#40c0e0", atk:0.02, rel:1.6, engine:"SUPERSAW", params:{detuneCents:10, numSaws:3, satAmount:2.2, lpHz:9000, lpQ:1.8}, desc:"Take My Breath — électrisant, fin"},
      // Medium (5 saws, detune moyen)
      {id:"sb_blinding",  name:"BLINDING LIGHTS",  color:"#ff2060", atk:0.02, rel:2.0, engine:"SUPERSAW", params:{detuneCents:16, numSaws:5, satAmount:1.8, lpHz:5000, lpQ:1.5}, desc:"Blinding Lights — 5 saws, classique 80s"},
      {id:"sb_dawn",      name:"DAWN FM",          color:"#ff8000", atk:0.04, rel:2.2, engine:"SUPERSAW", params:{detuneCents:14, numSaws:5, satAmount:1.5, lpHz:4500, lpQ:1.4}, desc:"Dawn FM — 5 saws propres, radio 80s"},
      {id:"sb_moth",      name:"MOTH TO FLAME",    color:"#ffff00", atk:0.03, rel:1.8, engine:"SUPERSAW", params:{detuneCents:20, numSaws:5, satAmount:2.0, lpHz:6500, lpQ:1.8}, desc:"Moth to Flame — 5 saws, brillant"},
      {id:"sb_lead",      name:"STARBOY LEAD",     color:"#ffd700", atk:0.02, rel:1.8, engine:"SUPERSAW", params:{detuneCents:12, numSaws:5, satAmount:2.4, lpHz:7000, lpQ:2.0}, desc:"Starboy Lead — 5 saws, lumineux, devant"},
      {id:"sb_save",      name:"SAVE YOUR TEARS",  color:"#4080c0", atk:0.04, rel:2.4, engine:"SUPERSAW", params:{detuneCents:18, numSaws:5, satAmount:1.6, lpHz:4000, lpQ:1.4}, desc:"Save Your Tears — 5 saws émouvants"},
      {id:"sb_die",       name:"DIE FOR YOU",      color:"#c00000", atk:0.06, rel:2.8, engine:"SUPERSAW", params:{detuneCents:22, numSaws:5, satAmount:1.4, lpHz:3500, lpQ:1.2}, desc:"Die For You — 5 saws émotionnel"},
      {id:"sb_double",    name:"DOUBLE FANTASY",   color:"#ff60c0", atk:0.04, rel:2.2, engine:"SUPERSAW", params:{detuneCents:16, numSaws:5, satAmount:1.9, lpHz:5000, lpQ:1.5}, desc:"Double Fantasy — 5 saws romantique"},
      // Full SuperSaw (7 saws, detune large)
      {id:"sb_xo",        name:"XO SERUM",         color:"#e040a0", atk:0.04, rel:2.4, engine:"SUPERSAW", params:{detuneCents:20, numSaws:7, satAmount:2.0, lpHz:5000, lpQ:1.6}, desc:"XO Serum — 7 saws, mur de son moderne"},
      {id:"sb_neon",      name:"NEON BLADE",       color:"#00e8ff", atk:0.03, rel:2.2, engine:"SUPERSAW", params:{detuneCents:25, numSaws:7, satAmount:2.2, lpHz:6500, lpQ:1.8}, desc:"Neon Blade — 7 saws tranchants, brillant"},
      {id:"sb_cyber",     name:"CYBER ROMANCE",    color:"#8000ff", atk:0.08, rel:3.0, engine:"SUPERSAW", params:{detuneCents:30, numSaws:7, satAmount:1.2, lpHz:3500, lpQ:1.1}, desc:"Romance cybernétique — 7 saws pad large"},
      {id:"sb_kiss",      name:"KISS LAND",        color:"#300020", atk:0.10, rel:3.5, engine:"SUPERSAW", params:{detuneCents:35, numSaws:7, satAmount:0.9, lpHz:2500, lpQ:0.9}, desc:"Kiss Land — 7 saws très sombre, épais"},
      {id:"sb_loft",      name:"LOFT MUSIC",       color:"#604060", atk:0.12, rel:3.8, engine:"SUPERSAW", params:{detuneCents:32, numSaws:7, satAmount:0.8, lpHz:2000, lpQ:0.8}, desc:"Loft Music — 7 saws le plus doux"},
      {id:"sb_after",     name:"AFTER HOURS",      color:"#800020", atk:0.07, rel:3.2, engine:"SUPERSAW", params:{detuneCents:28, numSaws:7, satAmount:1.1, lpHz:2800, lpQ:1.0}, desc:"After Hours — 7 saws sombre, profond"},
      {id:"sb_belong",    name:"I BELONG TO YOU",  color:"#e080c0", atk:0.08, rel:3.0, engine:"SUPERSAW", params:{detuneCents:24, numSaws:7, satAmount:1.4, lpHz:3800, lpQ:1.3}, desc:"I Belong to You — 7 saws romantique"},
      {id:"sb_beauty",    name:"BEAUTY BEHIND",    color:"#c060c0", atk:0.06, rel:2.8, engine:"SUPERSAW", params:{detuneCents:22, numSaws:7, satAmount:1.6, lpHz:4000, lpQ:1.4}, desc:"Beauty Behind Madness — 7 saws équilibré"},
      {id:"sb_stargirl",  name:"STARGIRL",         color:"#a0c0ff", atk:0.10, rel:3.2, engine:"SUPERSAW", params:{detuneCents:26, numSaws:7, satAmount:1.0, lpHz:3000, lpQ:1.0}, desc:"Stargirl Interlude — 7 saws céleste"},
      {id:"sb_sidewalk",  name:"SIDEWALKS",        color:"#606060", atk:0.09, rel:3.0, engine:"SUPERSAW", params:{detuneCents:28, numSaws:7, satAmount:1.2, lpHz:2600, lpQ:0.9}, desc:"Sidewalks — 7 saws gris, urbain"},
      {id:"sb_in_good",   name:"IN GOOD HANDS",    color:"#80e0a0", atk:0.12, rel:3.4, engine:"SUPERSAW", params:{detuneCents:30, numSaws:7, satAmount:1.0, lpHz:3000, lpQ:1.0}, desc:"In Good Hands — 7 saws rassurant"},
      {id:"sb_neon2",     name:"NEON ANGELS",      color:"#ff40ff", atk:0.05, rel:2.6, engine:"SUPERSAW", params:{detuneCents:22, numSaws:7, satAmount:1.8, lpHz:4500, lpQ:1.6}, desc:"Neon Angels — 7 saws épuré et brillant"},
      {id:"sb_lostwaves", name:"LOST IN WAVES",    color:"#ff6000", atk:0.14, rel:4.0, engine:"SUPERSAW", params:{detuneCents:35, numSaws:7, satAmount:0.7, lpHz:1800, lpQ:0.7}, desc:"Lost in Waves — 7 saws le plus immersif"},
    ]
  },

  // ── ASTRO — Travis Scott : distorted flute + LFO wobble ─────────────────────
  // wobbleDepth = ratio de la freq (0.008 = ±0.8%) — NE PAS mettre >0.03
  // bitSteps : 128=quasi-propre, 48=léger, 16=dégradé, 6=très crade
  // distAmount : 1.0=léger, 2.0=moyen, 3.5=fort
  ASTRO: {
    label:"🌵 ASTRO", color:"#8b4513",
    presets:[
      // Sons musicaux / signature Travis — wobble subtil, distorsion légère à moyenne
      {id:"as_goosebumps", name:"GOOSEBUMPS FLUTE", color:"#8b4513", atk:0.03, rel:2.2, engine:"ASTRO", params:{wobbleRate:3.5, wobbleDepth:0.012, bitSteps:96, distAmount:1.4, lpHz:3500, lpQ:1.4}, desc:"Goosebumps — flûte distordue signature Travis"},
      {id:"as_antidote",  name:"ANTIDOTE",          color:"#60a000", atk:0.04, rel:2.0, engine:"ASTRO", params:{wobbleRate:4.0, wobbleDepth:0.008, bitSteps:128,distAmount:1.0, lpHz:4500, lpQ:1.2}, desc:"Antidote — le plus propre, léger wobble"},
      {id:"as_highest",   name:"HIGHEST IN ROOM",   color:"#c0c000", atk:0.06, rel:2.8, engine:"ASTRO", params:{wobbleRate:2.0, wobbleDepth:0.015, bitSteps:96, distAmount:1.2, lpHz:3000, lpQ:1.1}, desc:"Highest in the Room — planant, rêveur"},
      {id:"as_star",      name:"STARGAZING",        color:"#0030a0", atk:0.10, rel:3.5, engine:"ASTRO", params:{wobbleRate:1.5, wobbleDepth:0.018, bitSteps:128,distAmount:0.9, lpHz:2500, lpQ:1.0}, desc:"Stargazing — très lent, flottant, éthéré"},
      {id:"as_bebe",      name:"BEBE",              color:"#ff80a0", atk:0.06, rel:2.4, engine:"ASTRO", params:{wobbleRate:3.0, wobbleDepth:0.010, bitSteps:96, distAmount:1.3, lpHz:3200, lpQ:1.3}, desc:"Bebe — flûte romantique, doux wobble"},
      {id:"as_butterfly2",name:"BUTTERFLY EFFECT",  color:"#604080", atk:0.05, rel:2.4, engine:"ASTRO", params:{wobbleRate:2.5, wobbleDepth:0.014, bitSteps:80, distAmount:1.5, lpHz:3500, lpQ:1.4}, desc:"Butterfly Effect — instable et beau"},
      {id:"as_way",       name:"WAY BACK",          color:"#4060c0", atk:0.08, rel:3.0, engine:"ASTRO", params:{wobbleRate:2.2, wobbleDepth:0.012, bitSteps:96, distAmount:1.1, lpHz:2800, lpQ:1.0}, desc:"Way Back — nostalgique, chaleureux"},
      {id:"as_houstonia", name:"HOUSTONIA",         color:"#804000", atk:0.05, rel:2.6, engine:"ASTRO", params:{wobbleRate:2.8, wobbleDepth:0.010, bitSteps:80, distAmount:1.4, lpHz:2600, lpQ:1.1}, desc:"Houston — chaleureux, vibrato lent"},
      // Sons plus distordus / énergiques
      {id:"as_utopia",    name:"UTOPIA LEAD",       color:"#e08000", atk:0.02, rel:1.8, engine:"ASTRO", params:{wobbleRate:4.5, wobbleDepth:0.015, bitSteps:48, distAmount:2.0, lpHz:5000, lpQ:1.6}, desc:"Utopia — lead mordant, plus dégradé"},
      {id:"as_night",     name:"NIGHTCRAWLER",      color:"#200020", atk:0.04, rel:2.4, engine:"ASTRO", params:{wobbleRate:3.0, wobbleDepth:0.018, bitSteps:48, distAmount:1.8, lpHz:2800, lpQ:1.3}, desc:"Nightcrawler — sombre, medium bitcrush"},
      {id:"as_cactus",    name:"CACTUS JACK",       color:"#c06000", atk:0.02, rel:1.6, engine:"ASTRO", params:{wobbleRate:5.0, wobbleDepth:0.014, bitSteps:32, distAmount:2.4, lpHz:5500, lpQ:1.8}, desc:"Cactus Jack — agité, bitcrush moyen"},
      {id:"as_escape",    name:"ESCAPE PLAN",       color:"#402060", atk:0.03, rel:1.8, engine:"ASTRO", params:{wobbleRate:4.2, wobbleDepth:0.012, bitSteps:32, distAmount:2.2, lpHz:4500, lpQ:1.6}, desc:"Escape Plan — breakout, distorsion franche"},
      {id:"as_lose",      name:"LOSE",              color:"#e04040", atk:0.02, rel:1.5, engine:"ASTRO", params:{wobbleRate:5.0, wobbleDepth:0.010, bitSteps:24, distAmount:2.6, lpHz:6000, lpQ:2.0}, desc:"Lose — énergique, agressif"},
      {id:"as_coords",    name:"COORDINATES",       color:"#0080c0", atk:0.03, rel:2.0, engine:"ASTRO", params:{wobbleRate:3.8, wobbleDepth:0.016, bitSteps:48, distAmount:1.8, lpHz:4000, lpQ:1.5}, desc:"Coordonnées — signal légèrement brouillé"},
      {id:"as_portal",    name:"PORTAL",            color:"#00c0c0", atk:0.02, rel:1.6, engine:"ASTRO", params:{wobbleRate:5.5, wobbleDepth:0.013, bitSteps:24, distAmount:2.4, lpHz:5000, lpQ:1.8}, desc:"Portal — glitchy, futur, agressif"},
      // Sons sub / basses
      {id:"as_sicko",     name:"SICKO MODE",        color:"#400000", atk:0.03, rel:2.0, engine:"ASTRO", params:{wobbleRate:2.0, wobbleDepth:0.008, bitSteps:64, distAmount:2.0, lpHz:2000, lpQ:1.0}, desc:"Sicko Mode — sub grave, distorsion lourde"},
      {id:"as_wave",      name:"WAVE",              color:"#0040e0", atk:0.12, rel:3.5, engine:"ASTRO", params:{wobbleRate:1.8, wobbleDepth:0.020, bitSteps:128,distAmount:0.8, lpHz:2200, lpQ:0.9}, desc:"Wave — surf lent, méditatif, pur"},
      {id:"as_moon",      name:"MOON PHASE",        color:"#c0c0e0", atk:0.14, rel:4.0, engine:"ASTRO", params:{wobbleRate:1.2, wobbleDepth:0.022, bitSteps:128,distAmount:0.7, lpHz:1800, lpQ:0.8}, desc:"Phase lunaire — très doux, le plus lent"},
      {id:"as_dream",     name:"DREAMLAND",         color:"#8080e0", atk:0.10, rel:3.2, engine:"ASTRO", params:{wobbleRate:2.0, wobbleDepth:0.016, bitSteps:96, distAmount:1.0, lpHz:2400, lpQ:0.9}, desc:"Dreamland — éthéré, flottant"},
      // Sons extrêmes / signature crade (quelques-uns seulement)
      {id:"as_rodeo",     name:"RODEO",             color:"#a04000", atk:0.02, rel:1.2, engine:"ASTRO", params:{wobbleRate:6.0, wobbleDepth:0.018, bitSteps:16, distAmount:3.0, lpHz:6000, lpQ:2.2}, desc:"Rodeo — agressif, bitcrush fort"},
      {id:"as_pick",      name:"PICK UP THE PHONE", color:"#20c020", atk:0.01, rel:1.2, engine:"ASTRO", params:{wobbleRate:6.5, wobbleDepth:0.010, bitSteps:12, distAmount:3.2, lpHz:7000, lpQ:2.5}, desc:"Pick Up the Phone — très crade"},
      {id:"as_drugs",     name:"DRUGS YOU",         color:"#a080c0", atk:0.02, rel:1.4, engine:"ASTRO", params:{wobbleRate:4.5, wobbleDepth:0.020, bitSteps:20, distAmount:2.8, lpHz:4500, lpQ:1.8}, desc:"Drugs You — altéré, détraqué"},
      {id:"as_jackboys",  name:"JACKBOYS",          color:"#ffff00", atk:0.01, rel:1.0, engine:"ASTRO", params:{wobbleRate:7.0, wobbleDepth:0.012, bitSteps:8,  distAmount:3.5, lpHz:8000, lpQ:3.0}, desc:"Jack Boys — maximum bitcrush"},
      {id:"as_kratos",    name:"KRATOS",            color:"#cc0000", atk:0.01, rel:1.0, engine:"ASTRO", params:{wobbleRate:7.5, wobbleDepth:0.008, bitSteps:6,  distAmount:4.0, lpHz:9000, lpQ:2.8}, desc:"Kratos — destruction totale du signal"},
      {id:"as_astrotheme",name:"ASTRO THEME",       color:"#e0a000", atk:0.04, rel:2.2, engine:"ASTRO", params:{wobbleRate:3.5, wobbleDepth:0.013, bitSteps:64, distAmount:1.6, lpHz:3500, lpQ:1.4}, desc:"Astro Theme — signature Travis, équilibré"},
    ]
  },

  // ── YEEZY — Kanye West : 3 modes Soul-Chop / Industrial / Donda ─────────────
  YEEZY: {
    label:"🎹 YEEZY", color:"#c8a000",
    presets:[
      // mode:0 — Soul-Chop HP triangle (College Dropout / Late Registration era)
      {id:"yz_wire",      name:"THROUGH THE WIRE", color:"#d4a017", atk:0.05, rel:2.0, engine:"YEEZY", params:{mode:0, satAmount:1.2, lpHz:4000, lpQ:1.2, subMix:0.10, hpHz:300}, desc:"Through the Wire — soul chop signature"},
      {id:"yz_dropout",   name:"COLLEGE DROPOUT",  color:"#c09020", atk:0.06, rel:2.4, engine:"YEEZY", params:{mode:0, satAmount:1.0, lpHz:3500, lpQ:1.0, subMix:0.08, hpHz:250}, desc:"College Dropout — chaleureux et pur"},
      {id:"yz_diamonds",  name:"DIAMONDS",         color:"#a0d0ff", atk:0.08, rel:2.8, engine:"YEEZY", params:{mode:0, satAmount:0.8, lpHz:3000, lpQ:0.9, subMix:0.06, hpHz:200}, desc:"Diamonds from Sierra Leone — brillant"},
      {id:"yz_gold",      name:"GOLD DIGGER",      color:"#ffd700", atk:0.04, rel:1.8, engine:"YEEZY", params:{mode:0, satAmount:1.4, lpHz:4500, lpQ:1.4, subMix:0.12, hpHz:350}, desc:"Gold Digger — soul funk, plus brillant"},
      {id:"yz_heard",     name:"HEARD EM SAY",     color:"#e0c080", atk:0.10, rel:3.0, engine:"YEEZY", params:{mode:0, satAmount:0.9, lpHz:2800, lpQ:0.9, subMix:0.07, hpHz:220}, desc:"Heard Em Say — intimité, piano doux"},
      {id:"yz_roses",     name:"ROSES",            color:"#ff80a0", atk:0.12, rel:3.2, engine:"YEEZY", params:{mode:0, satAmount:0.7, lpHz:2600, lpQ:0.8, subMix:0.05, hpHz:180}, desc:"Roses — le plus doux, le plus émouvant"},
      {id:"yz_flashing",  name:"FLASHING LIGHTS",  color:"#ff40ff", atk:0.03, rel:1.6, engine:"YEEZY", params:{mode:0, satAmount:1.6, lpHz:5000, lpQ:1.6, subMix:0.14, hpHz:400}, desc:"Flashing Lights — éclatant, Graduation"},
      {id:"yz_stronger",  name:"STRONGER KEYS",    color:"#8080ff", atk:0.02, rel:1.4, engine:"YEEZY", params:{mode:0, satAmount:1.8, lpHz:5500, lpQ:1.8, subMix:0.15, hpHz:450}, desc:"Stronger — clavier Daft Punk soul-chop"},
      // mode:1 — Industrial asymmetric square (Yeezus / Black Skinhead era)
      // Chaque preset différent par lpHz (600→9000) et satAmount (1.5→5.0)
      {id:"yz_skinhead",  name:"BLACK SKINHEAD",   color:"#1a1a1a", atk:0.01, rel:0.8, engine:"YEEZY", params:{mode:1, satAmount:5.0, lpHz:9000, lpQ:3.5, subMix:0.00, hpHz:0}, desc:"Black Skinhead — max sat, très brillant, brutal"},
      {id:"yz_sight",     name:"ON SIGHT",         color:"#303030", atk:0.01, rel:0.7, engine:"YEEZY", params:{mode:1, satAmount:4.5, lpHz:7000, lpQ:3.0, subMix:0.00, hpHz:0}, desc:"On Sight — très aigu, presque criard"},
      {id:"yz_send",      name:"SEND IT UP",       color:"#c01020", atk:0.01, rel:0.9, engine:"YEEZY", params:{mode:1, satAmount:4.0, lpHz:5000, lpQ:2.5, subMix:0.00, hpHz:0}, desc:"Send It Up — mid-high brillant, club"},
      {id:"yz_new",       name:"NEW SLAVES",       color:"#202020", atk:0.02, rel:1.2, engine:"YEEZY", params:{mode:1, satAmount:3.0, lpHz:2500, lpQ:1.8, subMix:0.00, hpHz:0}, desc:"New Slaves — mid-range sombre, lourd"},
      {id:"yz_blood",     name:"BLOOD ON LEAVES",  color:"#800000", atk:0.03, rel:1.6, engine:"YEEZY", params:{mode:1, satAmount:2.0, lpHz:1200, lpQ:1.4, subMix:0.10, hpHz:0}, desc:"Blood on Leaves — foncé et grave, avec sub"},
      {id:"yz_guilt",     name:"GUILT TRIP",       color:"#402040", atk:0.02, rel:1.4, engine:"YEEZY", params:{mode:1, satAmount:2.5, lpHz:3500, lpQ:2.0, subMix:0.00, hpHz:0}, desc:"Guilt Trip — mid-high, tension intermédiaire"},
      {id:"yz_hold",      name:"HOLD MY LIQUOR",   color:"#501020", atk:0.05, rel:2.0, engine:"YEEZY", params:{mode:1, satAmount:1.8, lpHz:800,  lpQ:1.2, subMix:0.15, hpHz:0}, desc:"Hold My Liquor — très grave et filtré, lent"},
      {id:"yz_bound",     name:"BOUND 2",          color:"#604020", atk:0.04, rel:1.8, engine:"YEEZY", params:{mode:1, satAmount:1.5, lpHz:600,  lpQ:1.0, subMix:0.20, hpHz:0}, desc:"Bound 2 — le plus doux mode:1, presque soul"},
      // mode:2 — Donda cathedral sine+sub (Donda / 808s era)
      {id:"yz_moon",      name:"MOON KEYS",        color:"#e0e8ff", atk:0.15, rel:4.0, engine:"YEEZY", params:{mode:2, satAmount:1.0, lpHz:2500, lpQ:0.8, subMix:0.30, hpHz:0}, desc:"Moon Keys — cathédrale Donda, pur sine"},
      {id:"yz_jail",      name:"JAIL SUB",         color:"#202040", atk:0.08, rel:3.0, engine:"YEEZY", params:{mode:2, satAmount:1.2, lpHz:2000, lpQ:0.9, subMix:0.50, hpHz:0}, desc:"Jail — sub énorme, sine minimal"},
      {id:"yz_carnival",  name:"CARNIVAL ORGAN",   color:"#e04060", atk:0.05, rel:2.2, engine:"YEEZY", params:{mode:2, satAmount:1.5, lpHz:3000, lpQ:1.1, subMix:0.20, hpHz:0}, desc:"Carnival — orgue Donda, plus chaud"},
      {id:"yz_heaven",    name:"HEAVEN GATE",      color:"#ffffd0", atk:0.20, rel:5.0, engine:"YEEZY", params:{mode:2, satAmount:0.6, lpHz:1800, lpQ:0.7, subMix:0.15, hpHz:0}, desc:"Heaven Gate — le plus éthéré, très lent"},
      {id:"yz_rumi",      name:"RUMI LULLABY",     color:"#c0e0ff", atk:0.18, rel:4.5, engine:"YEEZY", params:{mode:2, satAmount:0.8, lpHz:2200, lpQ:0.8, subMix:0.18, hpHz:0}, desc:"Rumi 1 and 2 — berceuse de Donda"},
      {id:"yz_donda",     name:"DONDA CHANT",      color:"#808080", atk:0.12, rel:3.5, engine:"YEEZY", params:{mode:2, satAmount:1.1, lpHz:2400, lpQ:0.9, subMix:0.35, hpHz:0}, desc:"Chant Donda — rituel, sine+sub"},
      {id:"yz_24",        name:"24",               color:"#ffffff", atk:0.25, rel:5.5, engine:"YEEZY", params:{mode:2, satAmount:0.5, lpHz:1600, lpQ:0.7, subMix:0.12, hpHz:0}, desc:"24 — le plus pur, gospel sine"},
      {id:"yz_come",      name:"COME TO LIFE",     color:"#ffd0a0", atk:0.14, rel:4.0, engine:"YEEZY", params:{mode:2, satAmount:0.9, lpHz:2600, lpQ:0.9, subMix:0.25, hpHz:0}, desc:"Come to Life — épique, montée Donda"},
      {id:"yz_believe",   name:"I BELIEVE",        color:"#d0c0e0", atk:0.10, rel:3.2, engine:"YEEZY", params:{mode:2, satAmount:1.0, lpHz:2300, lpQ:0.8, subMix:0.28, hpHz:0}, desc:"I Believe — foi, dernier preset Yeezy"},
    ]
  },

  // ── GIVEON — R&B sombre : soul, gospel, neo-soul, cinématique, intime ────────
  GIVEON: {
    label:"🌑 GIVEON", color:"#2c1654",
    presets:[
      {id:"gv_heartbreak", name:"HEARTBREAK ANNIV", color:"#2c1654", atk:0.05, rel:2.5, engine:"JOLA_EP",   params:{tremoloRate:3.5, tremoloDepth:0.06, detuneCents:3,  lpHz:1400, lpQ:1.0, clickAmount:0.12, decayTime:2.0,  sustainLevel:0.25, warmth:1.5},                   desc:"Heartbreak Anniversary — EP sombre et intime"},
      {id:"gv_gospel",     name:"GOSPEL SINE",      color:"#4a2060", atk:0.10, rel:3.0, engine:"SCIFI",     params:{modRatio:1.5,  modIndex:1.0, lfoFreq:0.3,  lpQ:2.0, lfoDepth:0.5},                                                                                         desc:"Gospel FM — chaleur soul harmonique douce"},
      {id:"gv_soul_pad",   name:"SOUL PAD",         color:"#1a0a30", atk:0.30, rel:3.5, engine:"VAPOR",     params:{detuneCents:8,  lpStart:400,  lpEnd:2000,  sweepTime:2.5, vibRate:0.2,  waveType:"sine"},                                                                    desc:"Pad soul lent — sweep chaleureux et profond"},
      {id:"gv_deep_muff",  name:"DEEP MUFFLED",     color:"#0a0520", atk:0.12, rel:3.8, engine:"OCTOBER",   params:{lpHz:350,  lpQ:0.6,  subMix:0.40, squareMix:0.0,  detune:5},                                                                                                desc:"Profondeur R&B — très étouffé, sub dominant"},
      {id:"gv_soul_pluck", name:"SOUL PLUCK",       color:"#3a1540", atk:0.01, rel:2.0, engine:"SAMURAI",   params:{pluckDecay:0.8,  resonance:6,  harmMix:0.30},                                                                                                               desc:"Pluck soul — corps chaud, long decay"},
      {id:"gv_neo_str",    name:"NEO STRINGS",      color:"#4030a0", atk:0.20, rel:2.8, engine:"PIRATES",   params:{detuneCents:15, vibRate:3.5,  vibDepth:0.007, bpQ:1.5},                                                                                                     desc:"Cordes neo-soul — vibrato doux sur bandpass"},
      {id:"gv_like_you",   name:"LIKE I WANT YOU",  color:"#180830", atk:0.04, rel:2.2, engine:"BASS808",   params:{slideFrom:1.0,  slideDur:0.001, distAmount:1.0, slideTarget:1.0, subMix:0.0},                                                                               desc:"Like I Want You — 808 propre, grave, sans slide"},
      {id:"gv_dark_choir", name:"DARK CHOIR",       color:"#2a1060", atk:0.25, rel:3.2, engine:"VIKINGS",   params:{detuneCents:12, subGain:0.20, lpFreq:1200, saturation:1.0, waves:3},                                                                                         desc:"Choeur sombre — 3 saws doux désaccordés"},
      {id:"gv_drift_silk", name:"DRIFT SILK",       color:"#201030", atk:0.40, rel:4.0, engine:"HORROR",    params:{modRatio:1.005, driftAmount:0.003, bitSteps:64, lpFreq:2000, lpQ:1.2},                                                                                      desc:"Soie driftante — texture cinématique très subtile"},
      {id:"gv_orch_dark",  name:"ORCHESTRAL DARK",  color:"#1a0840", atk:0.35, rel:3.5, engine:"SUPERSAW",  params:{detuneCents:28, numSaws:7,   satAmount:0.5, lpHz:1800, lpQ:0.7},                                                                                             desc:"Cordes orchestrales — 7 saws épais et sombres"},
      {id:"gv_dark_organ", name:"DARK ORGAN",       color:"#3c2060", atk:0.06, rel:2.5, engine:"BAGPIPES",  params:{pulseWidth:0.45, droneGain:0.15, droneLPHz:120, vibratoRate:2.5, vibratoDepth:0.003, brightness:1800, nasalQ:1.0},                                          desc:"Orgue sombre — pulse large, drone grave doux"},
      {id:"gv_neo_lead",   name:"NEO SOUL LEAD",    color:"#5a2080", atk:0.05, rel:2.0, engine:"GFUNK",     params:{detuneCents:18, portaDur:0.0,  satAmount:0.8, lpHz:2500, lpQ:1.0, subMix:0.20},                                                                             desc:"Lead neo-soul — warmth analogique"},
      {id:"gv_strum",      name:"SOULFUL STRUM",    color:"#2a1020", atk:0.01, rel:1.8, engine:"GUITAR",    params:{waveType:"sawtooth", filterOpen:3500, filterClose:800, filterTime:0.2, filterQ:1.5, distAmount:1.1, detuneCents:5, bodyDecay:0.4, subMix:0.0},              desc:"Grattage soul — pluck chaud et sombre"},
      {id:"gv_4am",        name:"4AM CONFESSION",   color:"#08040f", atk:0.18, rel:4.5, engine:"OCTOBER",   params:{lpHz:280,  lpQ:0.5,  subMix:0.15, squareMix:0.0,  detune:7},                                                                                                desc:"Confession 4h — ultra intime, murmure pur"},
      {id:"gv_formant",    name:"SOUL FORMANT",     color:"#3a2060", atk:0.08, rel:1.5, engine:"TRIBAL",    params:{decay:0.5,  formantHz:500,  punch:2.5},                                                                                                                      desc:"Formant soul — percussif et mélodique"},
      {id:"gv_soul_bell",  name:"SOUL BELL",        color:"#6040a0", atk:0.001,rel:2.0, engine:"SCIFI",     params:{modRatio:4.0,  modIndex:0.8, lfoFreq:0.0,  lpQ:8.0, lfoDepth:0.0},                                                                                         desc:"Cloche soul FM — bell intime et cristallin"},
      {id:"gv_cine_dread", name:"CINEMATIC DREAD",  color:"#100820", atk:0.80, rel:4.5, engine:"VAPOR",     params:{detuneCents:20, lpStart:200,  lpEnd:1000,  sweepTime:4.0, vibRate:0.1,  waveType:"sawtooth"},                                                                desc:"Dread cinématique — sweep lent et sombre"},
      {id:"gv_vinyl_soul", name:"VINYL SOUL",       color:"#4a2840", atk:0.08, rel:2.2, engine:"CHERNOBYL", params:{bitSteps:32, noiseAmt:0.04, satAmount:1.5},                                                                                                                 desc:"Soul vinyle — grain subtil, carré doux"},
      {id:"gv_late_keys",  name:"LATE NIGHT KEYS",  color:"#1a1030", atk:0.07, rel:3.0, engine:"JOLA_EP",   params:{tremoloRate:1.5, tremoloDepth:0.03, detuneCents:6,  lpHz:1000, lpQ:1.0, clickAmount:0.08, decayTime:2.5,  sustainLevel:0.30, warmth:2.5},                   desc:"Clavier nuit tardive — Rhodes très chaud, lent"},
      {id:"gv_dark_punch", name:"DARK PUNCH",       color:"#281040", atk:0.02, rel:1.4, engine:"GYM",       params:{waveType:"sawtooth", clipAmount:0.3, boostFreq:600,  boostGain:4,  subMix:0.30},                                                                            desc:"Punch sombre — grave boosté, clip très léger"},
      {id:"gv_smooth",     name:"SMOOTH LIKE",      color:"#2a1858", atk:0.06, rel:2.4, engine:"ASTRO",     params:{wobbleRate:1.2, wobbleDepth:0.006, bitSteps:128, distAmount:0.8, lpHz:2200, lpQ:0.9},                                                                       desc:"Smooth — flûte propre, wobble minimal"},
      {id:"gv_cathedral",  name:"CATHEDRAL",        color:"#e8d0ff", atk:0.20, rel:5.0, engine:"YEEZY",     params:{mode:2,  satAmount:0.8, lpHz:2000, lpQ:0.8, subMix:0.20, hpHz:0},                                                                                           desc:"Cathédrale — sine + sub, éthéré et gospel"},
      {id:"gv_resonant",   name:"RESONANT SOUL",    color:"#5030a0", atk:0.001,rel:2.5, engine:"SAMURAI",   params:{pluckDecay:1.5,  resonance:12, harmMix:0.15},                                                                                                               desc:"Pluck résonant — corps très long, cristallin"},
      {id:"gv_lush_wall",  name:"LUSH DARK WALL",   color:"#150a30", atk:0.40, rel:4.0, engine:"SUPERSAW",  params:{detuneCents:35, numSaws:7,   satAmount:0.4, lpHz:1500, lpQ:0.6},                                                                                             desc:"Mur lush sombre — 7 saws très larges"},
      {id:"gv_warmth808",  name:"WARMTH",           color:"#3a1a50", atk:0.04, rel:2.0, engine:"BASS808",   params:{slideFrom:1.5,  slideDur:0.08, distAmount:1.5, slideTarget:1.0, subMix:0.0},                                                                                desc:"Warmth — 808 chaleureux, slide soul doux"},
    ]
  },

  // ── DAMSO — Trap belge : sombre, froid, industriel, psychologique ─────────────
  DAMSO: {
    label:"🖤 DAMSO", color:"#1a1a2e",
    presets:[
      {id:"dm_ipseit",     name:"IPSÉITÉ",          color:"#1a1a2e", atk:0.01, rel:1.8, engine:"HORROR",    params:{modRatio:1.02,  driftAmount:0.04,  bitSteps:8,   lpFreq:1200, lpQ:3.0},                                                                                      desc:"Ipséité — near-unison bitcrush, froid"},
      {id:"dm_808dark",    name:"BATTERIE FAIBLE",  color:"#0d0d1a", atk:0.02, rel:1.4, engine:"BASS808",   params:{slideFrom:3.0,  slideDur:0.12,  distAmount:4.0, slideTarget:1.0, subMix:0.0},                                                                                desc:"Batterie Faible — 808 très distordu, lourd"},
      {id:"dm_industrial", name:"PACIFIQUE",        color:"#2a0a0a", atk:0.01, rel:1.0, engine:"GYM",       params:{waveType:"sawtooth", clipAmount:0.9, boostFreq:3000, boostGain:10, subMix:0.0},                                                                              desc:"Pacifique — hard clip industriel, agressif"},
      {id:"dm_noise",      name:"BRUIT BLANC",      color:"#080808", atk:0.01, rel:1.2, engine:"CHERNOBYL", params:{bitSteps:4,  noiseAmt:0.35, satAmount:5.0},                                                                                                                  desc:"Bruit blanc — bitcrush extrême + noise lourd"},
      {id:"dm_fm_cold",    name:"FM FROID",         color:"#0a1020", atk:0.03, rel:2.0, engine:"SCIFI",     params:{modRatio:7.0,  modIndex:8.0, lfoFreq:0.05, lpQ:8.0, lfoDepth:0.5},                                                                                          desc:"FM froid — dissonance froide et mécanique"},
      {id:"dm_ind_square", name:"BLACK MIRROR",     color:"#1a1a1a", atk:0.01, rel:0.9, engine:"YEEZY",     params:{mode:1,  satAmount:5.0, lpHz:9000, lpQ:3.5, subMix:0.0, hpHz:0},                                                                                            desc:"Black Mirror — square clip brutal maximal"},
      {id:"dm_glitch",     name:"GLITCH PSYCHO",    color:"#1a0a2a", atk:0.02, rel:1.5, engine:"ASTRO",     params:{wobbleRate:5.5, wobbleDepth:0.020, bitSteps:8,  distAmount:3.5, lpHz:2500, lpQ:2.0},                                                                         desc:"Glitch psychologique — signal brisé, dark"},
      {id:"dm_cold_saws",  name:"SCIE FROIDE",      color:"#0a0a14", atk:0.03, rel:1.8, engine:"VIKINGS",   params:{detuneCents:4,  subGain:0.50, lpFreq:500,  saturation:4.0, waves:3},                                                                                         desc:"Scie froide — 3 saws serrés saturés, lourd"},
      {id:"dm_dark_sweep", name:"DESCENTE",         color:"#10101a", atk:0.05, rel:2.2, engine:"VAPOR",     params:{detuneCents:25, lpStart:150,  lpEnd:600,   sweepTime:0.4, vibRate:0.05, waveType:"sawtooth"},                                                                 desc:"Descente — sweep rapide vers le noir"},
      {id:"dm_punch_dark", name:"PERCUSSION GRAVE", color:"#0f0f0f", atk:0.01, rel:0.8, engine:"TRIBAL",    params:{decay:0.12, formantHz:350,  punch:7.0},                                                                                                                      desc:"Percussion grave — très punch, fréquence basse"},
      {id:"dm_short_plk",  name:"PLUCK SEC",        color:"#14141e", atk:0.001,rel:1.0, engine:"SAMURAI",   params:{pluckDecay:0.08, resonance:14, harmMix:0.05},                                                                                                                desc:"Pluck sec — ultra court, froid, mécanique"},
      {id:"dm_slow_vib",   name:"VIBRATION BASSE",  color:"#0a0a10", atk:0.06, rel:2.5, engine:"PIRATES",   params:{detuneCents:5,  vibRate:0.3,  vibDepth:0.03,  bpQ:6.0},                                                                                                      desc:"Vibration basse — LFO lent, bandpass profond"},
      {id:"dm_dark_pluck", name:"CORDE NOIRE",      color:"#180808", atk:0.001,rel:1.2, engine:"GUITAR",    params:{waveType:"sawtooth", filterOpen:600, filterClose:150, filterTime:0.05, filterQ:4.0, distAmount:4.0, detuneCents:0, bodyDecay:0.08, subMix:0.0},              desc:"Corde noire — pluck ultra foncé, très filtré"},
      {id:"dm_drone",      name:"BOURDON NOIR",     color:"#050508", atk:0.04, rel:3.0, engine:"BAGPIPES",  params:{pulseWidth:0.07, droneGain:0.80, droneLPHz:500, vibratoRate:0.0, vibratoDepth:0.0, brightness:800,  nasalQ:5.0},                                             desc:"Bourdon noir — drone écrasant, très nasal"},
      {id:"dm_square_ind", name:"CARRÉ INDUSTRIEL", color:"#1a1008", atk:0.01, rel:1.1, engine:"GYM",       params:{waveType:"square",   clipAmount:0.5, boostFreq:1000, boostGain:8,  subMix:0.0},                                                                              desc:"Carré industriel — square clip, boost mid"},
      {id:"dm_cold_bass",  name:"BASSE FROIDE",     color:"#0a0a18", atk:0.02, rel:1.6, engine:"GFUNK",     params:{detuneCents:3,  portaDur:0.0,  satAmount:5.0, lpHz:600,  lpQ:2.0, subMix:0.0},                                                                              desc:"Basse froide — max saturation, LP fermé"},
      {id:"dm_cave",       name:"CAVE",             color:"#04040a", atk:0.15, rel:3.5, engine:"OCTOBER",   params:{lpHz:220,  lpQ:0.4,  subMix:0.08, squareMix:0.0, detune:2},                                                                                                  desc:"Cave — claustrophobique, son minimal"},
      {id:"dm_3saws_cold", name:"TROIS SAWS FROIDS",color:"#0c0c20", atk:0.03, rel:1.8, engine:"SUPERSAW",  params:{detuneCents:6,  numSaws:3,   satAmount:4.0, lpHz:1800, lpQ:2.5},                                                                                             desc:"3 saws froids — saturés, minimaliste"},
      {id:"dm_dark_ep",    name:"EP NOIR",          color:"#10080a", atk:0.04, rel:1.8, engine:"JOLA_EP",   params:{tremoloRate:0.0, tremoloDepth:0.0,  detuneCents:2,  lpHz:800,  lpQ:1.5, clickAmount:0.0,  decayTime:0.8,  sustainLevel:0.10, warmth:4.0},                    desc:"EP noir — saturation forte, pas de trémolo"},
      {id:"dm_extreme",    name:"EXTRÊME",          color:"#0a0204", atk:0.01, rel:1.0, engine:"HORROR",    params:{modRatio:1.04,  driftAmount:0.06,  bitSteps:4,   lpFreq:600,  lpQ:5.0},                                                                                      desc:"Extrême — near-unison maximal, bitcrush brut"},
      {id:"dm_fm_sub",     name:"FM SOUS-GRAVE",    color:"#04040c", atk:0.04, rel:2.0, engine:"SCIFI",     params:{modRatio:0.5,  modIndex:10.0, lfoFreq:0.1,  lpQ:4.0, lfoDepth:2.0},                                                                                         desc:"FM sous-grave — modRatio<1, son profond"},
      {id:"dm_noise2",     name:"CHAOS BLANC",      color:"#080408", atk:0.01, rel:1.4, engine:"CHERNOBYL", params:{bitSteps:20, noiseAmt:0.50, satAmount:2.0},                                                                                                                  desc:"Chaos blanc — quasi que du noise, psyché"},
      {id:"dm_sub_sweep",  name:"VAGUE SOUS-GRAVE", color:"#060610", atk:0.08, rel:2.5, engine:"VAPOR",     params:{detuneCents:0,  lpStart:80,   lpEnd:400,   sweepTime:0.8, vibRate:0.0,  waveType:"sine"},                                                                     desc:"Vague sous-grave — sine seul, sweep très bas"},
      {id:"dm_max_punch",  name:"IMPACT MAXIMAL",   color:"#0f0808", atk:0.001,rel:0.6, engine:"TRIBAL",    params:{decay:0.05, formantHz:200,  punch:10.0},                                                                                                                     desc:"Impact maximal — punch extrême, très grave"},
      {id:"dm_yeezy_cave", name:"YEEZY CAVE",       color:"#050510", atk:0.12, rel:3.2, engine:"YEEZY",     params:{mode:2,  satAmount:2.0, lpHz:600,  lpQ:0.8, subMix:0.50, hpHz:0},                                                                                            desc:"Cave cathédrale — sine+sub, très sombre"},
    ]
  },

  // ── CAS — Dream pop : éthéré, romantique, nocturne, shoegaze, ambient ────────
  CAS: {
    label:"🌸 CAS", color:"#f5a0c8",
    presets:[
      {id:"ca_dream_sw",   name:"DREAM SWEEP",      color:"#c8a0f0", atk:0.30, rel:4.0, engine:"VAPOR",     params:{detuneCents:8,  lpStart:300,  lpEnd:4000,  sweepTime:2.5, vibRate:0.15, waveType:"sine"},                                                                     desc:"Dream Sweep — pad onirique lent, sine doux"},
      {id:"ca_shoegaze",   name:"SHOEGAZE WALL",    color:"#b060c0", atk:0.40, rel:4.5, engine:"SUPERSAW",  params:{detuneCents:32, numSaws:7,   satAmount:0.4, lpHz:2000, lpQ:0.7},                                                                                             desc:"Shoegaze wall — mur de saws très large"},
      {id:"ca_fm_ether",   name:"FM ÉTHÉRÉ",        color:"#e0c0ff", atk:0.10, rel:3.0, engine:"SCIFI",     params:{modRatio:1.0,  modIndex:0.5, lfoFreq:0.2,  lpQ:3.0, lfoDepth:0.3},                                                                                          desc:"FM éthéré — modulation très douce, shimmer"},
      {id:"ca_intimate",   name:"CHAMBRE ROSE",     color:"#f0a0b8", atk:0.12, rel:3.8, engine:"OCTOBER",   params:{lpHz:480,  lpQ:0.7,  subMix:0.12, squareMix:0.0, detune:5},                                                                                                  desc:"Chambre rose — intime et tendre, sine doux"},
      {id:"ca_str_vib",    name:"STRING VIBRATO",   color:"#d080e0", atk:0.20, rel:3.5, engine:"PIRATES",   params:{detuneCents:12, vibRate:3.8,  vibDepth:0.008, bpQ:1.2},                                                                                                      desc:"String vibrato — cordes romantiques douces"},
      {id:"ca_drone",      name:"AMBIENT DRONE",    color:"#a0c0e0", atk:0.06, rel:4.0, engine:"BAGPIPES",  params:{pulseWidth:0.48, droneGain:0.40, droneLPHz:160, vibratoRate:2.0, vibratoDepth:0.004, brightness:2500, nasalQ:0.9},                                            desc:"Drone ambiant — pulse très doux, bourdon soft"},
      {id:"ca_soft_pluck", name:"SOFT PLUCK",       color:"#c0a0d8", atk:0.001,rel:2.5, engine:"SAMURAI",   params:{pluckDecay:0.6,  resonance:5,  harmMix:0.20},                                                                                                                desc:"Soft pluck — pluck body doux et chaud"},
      {id:"ca_ep_dream",   name:"EP RÊVE",          color:"#f8c0e0", atk:0.06, rel:3.0, engine:"JOLA_EP",   params:{tremoloRate:2.0, tremoloDepth:0.04, detuneCents:5,  lpHz:1600, lpQ:1.0, clickAmount:0.06, decayTime:2.0,  sustainLevel:0.28, warmth:1.4},                    desc:"EP rêve — Rhodes doux et romantique"},
      {id:"ca_pluck_clean",name:"PLUCK CRISTAL",    color:"#d8e8f8", atk:0.001,rel:2.0, engine:"GUITAR",    params:{waveType:"sawtooth", filterOpen:6000, filterClose:2000, filterTime:0.3, filterQ:1.0, distAmount:0.8, detuneCents:3, bodyDecay:0.3, subMix:0.0},              desc:"Pluck cristal — clean, brillant et romantique"},
      {id:"ca_soft_warm",  name:"ANALOG VELVET",    color:"#e8c0d8", atk:0.05, rel:2.5, engine:"GFUNK",     params:{detuneCents:20, portaDur:0.0,  satAmount:0.6, lpHz:3000, lpQ:0.9, subMix:0.10},                                                                             desc:"Analog velvet — warmth analogique très doux"},
      {id:"ca_dust",       name:"POUSSIÈRE",        color:"#e0d8f0", atk:0.10, rel:3.5, engine:"CHERNOBYL", params:{bitSteps:96, noiseAmt:0.02, satAmount:0.8},                                                                                                                  desc:"Poussière — trace de grain, presque rien"},
      {id:"ca_soft_bell",  name:"BELL FLORAL",      color:"#f0c8e8", atk:0.001,rel:2.2, engine:"TRIBAL",    params:{decay:0.6,  formantHz:1200, punch:1.2},                                                                                                                      desc:"Bell floral — formant aigu, percussif doux"},
      {id:"ca_gentle_pad", name:"GENTLE PAD",       color:"#b8a8d8", atk:0.40, rel:4.2, engine:"VIKINGS",   params:{detuneCents:22, subGain:0.08, lpFreq:1800, saturation:0.5, waves:3},                                                                                         desc:"Gentle pad — 3 saws très larges et doux"},
      {id:"ca_float_sw",   name:"FLOATING SWEEP",   color:"#c8d8f8", atk:0.50, rel:5.0, engine:"VAPOR",     params:{detuneCents:5,  lpStart:500,  lpEnd:5000,  sweepTime:3.5, vibRate:0.08, waveType:"triangle"},                                                                desc:"Floating sweep — triangle lent, long montée"},
      {id:"ca_thin_shine", name:"THIN SHIMMER",     color:"#f0f0ff", atk:0.04, rel:2.0, engine:"SUPERSAW",  params:{detuneCents:10, numSaws:3,   satAmount:0.3, lpHz:9000, lpQ:1.0},                                                                                             desc:"Thin shimmer — 3 saws fins et brillants"},
      {id:"ca_fm_fast",    name:"FM SCINTILLANT",   color:"#e8d0ff", atk:0.05, rel:2.5, engine:"SCIFI",     params:{modRatio:3.0,  modIndex:0.4, lfoFreq:5.0,  lpQ:6.0, lfoDepth:1.0},                                                                                          desc:"FM scintillant — lfoFreq rapide, shimmer"},
      {id:"ca_drift",      name:"DRIFT NOCTURNE",   color:"#a0a8c8", atk:0.50, rel:4.5, engine:"HORROR",    params:{modRatio:1.003, driftAmount:0.002, bitSteps:96, lpFreq:2500, lpQ:1.0},                                                                                       desc:"Drift nocturne — texture très légère, flottant"},
      {id:"ca_sub_clean",  name:"BASS FLORALE",     color:"#c0d0e8", atk:0.05, rel:2.0, engine:"BASS808",   params:{slideFrom:1.0,  slideDur:0.001, distAmount:0.5, slideTarget:1.0, subMix:0.0},                                                                                desc:"Bass florale — 808 clean sans distorsion"},
      {id:"ca_wobble_cl",  name:"FLÛTE RÊVEUSE",    color:"#e8f0d8", atk:0.06, rel:2.8, engine:"ASTRO",     params:{wobbleRate:1.5, wobbleDepth:0.008, bitSteps:128, distAmount:0.6, lpHz:3000, lpQ:1.0},                                                                        desc:"Flûte rêveuse — wobble minimal, très propre"},
      {id:"ca_divine",     name:"DIVINE LIGHT",     color:"#fff8ff", atk:0.18, rel:4.8, engine:"YEEZY",     params:{mode:2,  satAmount:0.5, lpHz:3500, lpQ:0.7, subMix:0.08, hpHz:0},                                                                                            desc:"Lumière divine — sine pur, très éthéré"},
      {id:"ca_open_oct",   name:"OPEN DREAM",       color:"#ffd8f0", atk:0.10, rel:3.5, engine:"OCTOBER",   params:{lpHz:600,  lpQ:0.8,  subMix:0.18, squareMix:0.0, detune:4},                                                                                                  desc:"Open dream — plus ouvert, encore doux"},
      {id:"ca_fast_vib",   name:"VIBRATO RAPIDE",   color:"#d8c0f8", atk:0.15, rel:3.0, engine:"PIRATES",   params:{detuneCents:8,  vibRate:7.0,  vibDepth:0.012, bpQ:0.9},                                                                                                      desc:"Vibrato rapide — shimmer bandpass doux"},
      {id:"ca_ep_church",  name:"EP ÉGLISE",        color:"#e8e0ff", atk:0.08, rel:4.0, engine:"JOLA_EP",   params:{tremoloRate:0.8, tremoloDepth:0.02, detuneCents:4,  lpHz:1200, lpQ:0.9, clickAmount:0.04, decayTime:3.0,  sustainLevel:0.35, warmth:1.2},                    desc:"EP église — très lent et solennel"},
      {id:"ca_long_pluck", name:"PLUCK ÉTERNEL",    color:"#f0e8ff", atk:0.001,rel:3.5, engine:"SAMURAI",   params:{pluckDecay:2.0,  resonance:8,  harmMix:0.22},                                                                                                                desc:"Pluck éternel — très long, harmonique doux"},
      {id:"ca_wide_dream", name:"WIDE DREAM",       color:"#b0a0d0", atk:0.35, rel:4.5, engine:"VIKINGS",   params:{detuneCents:30, subGain:0.05, lpFreq:2200, saturation:0.4, waves:2},                                                                                         desc:"Wide dream — 2 saws très larges et aériens"},
    ]
  },

  // ── TORY — R&B trap : caribéen, dancehall, chaud, festif, mélancolique ───────
  TORY: {
    label:"🌴 TORY", color:"#e8a030",
    presets:[
      {id:"to_carib_lead",  name:"CARIBBEAN LEAD",  color:"#e8a030", atk:0.04, rel:2.0, engine:"GFUNK",     params:{detuneCents:14, portaDur:0.0,  satAmount:1.6, lpHz:4000, lpQ:1.4, subMix:0.18},                                                                             desc:"Caribbean Lead — warmth G-Funk tropical"},
      {id:"to_808warm",     name:"WARM 808",         color:"#c86000", atk:0.02, rel:1.8, engine:"BASS808",   params:{slideFrom:1.5,  slideDur:0.06, distAmount:1.8, slideTarget:1.0, subMix:0.0},                                                                                desc:"Warm 808 — slide court et chaleureux"},
      {id:"to_rb_ep",       name:"R&B EP",           color:"#f0c060", atk:0.04, rel:2.2, engine:"JOLA_EP",   params:{tremoloRate:4.5, tremoloDepth:0.07, detuneCents:5,  lpHz:2500, lpQ:1.2, clickAmount:0.14, decayTime:1.2,  sustainLevel:0.22, warmth:1.6},                    desc:"R&B EP — trémolo rapide, bright et festif"},
      {id:"to_trop_pad",    name:"TROPICAL PAD",     color:"#e89020", atk:0.25, rel:3.2, engine:"VAPOR",     params:{detuneCents:10, lpStart:600,  lpEnd:5000,  sweepTime:1.2, vibRate:0.25, waveType:"sawtooth"},                                                                desc:"Tropical pad — sweep chaud et festif"},
      {id:"to_warm_ssaw",   name:"WARM SUPERSAW",    color:"#d07020", atk:0.05, rel:2.5, engine:"SUPERSAW",  params:{detuneCents:18, numSaws:5,   satAmount:1.6, lpHz:6000, lpQ:1.5},                                                                                             desc:"Warm SuperSaw — 5 saws chauds et lush"},
      {id:"to_dancehall",   name:"DANCEHALL STAB",   color:"#ff8020", atk:0.01, rel:1.0, engine:"GYM",       params:{waveType:"square",   clipAmount:0.5, boostFreq:2000, boostGain:6,  subMix:0.15},                                                                            desc:"Dancehall stab — punch carré, festif"},
      {id:"to_fm_bright",   name:"FM BRIGHT",        color:"#f0b840", atk:0.03, rel:1.8, engine:"SCIFI",     params:{modRatio:2.0,  modIndex:2.5, lfoFreq:0.6,  lpQ:4.0, lfoDepth:1.5},                                                                                         desc:"FM bright — lumineux et chaud, FM tropical"},
      {id:"to_carib_pluck", name:"MARIMBA CARIB",    color:"#e8c040", atk:0.001,rel:1.4, engine:"SAMURAI",   params:{pluckDecay:0.25, resonance:8,  harmMix:0.40},                                                                                                               desc:"Marimba Caribbean — pluck brillant percussif"},
      {id:"to_warm_gtr",    name:"WARM GUITAR",      color:"#d08030", atk:0.001,rel:1.6, engine:"GUITAR",    params:{waveType:"sawtooth", filterOpen:4000, filterClose:1500, filterTime:0.15, filterQ:1.8, distAmount:1.2, detuneCents:4, bodyDecay:0.3, subMix:0.0},            desc:"Warm guitar — pluck chaud, filter doux"},
      {id:"to_carib_perc",  name:"CARIB PERCUSSION", color:"#e07020", atk:0.01, rel:1.0, engine:"TRIBAL",    params:{decay:0.25, formantHz:700,  punch:3.5},                                                                                                                      desc:"Carib percussion — punch festif, formant vocal"},
      {id:"to_warm_ens",    name:"WARM ENSEMBLE",    color:"#c07828", atk:0.20, rel:2.8, engine:"VIKINGS",   params:{detuneCents:12, subGain:0.25, lpFreq:3000, saturation:1.2, waves:3},                                                                                        desc:"Warm ensemble — 3 saws chauds désaccordés"},
      {id:"to_vintage",     name:"VINTAGE TAPE",     color:"#a06020", atk:0.06, rel:2.4, engine:"HORROR",    params:{modRatio:1.008, driftAmount:0.005, bitSteps:48, lpFreq:3000, lpQ:1.0},                                                                                       desc:"Vintage tape — drift subtil, chaleur"},
      {id:"to_grit_rb",     name:"GRIT R&B",         color:"#b05818", atk:0.04, rel:1.8, engine:"CHERNOBYL", params:{bitSteps:48, noiseAmt:0.06, satAmount:2.0},                                                                                                                 desc:"Grit R&B — grain léger, chaleur vinyle"},
      {id:"to_trap_wob",    name:"TRAP WOBBLE",      color:"#e04010", atk:0.03, rel:1.6, engine:"ASTRO",     params:{wobbleRate:3.5, wobbleDepth:0.012, bitSteps:64, distAmount:1.6, lpHz:4000, lpQ:1.4},                                                                        desc:"Trap wobble — flûte distordue trap chaude"},
      {id:"to_carib_vib",   name:"CARIB STRINGS",    color:"#d09030", atk:0.15, rel:2.5, engine:"PIRATES",   params:{detuneCents:18, vibRate:5.0,  vibDepth:0.010, bpQ:1.8},                                                                                                     desc:"Carib strings — bandpass vibrato festif"},
      {id:"to_intimate",    name:"INTIMATE R&B",     color:"#c07040", atk:0.10, rel:3.0, engine:"OCTOBER",   params:{lpHz:560,  lpQ:0.9,  subMix:0.28, squareMix:0.0, detune:4},                                                                                                 desc:"Intimate R&B — doux et personnel"},
      {id:"to_steel_drum",  name:"STEEL DRUM",       color:"#f0d060", atk:0.001,rel:1.2, engine:"BAGPIPES",  params:{pulseWidth:0.50, droneGain:0.05, droneLPHz:80, vibratoRate:0.0, vibratoDepth:0.0, brightness:6000, nasalQ:4.0},                                              desc:"Steel drum — pulse 50%, très brillant, percussif"},
      {id:"to_808slide",    name:"808 SLIDE LONG",   color:"#d05010", atk:0.02, rel:1.5, engine:"BASS808",   params:{slideFrom:2.5,  slideDur:0.18, distAmount:2.5, slideTarget:1.0, subMix:0.0},                                                                                desc:"808 slide long — glisse longue trap chaude"},
      {id:"to_bright_wall", name:"BRIGHT WALL",      color:"#f0c840", atk:0.05, rel:2.8, engine:"SUPERSAW",  params:{detuneCents:22, numSaws:7,   satAmount:1.8, lpHz:8000, lpQ:1.6},                                                                                             desc:"Bright wall — 7 saws lumineux, festif"},
      {id:"to_ep_fast",     name:"EP FESTIF",        color:"#e8b020", atk:0.04, rel:1.8, engine:"JOLA_EP",   params:{tremoloRate:6.0, tremoloDepth:0.09, detuneCents:4,  lpHz:3000, lpQ:1.3, clickAmount:0.18, decayTime:1.0,  sustainLevel:0.18, warmth:1.2},                    desc:"EP festif — trémolo rapide, bright tropical"},
      {id:"to_warm_sweep",  name:"WARM SWEEP",       color:"#c88830", atk:0.20, rel:2.6, engine:"VAPOR",     params:{detuneCents:6,  lpStart:800,  lpEnd:6000,  sweepTime:0.8, vibRate:0.20, waveType:"triangle"},                                                               desc:"Warm sweep — triangle rapide, chaleur"},
      {id:"to_saw_warm",    name:"SAW WARM",         color:"#b07020", atk:0.04, rel:2.0, engine:"GFUNK",     params:{detuneCents:22, portaDur:0.0,  satAmount:1.0, lpHz:3500, lpQ:1.0, subMix:0.14},                                                                             desc:"Saw warm — large et chaud, no portamento"},
      {id:"to_clip_saw",    name:"CLIP SAW DANCE",   color:"#e86020", atk:0.02, rel:1.4, engine:"GYM",       params:{waveType:"sawtooth", clipAmount:0.4, boostFreq:1500, boostGain:5,  subMix:0.10},                                                                            desc:"Clip saw dance — saw clipé, mid boosté"},
      {id:"to_soul_chop",   name:"SOUL CHOP CARIB",  color:"#f0a840", atk:0.04, rel:1.8, engine:"YEEZY",     params:{mode:0,  satAmount:1.4, lpHz:4500, lpQ:1.3, subMix:0.15, hpHz:280},                                                                                         desc:"Soul chop carib — triangle HP + LP, tropical"},
      {id:"namek",          name:"NAMEK",            color:"#ffd700", atk:0.05, rel:3.0, engine:"SUPERSAW",  params:{detuneCents:20, numSaws:7,   satAmount:2.8, lpHz:10000,lpQ:2.0},                                                                                             desc:"NAMEK — épique Dragon Ball, or et majestueux"},
    ]
  },

  // ── RNB — R&B Soul : neo-soul, gospel, Motown, SZA/Frank Ocean, Rhodes ──────
  RNB: {
    label:"🎷 RNB", color:"#c47028",
    presets:[
      {id:"rnb_neosoul_ep",  name:"NEO SOUL RHODES",  color:"#c47028", atk:0.04, rel:3.0, engine:"JOLA_EP",   params:{tremoloRate:2.8, tremoloDepth:0.06, detuneCents:6,  lpHz:2800, lpQ:1.1, clickAmount:0.12, decayTime:1.8,  sustainLevel:0.25, warmth:2.2}, desc:"Neo-soul Rhodes — trémolo doux, chaleur vintage"},
      {id:"rnb_gospel_ep",   name:"GOSPEL RHODES",    color:"#e09040", atk:0.03, rel:2.6, engine:"JOLA_EP",   params:{tremoloRate:5.5, tremoloDepth:0.10, detuneCents:3,  lpHz:3500, lpQ:1.0, clickAmount:0.20, decayTime:1.2,  sustainLevel:0.30, warmth:1.5}, desc:"Gospel Rhodes — attaque claire, click fort, ciel"},
      {id:"rnb_motown",      name:"MOTOWN SINE",      color:"#a06830", atk:0.06, rel:2.8, engine:"OCTOBER",   params:{lpHz:480,  lpQ:0.8,  subMix:0.22, squareMix:0.0, detune:3},                                                                               desc:"Motown vintage — sine doux, basse ronde 60s"},
      {id:"rnb_sza_pad",     name:"SZA DREAM PAD",    color:"#d080c0", atk:0.30, rel:4.0, engine:"VAPOR",     params:{detuneCents:8,  lpStart:500,  lpEnd:4000,  sweepTime:2.0, vibRate:0.15, waveType:"sawtooth"},                                              desc:"SZA dream pad — sweep lent et éthéré, R&B contemp."},
      {id:"rnb_fm_bell",     name:"SOUL FM BELL",     color:"#f0a040", atk:0.02, rel:2.2, engine:"SCIFI",     params:{modRatio:1.5,  modIndex:1.8, lfoFreq:0.4,  lpQ:3.5, lfoDepth:0.8},                                                                        desc:"Soul FM bell — FM doux, timbre chaleureux"},
      {id:"rnb_smooth_jazz", name:"SMOOTH JAZZ WIND", color:"#8090b0", atk:0.12, rel:2.5, engine:"BAGPIPES",  params:{pulseWidth:0.18, droneGain:0.0, droneLPHz:200, vibratoRate:4.5, vibratoDepth:0.007, brightness:2800, nasalQ:2.5},                          desc:"Smooth jazz wind — pulse fin, vibrato délicat"},
      {id:"rnb_funk_lead",   name:"FUNK LEAD",        color:"#d09830", atk:0.02, rel:1.4, engine:"GFUNK",     params:{detuneCents:10, portaDur:0.0,  satAmount:1.4, lpHz:3800, lpQ:1.2, subMix:0.12},                                                           desc:"Funk lead — G-Funk doux, no portamento"},
      {id:"rnb_choir",       name:"SILKY CHOIR",      color:"#e0c0a0", atk:0.22, rel:3.5, engine:"VIKINGS",   params:{detuneCents:9,  subGain:0.12, lpFreq:3200, saturation:1.0, waves:5},                                                                       desc:"Silky choir — 5 saws désaccordés, velours"},
      {id:"rnb_round_bass",  name:"ROUND BASS",       color:"#804020", atk:0.02, rel:2.0, engine:"BASS808",   params:{slideFrom:1.0, slideDur:0.02, distAmount:1.4, slideTarget:1.0, subMix:0.0},                                                                desc:"Round bass — 808 doux, très peu de slide"},
      {id:"rnb_soul_pluck",  name:"SOUL PLUCK",       color:"#c09060", atk:0.001,rel:1.8, engine:"SAMURAI",   params:{pluckDecay:0.30, resonance:6,  harmMix:0.35},                                                                                              desc:"Soul pluck — pluck boisé, 2e harmonique chaleureux"},
      {id:"rnb_vinyl",       name:"VINYL SOUL",       color:"#706050", atk:0.08, rel:2.8, engine:"HORROR",    params:{modRatio:1.004, driftAmount:0.003, bitSteps:56, lpFreq:2800, lpQ:0.9},                                                                     desc:"Vinyl soul — drift ultra léger, grain vinyle"},
      {id:"rnb_trap_rb",     name:"R&B TRAP LEAD",    color:"#b040a0", atk:0.03, rel:1.8, engine:"ASTRO",     params:{wobbleRate:2.5, wobbleDepth:0.008, bitSteps:96, distAmount:1.5, lpHz:4500, lpQ:1.2},                                                       desc:"R&B trap lead — flûte astro douce, trap moderne"},
      {id:"rnb_organ_stab",  name:"CHURCH STAB",      color:"#a05000", atk:0.01, rel:0.9, engine:"GYM",       params:{waveType:"square", clipAmount:0.35, boostFreq:1200, boostGain:5,  subMix:0.10},                                                            desc:"Church stab — orgue carré percussif, gospel"},
      {id:"rnb_lofi",        name:"LO-FI SOUL",       color:"#907060", atk:0.06, rel:2.4, engine:"CHERNOBYL", params:{bitSteps:36, noiseAmt:0.08, satAmount:1.6},                                                                                                desc:"Lo-fi soul — grain cassette, noise douce"},
      {id:"rnb_strings_vib", name:"SOUL STRINGS",     color:"#d0a080", atk:0.18, rel:3.2, engine:"PIRATES",   params:{detuneCents:12, vibRate:4.2, vibDepth:0.009, bpQ:1.5},                                                                                     desc:"Soul strings — vibrato classique, bandpass chaud"},
      {id:"rnb_click_perc",  name:"SOUL CLICK",       color:"#c08040", atk:0.01, rel:0.8, engine:"TRIBAL",    params:{decay:0.20, formantHz:600,  punch:3.0},                                                                                                    desc:"Soul click — percussion formant vocal, groove"},
      {id:"rnb_fingerpick",  name:"FINGER GUITAR",    color:"#b07030", atk:0.001,rel:2.0, engine:"GUITAR",    params:{waveType:"sawtooth", filterOpen:3500, filterClose:900,  filterTime:0.20, filterQ:1.6, distAmount:1.0, detuneCents:3,  bodyDecay:0.35, subMix:0.0}, desc:"Finger guitar — pluck chaud, filter lent"},
      {id:"rnb_soul_chop",   name:"SOUL CHOP",        color:"#e08828", atk:0.03, rel:1.5, engine:"YEEZY",     params:{mode:0, satAmount:1.2, lpHz:3800, lpQ:1.1, subMix:0.12, hpHz:200},                                                                         desc:"Soul chop — triangle filtré, groove R&B"},
      {id:"rnb_gospel_wall", name:"GOSPEL WALL",      color:"#f0c060", atk:0.08, rel:3.0, engine:"SUPERSAW",  params:{detuneCents:14, numSaws:5,   satAmount:1.4, lpHz:5500, lpQ:1.3},                                                                           desc:"Gospel wall — 5 saws doux, choeur céleste"},
      {id:"rnb_slow_jam",    name:"SLOW JAM PAD",     color:"#d060a0", atk:0.40, rel:4.5, engine:"VAPOR",     params:{detuneCents:5,  lpStart:400,  lpEnd:3000,  sweepTime:3.0, vibRate:0.08, waveType:"triangle"},                                              desc:"Slow jam pad — triangle ultra lent, intimité"},
      {id:"rnb_deep_bass",   name:"DEEP R&B BASS",    color:"#602010", atk:0.02, rel:2.2, engine:"BASS808",   params:{slideFrom:1.2, slideDur:0.05, distAmount:2.0, slideTarget:1.0, subMix:0.0},                                                                desc:"Deep R&B bass — slide court, subharmonique"},
      {id:"rnb_fm_electric", name:"ELECTRIC SOUL FM", color:"#e0a020", atk:0.02, rel:1.6, engine:"SCIFI",     params:{modRatio:3.0,  modIndex:3.5, lfoFreq:1.0,  lpQ:5.0, lfoDepth:2.0},                                                                        desc:"Electric soul FM — FM brillant, mid précis"},
      {id:"rnb_mellow_saw",  name:"MELLOW SAW",       color:"#c07830", atk:0.10, rel:2.8, engine:"GFUNK",     params:{detuneCents:18, portaDur:0.0,  satAmount:0.9, lpHz:2400, lpQ:0.9, subMix:0.20},                                                           desc:"Mellow saw — G-Funk grave et velouté"},
      {id:"rnb_intimate",    name:"INTIMATE SINE",    color:"#a09070", atk:0.15, rel:3.5, engine:"OCTOBER",   params:{lpHz:640,  lpQ:1.0,  subMix:0.18, squareMix:0.0, detune:2},                                                                               desc:"Intimate sine — pad sine très doux, intime"},
      {id:"rnb_warm_ep3",    name:"WARM EP LATE",     color:"#d8901c", atk:0.05, rel:2.8, engine:"JOLA_EP",   params:{tremoloRate:3.5, tremoloDepth:0.05, detuneCents:8,  lpHz:2200, lpQ:0.9, clickAmount:0.08, decayTime:2.2,  sustainLevel:0.28, warmth:2.8}, desc:"Warm EP late-night — sustain long, très chaleureux"},
    ]
  },

  // ── PHONK_BR — Phonk brésilien : baile funk, tamborzão, 150 BPM, agressif ───
  PHONK_BR: {
    label:"🇧🇷 PHONK_BR", color:"#22bb44",
    presets:[
      {id:"pb_funk_clip",    name:"FUNK CARIOCA",     color:"#22bb44", atk:0.01, rel:0.8, engine:"GYM",       params:{waveType:"square",   clipAmount:0.85, boostFreq:2500, boostGain:10, subMix:0.25},                                                                             desc:"Funk carioca — square hard clip, attaque directe"},
      {id:"pb_808_baile",    name:"BAILE 808",        color:"#119933", atk:0.01, rel:1.5, engine:"BASS808",   params:{slideFrom:2.0, slideDur:0.10, distAmount:3.5, slideTarget:1.0, subMix:0.0},                                                                 desc:"Baile 808 — slide court, distorsion lourde"},
      {id:"pb_tamborzao",    name:"TAMBORZÃO ELEC",   color:"#33cc55", atk:0.01, rel:0.7, engine:"YEEZY",     params:{mode:1, satAmount:4.5, lpHz:7000, lpQ:2.5, subMix:0.0,  hpHz:600},                                                                         desc:"Tamborzão electronique — saw saturé, percussif"},
      {id:"pb_perc150",      name:"PERCUSSÃO 150",    color:"#44dd44", atk:0.01, rel:0.5, engine:"TRIBAL",    params:{decay:0.12, formantHz:1200, punch:6.0},                                                                                                     desc:"Percussion 150 BPM — punch formant agressif"},
      {id:"pb_bass_sat",     name:"BASS SATURADA",    color:"#0a8822", atk:0.01, rel:1.2, engine:"CHERNOBYL", params:{bitSteps:12, noiseAmt:0.20, satAmount:4.0},                                                                                                 desc:"Bass saturée — bitcrush brutal, noise phonk"},
      {id:"pb_horror_synth", name:"SINTETIZADOR CRADO",color:"#226633",atk:0.03, rel:1.4, engine:"HORROR",    params:{modRatio:1.025, driftAmount:0.04, bitSteps:8,  lpFreq:4500, lpQ:3.5},                                                                       desc:"Synthé crado — bitcrush intense, drift phonk"},
      {id:"pb_mc_wobble",    name:"MC ENERGY WOBBLE", color:"#55ee66", atk:0.02, rel:1.0, engine:"ASTRO",     params:{wobbleRate:8.0, wobbleDepth:0.022, bitSteps:16, distAmount:3.0, lpHz:6000, lpQ:2.5},                                                        desc:"MC energy — wobble rapide brutal, phonk aggressive"},
      {id:"pb_pisadinha",    name:"PISADINHA ELECTRO",color:"#11aa33", atk:0.01, rel:0.6, engine:"GYM",       params:{waveType:"sawtooth", clipAmount:0.70, boostFreq:3000, boostGain:9,  subMix:0.18},                                                           desc:"Pisadinha electro — saw clipé, boost 3kHz phonk"},
      {id:"pb_forro_fm",     name:"FORRÓ PHONK FM",   color:"#33cc44", atk:0.02, rel:1.1, engine:"SCIFI",     params:{modRatio:4.5,  modIndex:7.0, lfoFreq:2.0,  lpQ:6.0, lfoDepth:5.0},                                                                         desc:"Forró phonk FM — FM agressif, metallic forró"},
      {id:"pb_vikings_wall", name:"PAREDE SATURADA",  color:"#1a7730", atk:0.03, rel:1.8, engine:"VIKINGS",   params:{detuneCents:20, subGain:0.40, lpFreq:5000, saturation:4.5, waves:3},                                                                       desc:"Parede saturée — 3 saws saturés, sub fort phonk"},
      {id:"pb_sweep_agro",   name:"SWEEP AGRESSIVO",  color:"#22dd55", atk:0.02, rel:1.5, engine:"VAPOR",     params:{detuneCents:22, lpStart:1500, lpEnd:9000,  sweepTime:0.4, vibRate:1.0, waveType:"sawtooth"},                                               desc:"Sweep agressif — LP rapide saw, 150BPM energy"},
      {id:"pb_pluck_hard",   name:"PLUCK DURO",       color:"#33bb44", atk:0.001,rel:0.7, engine:"SAMURAI",   params:{pluckDecay:0.10, resonance:15, harmMix:0.50},                                                                                              desc:"Pluck dur — decay rapide, résonance haute, snap"},
      {id:"pb_phonk_wall",   name:"PHONK WALL",       color:"#55ff66", atk:0.04, rel:2.0, engine:"SUPERSAW",  params:{detuneCents:30, numSaws:7,   satAmount:4.0, lpHz:9000, lpQ:2.5},                                                                           desc:"Phonk wall — 7 saws très détuned et saturés"},
      {id:"pb_808_heavy",    name:"808 PESADO",       color:"#006616", atk:0.01, rel:2.0, engine:"BASS808",   params:{slideFrom:3.0, slideDur:0.15, distAmount:4.5, slideTarget:1.0, subMix:0.0},                                                                desc:"808 pesado — slide long, distorsion max funk"},
      {id:"pb_crado_vinyl",  name:"VINIL CRADO",      color:"#337744", atk:0.05, rel:1.6, engine:"CHERNOBYL", params:{bitSteps:6,  noiseAmt:0.30, satAmount:5.0},                                                                                                desc:"Vinil crado — bitcrush 6 steps, noise lourde"},
      {id:"pb_string_stab",  name:"STRING STAB PHONK",color:"#00cc33", atk:0.01, rel:0.8, engine:"PIRATES",   params:{detuneCents:25, vibRate:8.0,  vibDepth:0.018, bpQ:3.5},                                                                                    desc:"String stab phonk — bandpass agressif, vibrato rapide"},
      {id:"pb_dist_gtr",     name:"GUITARRA DISTORT", color:"#228833", atk:0.001,rel:1.0, engine:"GUITAR",    params:{waveType:"square", filterOpen:8000, filterClose:2000, filterTime:0.05, filterQ:3.5, distAmount:4.0, detuneCents:12, bodyDecay:0.10, subMix:0.15}, desc:"Guitarra distorcionada — square + distorsion max"},
      {id:"pb_phonk_horn",   name:"PHONK HORN",       color:"#44ee55", atk:0.02, rel:1.2, engine:"GFUNK",     params:{detuneCents:28, portaDur:0.0,  satAmount:3.0, lpHz:6000, lpQ:2.0, subMix:0.25},                                                           desc:"Phonk horn — G-Funk saturé style phonk US/BR"},
      {id:"pb_drone_dark",   name:"DRONE ESCURO",     color:"#115522", atk:0.20, rel:2.5, engine:"BAGPIPES",  params:{pulseWidth:0.50, droneGain:0.60, droneLPHz:120, vibratoRate:0.5, vibratoDepth:0.015, brightness:1200, nasalQ:5.0},                         desc:"Drone escuro — pulse 50%, drone bas, sombre phonk"},
      {id:"pb_ep_phonk",     name:"EP PHONK DISTORT", color:"#33ff55", atk:0.02, rel:1.0, engine:"JOLA_EP",   params:{tremoloRate:9.0, tremoloDepth:0.18, detuneCents:15, lpHz:5500, lpQ:2.0, clickAmount:0.40, decayTime:0.5,  sustainLevel:0.10, warmth:4.0}, desc:"EP phonk distordu — trémolo violent, warmth saturé"},
      {id:"pb_dark_sine",    name:"BAIXO DARK",       color:"#0a6618", atk:0.01, rel:1.8, engine:"OCTOBER",   params:{lpHz:260,  lpQ:1.5,  subMix:0.40, squareMix:0.0, detune:0},                                                                               desc:"Baixo dark — sine grave sub, funk 150 BPM"},
      {id:"pb_forro_perc",   name:"FORRÓ PERCUSSÃO",  color:"#22aa33", atk:0.01, rel:0.6, engine:"TRIBAL",    params:{decay:0.15, formantHz:900,  punch:7.0},                                                                                                    desc:"Forró percussion — punch 900Hz, attaque sèche"},
      {id:"pb_industrial",   name:"INDUSTRIAL PHONK", color:"#334433", atk:0.03, rel:1.5, engine:"HORROR",    params:{modRatio:1.05,  driftAmount:0.08, bitSteps:5,  lpFreq:5000, lpQ:4.0},                                                                       desc:"Industrial phonk — bitcrush brutal, drift fort"},
      {id:"pb_bounce_clip",  name:"BOUNCE CLIP",      color:"#55cc44", atk:0.01, rel:0.7, engine:"GYM",       params:{waveType:"square",   clipAmount:0.90, boostFreq:1800, boostGain:12, subMix:0.30},                                                          desc:"Bounce clip — square max clip, sub boost dancefloor"},
      {id:"pb_wobble_bass",  name:"WOBBLE BASS BR",   color:"#00ff44", atk:0.02, rel:1.6, engine:"ASTRO",     params:{wobbleRate:5.0, wobbleDepth:0.018, bitSteps:24, distAmount:2.5, lpHz:3500, lpQ:2.0},                                                       desc:"Wobble bass BR — wobble med, distorsion phonk funk"},
    ]
  },

  // ── PREMIUM — Meilleure qualité sonore, tous engines au maximum ──────────────
  PREMIUM: {
    label:"✦ PREMIUM", color:"#ffd700",
    presets:[
      // ── SUPERSAW premium pads ──────────────────────────────────────────────
      {id:"pr_wall",     name:"WALL OF SOUND",  color:"#ffd700", atk:0.30, rel:4.0, engine:"SUPERSAW",  params:{numSaws:7, detuneCents:20, satAmount:1.4, lpHz:6000, lpQ:0.7},                                                                            desc:"7 saws larges — mur cinématique absolu"},
      {id:"pr_anthem",   name:"ANTHEM RISE",    color:"#ffcc00", atk:0.80, rel:5.0, engine:"SUPERSAW",  params:{numSaws:7, detuneCents:18, satAmount:1.2, lpHz:5000, lpQ:0.6},                                                                            desc:"7 saws — montée épique, anthem de stade"},
      {id:"pr_gold",     name:"GOLD STRINGS",   color:"#f0c020", atk:0.50, rel:4.5, engine:"SUPERSAW",  params:{numSaws:7, detuneCents:14, satAmount:1.6, lpHz:4000, lpQ:0.8},                                                                            desc:"Cordes dorées — 7 saws saturation douce"},
      {id:"pr_silver",   name:"SILVER BELLS",   color:"#ddddff", atk:0.20, rel:3.5, engine:"SUPERSAW",  params:{numSaws:5, detuneCents:10, satAmount:1.0, lpHz:7000, lpQ:1.2},                                                                            desc:"Cloches argentées — 5 saws brillants"},
      {id:"pr_dawn",     name:"DAWN RISE",      color:"#ffeeaa", atk:1.20, rel:6.0, engine:"SUPERSAW",  params:{numSaws:7, detuneCents:22, satAmount:1.3, lpHz:3500, lpQ:0.6},                                                                            desc:"Lever du jour — montée lente et grandiose"},
      {id:"pr_royal",    name:"ROYAL PAD",      color:"#bb8800", atk:0.60, rel:5.0, engine:"SUPERSAW",  params:{numSaws:7, detuneCents:16, satAmount:1.5, lpHz:4500, lpQ:0.7},                                                                            desc:"Pad royal — 7 saws soyeux, majestés"},
      {id:"pr_cosmos",   name:"COSMOS",         color:"#8888ff", atk:1.00, rel:6.0, engine:"SUPERSAW",  params:{numSaws:7, detuneCents:25, satAmount:1.1, lpHz:3000, lpQ:0.5},                                                                            desc:"Cosmos — 7 saws très détuned, espace infini"},
      // ── JOLA_EP premium keys ───────────────────────────────────────────────
      {id:"pr_rhodes1",  name:"VINTAGE RHODES", color:"#cc8833", atk:0.01, rel:2.5, engine:"JOLA_EP",   params:{tremoloRate:3.0, tremoloDepth:0.08, detuneCents:5,  lpHz:4500, lpQ:0.7, clickAmount:0.12, decayTime:2.0, sustainLevel:0.25, warmth:1.6}, desc:"Rhodes vintage — trémolo doux, warmth naturel"},
      {id:"pr_rhodes2",  name:"WARM RHODES",    color:"#dd9944", atk:0.01, rel:3.0, engine:"JOLA_EP",   params:{tremoloRate:2.5, tremoloDepth:0.06, detuneCents:4,  lpHz:3500, lpQ:0.6, clickAmount:0.08, decayTime:2.5, sustainLevel:0.30, warmth:2.0}, desc:"Rhodes chaud — sustain long, très expressif"},
      {id:"pr_ep_jazz",  name:"JAZZ EP",        color:"#eeaa55", atk:0.01, rel:2.0, engine:"JOLA_EP",   params:{tremoloRate:4.0, tremoloDepth:0.10, detuneCents:3,  lpHz:5500, lpQ:0.8, clickAmount:0.15, decayTime:1.8, sustainLevel:0.22, warmth:1.4}, desc:"Jazz EP — attaque click précis, brillance jazz"},
      {id:"pr_ep_soul",  name:"SOUL KEYS",      color:"#ff9900", atk:0.02, rel:2.8, engine:"JOLA_EP",   params:{tremoloRate:3.5, tremoloDepth:0.09, detuneCents:6,  lpHz:4000, lpQ:0.7, clickAmount:0.18, decayTime:2.2, sustainLevel:0.28, warmth:2.2}, desc:"Soul keys — richesse soul, trémolo medium"},
      {id:"pr_ep_lux",   name:"LUXURY EP",      color:"#fff0c0", atk:0.01, rel:3.5, engine:"JOLA_EP",   params:{tremoloRate:2.0, tremoloDepth:0.05, detuneCents:2,  lpHz:6000, lpQ:0.6, clickAmount:0.06, decayTime:3.0, sustainLevel:0.35, warmth:1.8}, desc:"Luxury EP — luxueux, sustain long, très doux"},
      // ── GFUNK premium leads ────────────────────────────────────────────────
      {id:"pr_silk",     name:"SILK LEAD",      color:"#ff8844", atk:0.01, rel:1.8, engine:"GFUNK",     params:{detuneCents:10, portaDur:0.06, satAmount:1.8, lpHz:3200, lpQ:1.2, subMix:0.2},                                                            desc:"Lead soie — portamento court, satiné doux"},
      {id:"pr_glide1",   name:"SMOOTH GLIDE",   color:"#ff6622", atk:0.01, rel:2.0, engine:"GFUNK",     params:{detuneCents:8,  portaDur:0.10, satAmount:2.0, lpHz:2800, lpQ:1.0, subMix:0.3},                                                            desc:"Glide smooth — portamento expressif West Coast"},
      {id:"pr_west",     name:"WEST COAST",     color:"#dd4400", atk:0.01, rel:1.5, engine:"GFUNK",     params:{detuneCents:12, portaDur:0.05, satAmount:2.4, lpHz:3500, lpQ:1.5, subMix:0.1},                                                            desc:"West Coast lead — G-Funk authentique, sec"},
      {id:"pr_velvet",   name:"VELVET",         color:"#cc6633", atk:0.02, rel:2.2, engine:"GFUNK",     params:{detuneCents:6,  portaDur:0.08, satAmount:1.6, lpHz:4000, lpQ:0.8, subMix:0.4},                                                            desc:"Velvet lead — douceur velouté, sous médiums"},
      // ── SCIFI FM premium bells ─────────────────────────────────────────────
      {id:"pr_bell",     name:"CRYSTAL BELL",   color:"#aaddff", atk:0.01, rel:4.0, engine:"SCIFI",     params:{modRatio:2.0, modIndex:6.0, lfoFreq:0.3, lpQ:3.0, lfoDepth:1.5},                                                                         desc:"Cloche cristal — FM pur, shimmer aérien"},
      {id:"pr_fm_gold",  name:"FM GOLD",        color:"#ffffff88",atk:0.01,rel:3.0, engine:"SCIFI",     params:{modRatio:3.5, modIndex:8.0, lfoFreq:0.5, lpQ:4.0, lfoDepth:2.5},                                                                         desc:"FM doré — harmoniques riches, métallique chaud"},
      {id:"pr_elec_pno", name:"ELECTRIC PIANO", color:"#ddffaa", atk:0.01, rel:2.5, engine:"SCIFI",     params:{modRatio:1.0, modIndex:5.0, lfoFreq:0.2, lpQ:2.5, lfoDepth:1.0},                                                                         desc:"Piano électrique FM — propre et classique"},
      {id:"pr_angelic",  name:"ANGELIC",        color:"#bbccff", atk:0.10, rel:5.0, engine:"SCIFI",     params:{modRatio:4.0, modIndex:3.0, lfoFreq:0.8, lpQ:2.0, lfoDepth:0.8},                                                                         desc:"Angélique — FM doux, choeur céleste shimmer"},
      // ── VAPOR premium atmosphere ───────────────────────────────────────────
      {id:"pr_dream",    name:"DREAM STATE",    color:"#ff88ff", atk:1.50, rel:6.0, engine:"VAPOR",     params:{lpStart:300,  lpEnd:5000, sweepTime:3.0, vibRate:0.2, waveType:"sine"},                                                                   desc:"État de rêve — sweep lent, onirisme absolu"},
      {id:"pr_ether",    name:"ETHER",          color:"#cc88ff", atk:2.00, rel:7.0, engine:"VAPOR",     params:{lpStart:200,  lpEnd:4000, sweepTime:4.0, vibRate:0.15,waveType:"sine"},                                                                   desc:"Éther — attaque très douce, ambiance profonde"},
      {id:"pr_aurora",   name:"AURORA",         color:"#88ffcc", atk:1.00, rel:5.0, engine:"VAPOR",     params:{lpStart:400,  lpEnd:6000, sweepTime:2.5, vibRate:0.3, waveType:"triangle"},                                                               desc:"Aurora boréale — sweep triangle, couleurs froides"},
      {id:"pr_vapor_lx", name:"VAPOR LUXE",     color:"#ffaaee", atk:0.80, rel:5.5, engine:"VAPOR",     params:{lpStart:600,  lpEnd:8000, sweepTime:2.0, vibRate:0.25,waveType:"sawtooth"},                                                              desc:"Vapor luxe — saw brillant, sweep rapide, riche"},
      // ── OCTOBER premium depth ──────────────────────────────────────────────
      {id:"pr_deep",     name:"DEEP WATER",     color:"#2244aa", atk:0.30, rel:4.0, engine:"OCTOBER",   params:{lpHz:500,  lpQ:1.5, subMix:0.5, squareMix:0.0, detune:4},                                                                                desc:"Eau profonde — sine muffled, sub chaud"},
      {id:"pr_abyss",    name:"ABYSS",          color:"#112266", atk:0.50, rel:5.0, engine:"OCTOBER",   params:{lpHz:300,  lpQ:1.2, subMix:0.6, squareMix:0.0, detune:6},                                                                                desc:"Abîsse — graves intenses, muffled extrême"},
      {id:"pr_tide",     name:"MIDNIGHT TIDE",  color:"#3355bb", atk:0.20, rel:3.5, engine:"OCTOBER",   params:{lpHz:700,  lpQ:1.8, subMix:0.4, squareMix:0.0, detune:3},                                                                                desc:"Marée de minuit — mouvement lent et doux"},
      // ── BAGPIPES premium organic ───────────────────────────────────────────
      {id:"pr_chanter",  name:"HIGHLAND",       color:"#44aa44", atk:0.05, rel:1.5, engine:"BAGPIPES",  params:{pulseWidth:0.20, droneGain:0.40, droneLPHz:260, vibratoRate:5.5, vibratoDepth:0.010, brightness:2800, nasalQ:6.0},                       desc:"Highland — chanter traditionnel, drone profond"},
      {id:"pr_drone",    name:"CELTIC DRONE",   color:"#336633", atk:0.10, rel:2.0, engine:"BAGPIPES",  params:{pulseWidth:0.30, droneGain:0.60, droneLPHz:200, vibratoRate:4.0, vibratoDepth:0.008, brightness:2000, nasalQ:5.0},                       desc:"Drone celtique — ronflement grave, vibrato slow"},
      // ── ASTRO premium texture ──────────────────────────────────────────────
      {id:"pr_flute",    name:"ASTRO FLUTE",    color:"#8b5a00", atk:0.02, rel:1.8, engine:"ASTRO",     params:{wobbleRate:3.5, wobbleDepth:0.012, bitSteps:255, distAmount:1.2, lpHz:4500, lpQ:0.8},                                                    desc:"Flûte astro — douce, legère, Travis Scott"},
      {id:"pr_travis",   name:"TRAVIS MELODY",  color:"#5a3500", atk:0.02, rel:2.0, engine:"ASTRO",     params:{wobbleRate:2.0, wobbleDepth:0.008, bitSteps:255, distAmount:1.5, lpHz:3500, lpQ:1.0},                                                    desc:"Mélodie Travis — psychédélique doux, iconic"},
      // ── GUITAR premium pluck ───────────────────────────────────────────────
      {id:"pr_elec",     name:"ELECTRIC PLUCK", color:"#cc4400", atk:0.01, rel:1.5, engine:"GUITAR",    params:{waveType:"sawtooth",filterOpen:6000,filterClose:600,filterTime:0.08,filterQ:2.5,distAmount:1.8,detuneCents:4, bodyDecay:0.25,subMix:0.0},  desc:"Pluck électrique — attaque nette, corps défini"},
      {id:"pr_acoustic", name:"ACOUSTIC",       color:"#ddaa44", atk:0.01, rel:1.2, engine:"GUITAR",    params:{waveType:"sawtooth",filterOpen:4000,filterClose:800,filterTime:0.12,filterQ:2.0,distAmount:1.2,detuneCents:2, bodyDecay:0.30,subMix:0.0},  desc:"Acoustique — naturel, corps warm, pluck net"},
      // ── SAMURAI premium pluck ──────────────────────────────────────────────
      {id:"pr_koto",     name:"KOTO",           color:"#cc2200", atk:0.001,rel:1.2, engine:"SAMURAI",   params:{pluckDecay:0.30, resonance:4.0,  harmMix:0.30},                                                                                           desc:"Koto — corde japonaise traditionnelle, warm"},
      {id:"pr_sitar",    name:"SITAR",          color:"#aa3300", atk:0.001,rel:1.5, engine:"SAMURAI",   params:{pluckDecay:0.40, resonance:5.0,  harmMix:0.45},                                                                                           desc:"Sitar — riche en harmoniques, sustain boisé"},
      {id:"pr_shamisen", name:"SHAMISEN",       color:"#bb1100", atk:0.001,rel:0.8, engine:"SAMURAI",   params:{pluckDecay:0.20, resonance:3.5,  harmMix:0.20},                                                                                           desc:"Shamisen — sec et précis, attaque percussive"},
      // ── BASS808 premium subs ───────────────────────────────────────────────
      {id:"pr_808_god",  name:"808 GOD",        color:"#ff2200", atk:0.01, rel:2.5, engine:"BASS808",   params:{slideFrom:2.5, slideDur:0.10, distAmount:2.0, slideTarget:1.0, subMix:0.3},                                                               desc:"808 GOD — slide parfait, sub lourd, distorsion ronde"},
      {id:"pr_808_soft", name:"808 SOFT",       color:"#ff5500", atk:0.01, rel:3.0, engine:"BASS808",   params:{slideFrom:1.5, slideDur:0.06, distAmount:1.4, slideTarget:1.0, subMix:0.0},                                                               desc:"808 doux — slide court, pur et propre"},
      {id:"pr_808_hard", name:"808 HARD",       color:"#cc1100", atk:0.01, rel:2.0, engine:"BASS808",   params:{slideFrom:3.0, slideDur:0.14, distAmount:3.5, slideTarget:1.0, subMix:0.5},                                                               desc:"808 hard — slide long, distorsion max, punch"},
      // ── YEEZY premium ─────────────────────────────────────────────────────
      {id:"pr_cathedral",name:"CATHEDRAL",      color:"#c8a000", atk:1.00, rel:6.0, engine:"YEEZY",     params:{mode:2, hpHz:0,   satAmount:1.0, lpHz:4000, lpQ:0.6, subMix:0.5},                                                                        desc:"Cathédrale — sine+sub, résonance profonde"},
      {id:"pr_soulchop", name:"SOUL CHOP",      color:"#ddbb00", atk:0.01, rel:1.8, engine:"YEEZY",     params:{mode:0, hpHz:200, satAmount:1.0, lpHz:5000, lpQ:0.8, subMix:0.0},                                                                        desc:"Soul chop — triangle+HP, clarté soul propre"},
      {id:"pr_industry", name:"INDUSTRY",       color:"#aa8800", atk:0.01, rel:1.5, engine:"YEEZY",     params:{mode:1, hpHz:0,   satAmount:2.5, lpHz:6000, lpQ:1.5, subMix:0.3},                                                                        desc:"Industrie — square clipé, puissance brute"},
    ]
  },
};

const MELODY = [
  {note:"G#3",dur:0.7},{note:"C4",dur:0.7},{note:"E4",dur:0.7},
  {note:"G#3",dur:0.7},{note:"C4",dur:0.7},{note:"E4",dur:0.7},
  {note:"G#3",dur:0.7},{note:"C4",dur:0.7},{note:"E4",dur:0.7},
  {note:"A3", dur:0.7},{note:"C4",dur:0.7},{note:"E4",dur:0.7},
  {note:"A3", dur:0.7},{note:"C4",dur:0.7},{note:"E4",dur:0.7},
  {note:"A3", dur:0.7},{note:"C4",dur:0.7},{note:"E4",dur:0.7},
  {note:"G#3",dur:0.7},{note:"B3", dur:0.7},{note:"E4",dur:0.7},
  {note:"G#3",dur:0.7},{note:"B3", dur:0.7},{note:"D#4",dur:0.7},
  {note:"F#3",dur:0.7},{note:"A3", dur:0.7},{note:"D#4",dur:0.7},
  {note:"F#3",dur:0.7},{note:"A3", dur:0.7},{note:"C#4",dur:0.7},
  {note:"E3", dur:0.7},{note:"G#3",dur:0.7},{note:"C#4",dur:1.4},
];

const NOTE_HEIGHT = {
  "C3":4,"D3":6,"E3":8,"F3":10,"F#3":11,"G3":13,"G#3":15,"A3":17,"A#3":19,"B3":21,
  "C4":25,"C#4":27,"D4":29,"D#4":31,"E4":33,"F4":37
};

function Knob({ label, value, min, max, onChange, color="#e03030" }) {
  const startY = useRef(null); const startVal = useRef(null);
  const norm = (value-min)/(max-min); const angle = -135+norm*270;
  const onMouseDown = (e) => {
    startY.current=e.clientY; startVal.current=value;
    const move=(ev)=>onChange(Math.round(Math.min(max,Math.max(min,startVal.current+(startY.current-ev.clientY)/150*(max-min)))*100)/100);
    const up=()=>{window.removeEventListener("mousemove",move);window.removeEventListener("mouseup",up);};
    window.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
  };
  const gid=`kg-${label.replace(/\s/g,"")}`;
  return (
    <div className="knob-wrap" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,cursor:"ns-resize"}} onMouseDown={onMouseDown}>
      <svg width="48" height="48" viewBox="0 0 44 44">
        <defs>
          <radialGradient id={gid} cx="38%" cy="28%" r="65%">
            <stop offset="0%" stopColor="#2e2e48"/>
            <stop offset="100%" stopColor="#07070f"/>
          </radialGradient>
        </defs>
        {/* Track shadow */}
        <circle cx="22" cy="22" r="18" fill="none" stroke="#080810" strokeWidth="6"/>
        {/* Track base */}
        <circle cx="22" cy="22" r="18" fill="none" stroke="#1a1a2e" strokeWidth="4"
          strokeDasharray={`${(270/360)*2*Math.PI*18} ${2*Math.PI*18}`} strokeLinecap="round" transform="rotate(135 22 22)"/>
        {/* Active arc */}
        <circle cx="22" cy="22" r="18" fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${norm*(270/360)*2*Math.PI*18} ${2*Math.PI*18}`} strokeLinecap="round"
          transform="rotate(135 22 22)" style={{filter:`drop-shadow(0 0 6px ${color})`}}/>
        {/* Body with depth gradient */}
        <circle cx="22" cy="22" r="12" fill={`url(#${gid})`} stroke="#22223a" strokeWidth="1.5"/>
        {/* Highlight */}
        <circle cx="17" cy="17" r="3" fill="#ffffff09"/>
        {/* Indicator */}
        <line x1="22" y1="22" x2={22+8*Math.cos((angle-90)*Math.PI/180)} y2={22+8*Math.sin((angle-90)*Math.PI/180)}
          stroke="#fff" strokeWidth="2" strokeLinecap="round" style={{filter:`drop-shadow(0 0 3px ${color})`}}/>
      </svg>
      <div style={{fontSize:7,color:"#444",letterSpacing:2,fontFamily:"'Share Tech Mono',monospace"}}>{label}</div>
      <div style={{fontSize:9,color:color,fontFamily:"'Share Tech Mono',monospace",textShadow:`0 0 8px ${color}88`}}>{value.toFixed(2)}</div>
    </div>
  );
}

function Visualizer({ analyserRef, color }) {
  const canvasRef=useRef(null); const rafRef=useRef(null);
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const c=canvas.getContext("2d"); const W=canvas.width,H=canvas.height;
    const draw=()=>{
      rafRef.current=requestAnimationFrame(draw);
      c.fillStyle="#08080f"; c.fillRect(0,0,W,H);
      const a=analyserRef.current;
      if(!a){c.strokeStyle=color+"33";c.lineWidth=1;c.beginPath();c.moveTo(0,H/2);c.lineTo(W,H/2);c.stroke();return;}
      const buf=new Uint8Array(a.frequencyBinCount); a.getByteTimeDomainData(buf);
      c.strokeStyle=color; c.lineWidth=2; c.shadowColor=color; c.shadowBlur=8;
      c.beginPath();
      buf.forEach((v,i)=>{const x=(i/buf.length)*W;const y=((v/128)-1)*(H/2)+H/2;i===0?c.moveTo(x,y):c.lineTo(x,y);});
      c.stroke();
    };
    draw(); return ()=>cancelAnimationFrame(rafRef.current);
  },[analyserRef,color]);
  return <canvas ref={canvasRef} width={320} height={60} style={{width:"100%",height:60,borderRadius:4,border:"1px solid #1a1a2e"}}/>;
}

export default function SoulForgeSynth() {
  const audioCtxRef=useRef(null); const analyserRef=useRef(null);
  const activeNodes=useRef({}); const seqRef=useRef(null);

  const [activeFolder,setActiveFolderState]=useState("PADS");
  const [preset,setPresetState]=useState(BANK.PADS.presets[0]);
  const [activeKeys,setActiveKeys]=useState(new Set());
  const [octave,setOctave]=useState(0);
  const [volume,setVolume]=useState(0.75);
  const [reverb,setReverb]=useState(0.20);
  const [chorus,setChorus]=useState(0.18);
  const [attack,setAttack]=useState(0.4);
  const [release,setRelease]=useState(2.0);
  const [filter,setFilter]=useState(0.7);
  const [isPlaying,setIsPlaying]=useState(false);
  const [rollPos,setRollPos]=useState(-1);
  const [search,setSearch]=useState("");
  const [bpDemoPlaying,setBpDemoPlaying]=useState(false);
  const bpDroneRef=useRef(null);
  const bpTimersRef=useRef([]);

  const setPreset=(p)=>{if(!p)return;setPresetState(p);setAttack(p.atk);setRelease(p.rel);};
  const switchFolder=(f)=>{setActiveFolderState(f);setSearch("");const first=BANK[f].presets[0];if(first)setPreset(first);};

  const getCtx=useCallback(()=>{
    if(!audioCtxRef.current){
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      const analyser=ctx.createAnalyser(); analyser.fftSize=512;
      analyser.connect(ctx.destination);
      audioCtxRef.current=ctx; analyserRef.current=analyser;
    }
    if(audioCtxRef.current.state==="suspended") audioCtxRef.current.resume();
    return audioCtxRef.current;
  },[]);

  const midiToFreq=(midi)=>440*Math.pow(2,(midi-69)/12);

  const playNote=useCallback((noteObj)=>{
    const key=noteObj.note;
    if(activeNodes.current[key]) return;
    const ctx=getCtx();
    const freq=midiToFreq(noteObj.midi+octave*12);
    const p=preset; if(!p) return; const now=ctx.currentTime; const oscs=[];

    const masterGain=ctx.createGain();
    masterGain.gain.setValueAtTime(0,now);
    masterGain.gain.linearRampToValueAtTime(volume,now+attack);
    const lp=ctx.createBiquadFilter();
    lp.type="lowpass"; lp.frequency.value=Math.min(freq*(3+filter*8),18000); lp.Q.value=1.0;
    masterGain.connect(lp); lp.connect(analyserRef.current);

    // ══════════════════════════════════════════════════════════
    // STEINWAY — Piano à queue : synthèse additive + decay naturel
    // Technique : harmoniques impaires + paires équilibrées,
    // chaque partiel décroît à une vitesse différente
    // ══════════════════════════════════════════════════════════
    if(p.engine && ENGINES[p.engine]){
      ENGINES[p.engine](freq,now,ctx,masterGain,lp,oscs,release,p.params||{});
    }
    else if(!p.engine && ENGINES[activeFolder]){
      ENGINES[activeFolder](freq,now,ctx,masterGain,lp,oscs,release,p.params||{});
    }
    else if(p.id==="steinway"){
      // Click mécanique de marteau — attaque percussive
      const hammer=ctx.createOscillator(); const hammerG=ctx.createGain();
      hammer.type="square"; hammer.frequency.value=freq*8;
      hammerG.gain.setValueAtTime(0.15,now);
      hammerG.gain.exponentialRampToValueAtTime(0.001,now+0.025);
      hammer.connect(hammerG); hammerG.connect(masterGain); hammer.start(); oscs.push(hammer);

      // Harmoniques piano — décroissance progressive naturelle
      [[1,0.70,3.0],[2,0.35,2.2],[3,0.18,1.5],[4,0.10,1.0],[5,0.06,0.7],[6,0.03,0.5],[7,0.02,0.4],[8,0.01,0.3]].forEach(([ratio,gain,decay])=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*ratio;
        g.gain.setValueAtTime(gain,now+0.005);
        g.gain.exponentialRampToValueAtTime(0.001,now+decay*release);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,18000); lp.Q.value=0.5;
    }

    // ══════════════════════════════════════════════════════════
    // LOFI PIANO — Cassette tape : harmoniques réduites + saturation douce
    // Technique : waveshaper + légère instabilité de pitch (wow & flutter)
    // ══════════════════════════════════════════════════════════
    else if(p.id==="lofi_piano"){
      // Wow & flutter — instabilité cassette
      const wowLFO=ctx.createOscillator(); const wowG=ctx.createGain();
      wowLFO.type="sine"; wowLFO.frequency.value=0.6;
      wowG.gain.value=freq*0.003;
      wowLFO.start(); oscs.push(wowLFO);

      [[1,0.65,2.0],[2,0.22,1.2],[3,0.08,0.7],[4,0.03,0.4]].forEach(([ratio,gain,decay])=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="triangle"; o.frequency.value=freq*ratio;
        // Wow & flutter connecté
        wowG.connect(o.frequency);
        g.gain.setValueAtTime(gain,now+0.005);
        g.gain.exponentialRampToValueAtTime(0.001,now+decay*release);
        // Saturation douce = chaleur cassette
        const ws=ctx.createWaveShaper();
        const curve=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;curve[i]=Math.tanh(x*1.8);}
        ws.curve=curve;
        o.connect(ws); ws.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,4500); lp.Q.value=0.8;
    }

    // ══════════════════════════════════════════════════════════
    // RHODES — Piano électrique : synthèse FM + tine bell
    // Technique : FM avec ratio 1:1 = son métallique de lame vibrante
    // ══════════════════════════════════════════════════════════
    else if(p.id==="rhodes"){
      // FM principal — lame métallique du Rhodes
      const carrier=ctx.createOscillator(); const mod=ctx.createOscillator();
      const modG=ctx.createGain();
      carrier.type="sine"; carrier.frequency.value=freq;
      mod.type="sine"; mod.frequency.value=freq; // ratio 1:1 = Rhodes caractéristique
      // Index FM décroissant = attaque brillante puis s'adoucit
      modG.gain.setValueAtTime(freq*3.5,now);
      modG.gain.exponentialRampToValueAtTime(freq*0.2,now+0.8*release);
      mod.connect(modG); modG.connect(carrier.frequency);
      const carrierG=ctx.createGain();
      carrierG.gain.setValueAtTime(0.7,now+0.003);
      carrierG.gain.exponentialRampToValueAtTime(0.001,now+release*1.2);
      carrier.connect(carrierG); carrierG.connect(masterGain);
      carrier.start(); mod.start(); oscs.push(carrier,mod);

      // Bell harmonique — cloche métallique caractéristique du Rhodes
      const bell=ctx.createOscillator(); const bellG=ctx.createGain();
      bell.type="sine"; bell.frequency.value=freq*5.4; // ratio inharmonique = bell
      bellG.gain.setValueAtTime(0.12,now);
      bellG.gain.exponentialRampToValueAtTime(0.001,now+0.3);
      bell.connect(bellG); bellG.connect(masterGain); bell.start(); oscs.push(bell);

      // Sub doux = corps du Rhodes
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5;
      subG.gain.setValueAtTime(0.15,now);
      subG.gain.exponentialRampToValueAtTime(0.001,now+release);
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);

      lp.frequency.value=Math.min(freq*7,9000); lp.Q.value=1.2;
    }

    // ══════════════════════════════════════════════════════════
    // DARK PIANO — Piano cinématique sombre
    // Technique : harmoniques graves dominantes + résonance de cordes
    // ══════════════════════════════════════════════════════════
    else if(p.id==="dark_piano"){
      // Résonance de caisse grave = corps du piano cinématique
      const body=ctx.createOscillator(); const bodyG=ctx.createGain();
      body.type="triangle"; body.frequency.value=freq*0.5;
      bodyG.gain.setValueAtTime(0.40,now+0.002);
      bodyG.gain.exponentialRampToValueAtTime(0.001,now+release*1.5);
      body.connect(bodyG); bodyG.connect(masterGain); body.start(); oscs.push(body);

      // Fondamentale avec décroissance lente
      [[1,0.50,1.0],[2,0.12,0.6],[3,0.04,0.3]].forEach(([ratio,gain,dec])=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*ratio;
        g.gain.setValueAtTime(gain,now+0.002);
        g.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });

      // Résonance sympathique = cordes qui vibrent en arrière-plan
      const res=ctx.createBiquadFilter();
      res.type="bandpass"; res.frequency.value=freq*1.5; res.Q.value=12;
      const resOsc=ctx.createOscillator(); const resG=ctx.createGain();
      resOsc.type="sawtooth"; resOsc.frequency.value=freq;
      resG.gain.value=0.08;
      resOsc.connect(resG); resG.connect(res); res.connect(masterGain);
      resOsc.start(); oscs.push(resOsc);

      lp.frequency.value=Math.min(freq*3,2500); lp.Q.value=1.5;
    }

    // ══════════════════════════════════════════════════════════
    // TOY PIANO — Piano jouet : métallique, aigu, imparfait
    // Technique : harmoniques très inharmoniques + decay ultra-court
    // ══════════════════════════════════════════════════════════
    else if(p.id==="toy_piano"){
      // Barre métallique — inharmonique comme un vrai piano jouet
      [[1,0.60,0.6],[2.76,0.35,0.35],[5.40,0.15,0.2],[8.93,0.06,0.1]].forEach(([ratio,gain,dec])=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*ratio;
        g.gain.setValueAtTime(gain,now+0.001);
        g.gain.exponentialRampToValueAtTime(0.001,now+dec*Math.max(release,0.5));
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      // Click plastique = marteau du toy piano
      const click=ctx.createOscillator(); const clickG=ctx.createGain();
      click.type="square"; click.frequency.value=freq*6;
      clickG.gain.setValueAtTime(0.20,now);
      clickG.gain.exponentialRampToValueAtTime(0.001,now+0.015);
      click.connect(clickG); clickG.connect(masterGain); click.start(); oscs.push(click);
      lp.frequency.value=Math.min(freq*10,16000); lp.Q.value=0.3;
    }

    // ══ UPRIGHT — Caisse en bois + harmoniques étranglées ══
    else if(p.id==="upright"){
      const hammer=ctx.createOscillator(); const hG=ctx.createGain();
      hammer.type="square"; hammer.frequency.value=freq*6;
      hG.gain.setValueAtTime(0.10,now); hG.gain.exponentialRampToValueAtTime(0.001,now+0.02);
      hammer.connect(hG); hG.connect(masterGain); hammer.start(); oscs.push(hammer);
      [[1,0.55,2.0],[2,0.22,1.2],[3,0.10,0.7],[4,0.05,0.4],[5,0.02,0.25]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.005); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      // Résonance caisse bois = corps upright
      const wood=ctx.createBiquadFilter(); wood.type="bandpass"; wood.frequency.value=freq*0.7; wood.Q.value=6;
      const woodOsc=ctx.createOscillator(); const woodG=ctx.createGain();
      woodOsc.type="triangle"; woodOsc.frequency.value=freq*0.5; woodG.gain.value=0.15;
      woodOsc.connect(woodG); woodG.connect(wood); wood.connect(masterGain); woodOsc.start(); oscs.push(woodOsc);
      lp.frequency.value=Math.min(freq*8,10000); lp.Q.value=0.6;
    }
    // ══ BOUDOIR — Baby grand intime, harmoniques rondes ══
    else if(p.id==="boudoir"){
      [[1,0.65,2.2],[2,0.28,1.5],[3,0.12,0.9],[4,0.06,0.5],[6,0.02,0.3]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.004); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*9,12000); lp.Q.value=0.4;
    }
    // ══ CONCERT — Grand concert majestueux, riche en partiels ══
    else if(p.id==="concert"){
      const click=ctx.createOscillator(); const cG=ctx.createGain();
      click.type="square"; click.frequency.value=freq*10;
      cG.gain.setValueAtTime(0.18,now); cG.gain.exponentialRampToValueAtTime(0.001,now+0.018);
      click.connect(cG); cG.connect(masterGain); click.start(); oscs.push(click);
      [[1,0.72,3.5],[2,0.38,2.5],[3,0.20,1.8],[4,0.12,1.2],[5,0.07,0.8],[6,0.04,0.5],[7,0.02,0.35],[8,0.01,0.25],[9,0.005,0.15]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*14,18000); lp.Q.value=0.3;
    }
    // ══ BAROQUE — Clavecin style, attaque mordante ══
    else if(p.id==="baroque"){
      [[1,0.60,1.0],[2,0.45,0.6],[3,0.25,0.4],[4,0.15,0.25],[5,0.08,0.15],[6,0.04,0.1]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type=r<=2?"sawtooth":"sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*7,9000); lp.Q.value=1.5;
    }
    // ══ CASSETTE — Dégradation tape extrême + flutter intense ══
    else if(p.id==="cassette"){
      const flutter=ctx.createOscillator(); const flG=ctx.createGain();
      flutter.type="sine"; flutter.frequency.value=1.8; flG.gain.value=freq*0.012;
      flutter.start(); oscs.push(flutter);
      [[1,0.55,1.5],[2,0.18,0.8],[3,0.05,0.4]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="triangle"; o.frequency.value=freq*r;
        flutter.connect(flG); flG.connect(o.frequency);
        gn.gain.setValueAtTime(g,now+0.008); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.tanh(x*2.5);}
        ws.curve=cv; o.connect(ws); ws.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,3000); lp.Q.value=1.2;
    }
    // ══ DUSTY — Vinyle craquelé + harmoniques atténuées ══
    else if(p.id==="dusty"){
      [[1,0.50,1.4],[2,0.15,0.7],[3,0.04,0.35]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="triangle"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.01); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*3,2000); lp.Q.value=0.8;
    }
    // ══ MIDNIGHT — Lo-fi chambre la nuit, intime ══
    else if(p.id==="midnight"){
      const wow=ctx.createOscillator(); const wG=ctx.createGain();
      wow.type="sine"; wow.frequency.value=0.4; wG.gain.value=freq*0.005;
      wow.start(); oscs.push(wow);
      [[1,0.48,1.6],[2,0.12,0.9],[3,0.03,0.4]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        wow.connect(wG); wG.connect(o.frequency);
        gn.gain.setValueAtTime(g,now+0.012); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,2800); lp.Q.value=0.7;
    }
    // ══ WABI — Imperfection japonaise, micro-désaccord ══
    else if(p.id==="wabi"){
      [0,3,-3,7,-7].forEach((cents,i)=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f;
        g.gain.setValueAtTime(0.25-i*0.04,now+0.015); g.gain.exponentialRampToValueAtTime(0.001,now+(1.2-i*0.1)*release);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,4500); lp.Q.value=0.5;
    }
    // ══ WURLITZER — FM mordant, bark électrique ══
    else if(p.id==="wurlitzer"){
      const wc=ctx.createOscillator(); const wm=ctx.createOscillator(); const wmg=ctx.createGain();
      wc.type="sine"; wc.frequency.value=freq;
      wm.type="sine"; wm.frequency.value=freq*1.0; // ratio 1 = caractère Wurly
      wmg.gain.setValueAtTime(freq*4.5,now); wmg.gain.exponentialRampToValueAtTime(freq*0.5,now+0.5*release);
      wm.connect(wmg); wmg.connect(wc.frequency);
      const wcg=ctx.createGain(); wcg.gain.setValueAtTime(0.65,now+0.003); wcg.gain.exponentialRampToValueAtTime(0.001,now+release);
      wc.connect(wcg); wcg.connect(masterGain); wc.start(); wm.start(); oscs.push(wc,wm);
      // Bell Wurly = harmonique mordante
      const bell=ctx.createOscillator(); const bG=ctx.createGain();
      bell.type="sine"; bell.frequency.value=freq*3.0;
      bG.gain.setValueAtTime(0.18,now); bG.gain.exponentialRampToValueAtTime(0.001,now+0.25);
      bell.connect(bG); bG.connect(masterGain); bell.start(); oscs.push(bell);
      lp.frequency.value=Math.min(freq*8,11000); lp.Q.value=1.8;
    }
    // ══ CLAVINET — FM funky, attaque chop ══
    else if(p.id==="clavinet"){
      const cc=ctx.createOscillator(); const cm=ctx.createOscillator(); const cmg=ctx.createGain();
      cc.type="sine"; cc.frequency.value=freq;
      cm.type="sine"; cm.frequency.value=freq*2.5;
      cmg.gain.setValueAtTime(freq*5.0,now); cmg.gain.exponentialRampToValueAtTime(freq*0.1,now+0.12);
      cm.connect(cmg); cmg.connect(cc.frequency);
      const ccg=ctx.createGain(); ccg.gain.setValueAtTime(0.60,now+0.001); ccg.gain.exponentialRampToValueAtTime(0.001,now+release*0.7);
      cc.connect(ccg); ccg.connect(masterGain); cc.start(); cm.start(); oscs.push(cc,cm);
      lp.frequency.value=Math.min(freq*5,7000); lp.Q.value=2.5;
    }
    // ══ DYNO RHODES — FM brillant punchy ══
    else if(p.id==="dyno"){
      const dc=ctx.createOscillator(); const dm=ctx.createOscillator(); const dmg=ctx.createGain();
      dc.type="sine"; dc.frequency.value=freq;
      dm.type="sine"; dm.frequency.value=freq*1.0;
      dmg.gain.setValueAtTime(freq*5.0,now); dmg.gain.exponentialRampToValueAtTime(freq*0.3,now+0.6*release);
      dm.connect(dmg); dmg.connect(dc.frequency);
      const dcg=ctx.createGain(); dcg.gain.setValueAtTime(0.70,now+0.002); dcg.gain.exponentialRampToValueAtTime(0.001,now+release*1.1);
      dc.connect(dcg); dcg.connect(masterGain); dc.start(); dm.start(); oscs.push(dc,dm);
      const b2=ctx.createOscillator(); const b2G=ctx.createGain();
      b2.type="sine"; b2.frequency.value=freq*7.0;
      b2G.gain.setValueAtTime(0.20,now); b2G.gain.exponentialRampToValueAtTime(0.001,now+0.20);
      b2.connect(b2G); b2G.connect(masterGain); b2.start(); oscs.push(b2);
      lp.frequency.value=Math.min(freq*10,14000); lp.Q.value=2.0;
    }
    // ══ SUITCASE RHODES — FM profond et chaud ══
    else if(p.id==="suitcase"){
      const sc=ctx.createOscillator(); const sm=ctx.createOscillator(); const smg=ctx.createGain();
      sc.type="sine"; sc.frequency.value=freq;
      sm.type="sine"; sm.frequency.value=freq*1.0;
      smg.gain.setValueAtTime(freq*2.2,now); smg.gain.exponentialRampToValueAtTime(freq*0.15,now+1.0*release);
      sm.connect(smg); smg.connect(sc.frequency);
      const scg=ctx.createGain(); scg.gain.setValueAtTime(0.55,now+0.004); scg.gain.exponentialRampToValueAtTime(0.001,now+release*1.4);
      sc.connect(scg); scg.connect(masterGain); sc.start(); sm.start(); oscs.push(sc,sm);
      const ssub=ctx.createOscillator(); const ssubG=ctx.createGain();
      ssub.type="sine"; ssub.frequency.value=freq*0.5; ssubG.gain.value=0.20;
      ssub.connect(ssubG); ssubG.connect(masterGain); ssub.start(); oscs.push(ssub);
      lp.frequency.value=Math.min(freq*6,8000); lp.Q.value=0.9;
    }
    // ══ REQUIEM — Piano funèbre, lent et profond ══
    else if(p.id==="requiem"){
      [[1,0.60,4.0],[2,0.20,2.5],[3,0.06,1.5],[0.5,0.35,5.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.018); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*2,1500); lp.Q.value=2.0;
    }
    // ══ NOIR — Film noir, pluie froide ══
    else if(p.id==="noir"){
      [[1,0.55,2.8],[2,0.18,1.8],[3,0.06,1.0],[0.5,0.30,3.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.008); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const res=ctx.createBiquadFilter(); res.type="bandpass"; res.frequency.value=freq*0.7; res.Q.value=8;
      const rOsc=ctx.createOscillator(); const rG=ctx.createGain();
      rOsc.type="sine"; rOsc.frequency.value=freq*0.5; rG.gain.value=0.08;
      rOsc.connect(rG); rG.connect(res); res.connect(masterGain); rOsc.start(); oscs.push(rOsc);
      lp.frequency.value=Math.min(freq*3,2200); lp.Q.value=1.5;
    }
    // ══ GOTHIC — Cathédrale, résonance de pierre ══
    else if(p.id==="gothic"){
      [[1,0.50,3.5],[2,0.14,2.0],[3,0.05,1.0],[0.5,0.40,4.5],[0.25,0.15,5.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.014); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=0.05; lfoG.gain.value=0.04;
      lfo.connect(lfoG); lfoG.connect(masterGain.gain); lfo.start(); oscs.push(lfo);
      lp.frequency.value=Math.min(freq*2,1200); lp.Q.value=3.0;
    }
    // ══ ABYSS_P — Piano abyssal, sub-grave ══
    else if(p.id==="abyss_p"){
      [[1,0.45,4.5],[0.5,0.50,5.5],[0.25,0.25,6.0],[2,0.08,2.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.028); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*1.2,500); lp.Q.value=4.0;
    }
    // ══ MUSICBOX — Boîte à musique, mécanique délicate ══
    else if(p.id==="musicbox"){
      [[1,0.70,1.5],[2.76,0.30,0.8],[5.40,0.10,0.4],[8.93,0.04,0.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*8,12000); lp.Q.value=1.0;
    }
    // ══ KALIMBA — Lamelles métalliques africaines ══
    else if(p.id==="kalimba"){
      [[1,0.65,2.0],[4.0,0.25,1.0],[9.0,0.08,0.5],[1.0015,0.15,2.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,14000); lp.Q.value=0.5;
    }
    // ══ XYLOPHONE — Barres en bois percussives ══
    else if(p.id==="xylophone"){
      [[1,0.80,0.6],[3.0,0.30,0.3],[6.0,0.10,0.15]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const stick=ctx.createOscillator(); const stG=ctx.createGain();
      stick.type="square"; stick.frequency.value=freq*12;
      stG.gain.setValueAtTime(0.25,now); stG.gain.exponentialRampToValueAtTime(0.001,now+0.01);
      stick.connect(stG); stG.connect(masterGain); stick.start(); oscs.push(stick);
      lp.frequency.value=Math.min(freq*9,14000); lp.Q.value=0.4;
    }
    // ══ GLOCKENSPIEL — Lames métalliques orchestrales ══
    else if(p.id==="glocken"){
      [[1,0.75,1.8],[2.76,0.22,0.9],[5.40,0.08,0.45]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*11,16000); lp.Q.value=0.6;
    }
    // ══ PREPARED — Piano préparé Cage style ══
    else if(p.id==="prepared"){
      [[1,0.50,2.0],[1.12,0.30,1.5],[1.87,0.20,1.0],[2.35,0.10,0.6],[4.10,0.05,0.3]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.008); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,7000); lp.Q.value=2.0;
    }
    // ══ CLUSTER — Cluster de tons, dense ══
    else if(p.id==="cluster"){
      [-7,-5,-3,-1,0,1,3,5,7].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f;
        g.gain.setValueAtTime(0.12,now+0.006); g.gain.exponentialRampToValueAtTime(0.001,now+2.0*release);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,8000); lp.Q.value=1.0;
    }
    // ══ INSIDE — Cordes pincées à l'intérieur ══
    else if(p.id==="inside"){
      [[1,0.60,1.8],[1.003,0.15,2.0],[2.0,0.08,0.8],[3.0,0.04,0.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="triangle"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,5000); lp.Q.value=1.5;
    }
    // ══ BOWED — Cordes frottées à l'archet ══
    else if(p.id==="bowed"){
      [1,2,3].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.25/(i+1),now+0.6);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=5.2; lfoG.gain.value=freq*0.003;
      lfo.connect(lfoG); lfoG.connect(masterGain.gain); lfo.start(); oscs.push(lfo);
      lp.frequency.value=Math.min(freq*4,4000); lp.Q.value=1.0;
    }
    // ══ DETUNED — Micro-tonal tordu ══
    else if(p.id==="detuned"){
      [-35,-20,-10,-3,0,3,10,20,35].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f; g.gain.value=0.09;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,6000); lp.Q.value=0.8;
    }
    // ══ JAZZ — Doux swing, harmoniques médium ══
    else if(p.id==="jazz_p"){
      [[1,0.60,1.2],[2,0.25,0.7],[3,0.12,0.4],[4,0.05,0.25]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.004); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*7,8000); lp.Q.value=0.7;
    }
    // ══ BEBOP — Attaque rapide, brillant ══
    else if(p.id==="bebop"){
      const snap=ctx.createOscillator(); const snG=ctx.createGain();
      snap.type="square"; snap.frequency.value=freq*5;
      snG.gain.setValueAtTime(0.15,now); snG.gain.exponentialRampToValueAtTime(0.001,now+0.015);
      snap.connect(snG); snG.connect(masterGain); snap.start(); oscs.push(snap);
      [[1,0.65,1.0],[2,0.30,0.6],[3,0.14,0.35],[4,0.06,0.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*9,13000); lp.Q.value=1.0;
    }
    // ══ BALLAD — Ballade jazz tendre ══
    else if(p.id==="ballad"){
      [[1,0.58,2.0],[2,0.22,1.2],[3,0.08,0.6],[1.5,0.06,1.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.007); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,7500); lp.Q.value=0.5;
    }
    // ══ SMOKY — Bar enfumé, rough edges ══
    else if(p.id==="smoky"){
      [[1,0.52,1.6],[2,0.20,0.9],[3,0.07,0.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="triangle"; o.frequency.value=freq*r;
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.tanh(x*1.5);}
        ws.curve=cv; gn.gain.setValueAtTime(g,now+0.010); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(ws); ws.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,5500); lp.Q.value=1.2;
    }
    // ══ STRIDE — Ragtime énergie ══
    else if(p.id==="stride"){
      const stk=ctx.createOscillator(); const stkG=ctx.createGain();
      stk.type="square"; stk.frequency.value=freq*7;
      stkG.gain.setValueAtTime(0.12,now); stkG.gain.exponentialRampToValueAtTime(0.001,now+0.012);
      stk.connect(stkG); stkG.connect(masterGain); stk.start(); oscs.push(stk);
      [[1,0.62,1.1],[2,0.28,0.65],[3,0.12,0.38],[4,0.05,0.22]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,14000); lp.Q.value=0.8;
    }
    // ══ AMBIENT — Sustain infini, espace total ══
    else if(p.id==="ambient_p"){
      [1,2,3,4].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.25/(i+1),now+0.5);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=0.06; lfoG.gain.value=0.03;
      lfo.connect(lfoG); lfoG.connect(masterGain.gain); lfo.start(); oscs.push(lfo);
      lp.frequency.value=Math.min(freq*5,7000); lp.Q.value=0.4;
    }
    // ══ REVERB_P — Salle cathédrale ══
    else if(p.id==="reverb_p"){
      [[1,0.65,4.0],[2,0.25,3.0],[3,0.08,2.0],[4,0.03,1.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.008); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*7,10000); lp.Q.value=0.3;
    }
    // ══ SPACE_P — Piano apesanteur ══
    else if(p.id==="space_p"){
      [1,1.5,2,3,4].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.22/(i+1),now+0.3+i*0.1);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=0.04; lfoG.gain.value=freq*0.002;
      lfo.connect(lfoG); lfoG.connect(masterGain.gain); lfo.start(); oscs.push(lfo);
      lp.type="bandpass"; lp.frequency.value=freq*2.5; lp.Q.value=3.0;
    }
    // ══ SHIMMER — Pad brillant + scintillement ══
    else if(p.id==="shimmer"){
      [1,2,4,8].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.20/(i+1),now+0.2+i*0.08);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=6.0; lfoG.gain.value=freq*0.002;
      lfo.connect(lfoG); lfoG.connect(masterGain.gain); lfo.start(); oscs.push(lfo);
      lp.frequency.value=Math.min(freq*12,18000); lp.Q.value=1.5;
    }
    // ══ FROZEN — Attaque ultra lente, glace ══
    else if(p.id==="frozen"){
      [1,1.003,2,3].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.22/(i+1),now+1.0);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,5000); lp.Q.value=0.5;
    }
    // ══ TRAP_P — Piano trap, companion 808 ══
    else if(p.id==="trap_p"){
      [[1,0.62,1.5],[2,0.24,0.9],[3,0.08,0.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.18;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=Math.min(freq*5,5000); lp.Q.value=1.0;
    }
    // ══ DRILL_P — Drill froid et mineur ══
    else if(p.id==="drill_p"){
      [[1,0.58,1.2],[2,0.20,0.7],[3,0.06,0.35]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,4500); lp.Q.value=2.0;
    }
    // ══ CLOUD_P — Cloud rap rêveur ══
    else if(p.id==="cloud_p"){
      const wow2=ctx.createOscillator(); const wG2=ctx.createGain();
      wow2.type="sine"; wow2.frequency.value=0.5; wG2.gain.value=freq*0.006;
      wow2.start(); oscs.push(wow2);
      [[1,0.55,2.0],[2,0.18,1.2],[3,0.05,0.6]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        wow2.connect(wG2); wG2.connect(o.frequency);
        gn.gain.setValueAtTime(g,now+0.007); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,5500); lp.Q.value=0.6;
    }
    // ══ OPIUM_P — Opium hazy ══
    else if(p.id==="opium_p"){
      [-6,-2,0,2,6].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="triangle"; o.frequency.value=f; g.gain.value=0.14;
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.tanh(x*1.2);}
        ws.curve=cv; o.connect(ws); ws.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,4000); lp.Q.value=1.5;
    }
    // ══ EMOTRAP — Emo trap nostalgique ══
    else if(p.id==="emo_trap"){
      [[1,0.55,2.5],[2,0.15,1.5],[3,0.04,0.7],[0.5,0.20,3.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.009); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfo2=ctx.createOscillator(); const lfoG2=ctx.createGain();
      lfo2.type="sine"; lfo2.frequency.value=4.5; lfoG2.gain.value=freq*0.002;
      lfo2.connect(lfoG2); lfoG2.connect(masterGain.gain); lfo2.start(); oscs.push(lfo2);
      lp.frequency.value=Math.min(freq*4,3800); lp.Q.value=0.9;
    }
    // ══ KOTO — Cordes de soie japonaises ══
    else if(p.id==="koto"){
      [[1,0.65,1.5],[2,0.35,0.8],[3,0.15,0.4],[4,0.06,0.2],[1.003,0.12,1.8]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*7,9000); lp.Q.value=1.2;
    }
    // ══ GAMELAN — Cloches de bronze balinaises ══
    else if(p.id==="gamelan"){
      [[1,0.60,2.5],[2.76,0.35,1.2],[5.40,0.18,0.6],[10.9,0.06,0.3]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,16000); lp.Q.value=0.5;
    }
    // ══ SITAR_P — Cordes sitar + bourdon ══
    else if(p.id==="sitar_p"){
      [[1,0.55,1.8],[2,0.30,1.0],[3,0.15,0.6],[4,0.07,0.3],[1.003,0.20,2.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type=r<2?"sawtooth":"sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const drone=ctx.createOscillator(); const dG=ctx.createGain();
      drone.type="sine"; drone.frequency.value=freq*0.5; dG.gain.value=0.10;
      drone.connect(dG); dG.connect(masterGain); drone.start(); oscs.push(drone);
      lp.frequency.value=Math.min(freq*5,6000); lp.Q.value=1.8;
    }
    // ══ MBIRA — Lamelles métal africain ══
    else if(p.id==="mbira"){
      [[1,0.70,1.2],[4.0,0.28,0.55],[9.0,0.10,0.28],[1.0018,0.18,1.4]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*8,11000); lp.Q.value=0.8;
    }
    // ══ SANTUR — Dulcimer persan ══
    else if(p.id==="santur"){
      [[1,0.60,2.0],[2,0.32,1.1],[3,0.16,0.6],[4,0.07,0.35],[1.002,0.14,2.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*8,10000); lp.Q.value=1.0;
    }
    // ══ HONKY TONK — Saloon désaccordé ══
    else if(p.id==="honky"){
      [-25,-15,-5,0,5,15,25].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f; g.gain.value=0.10;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      [[2,0.18,0.6],[3,0.07,0.3]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.004); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*8,10000); lp.Q.value=0.8;
    }
    // ══ RAG — Ragtime rebondissant ══
    else if(p.id==="rag"){
      const rSnap=ctx.createOscillator(); const rsG=ctx.createGain();
      rSnap.type="square"; rSnap.frequency.value=freq*6;
      rsG.gain.setValueAtTime(0.12,now); rsG.gain.exponentialRampToValueAtTime(0.001,now+0.014);
      rSnap.connect(rsG); rsG.connect(masterGain); rSnap.start(); oscs.push(rSnap);
      [[1,0.62,1.2],[2,0.30,0.70],[3,0.13,0.40],[4,0.05,0.22]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*9,12000); lp.Q.value=0.9;
    }
    // ══ SILENT ERA — Salon 1920 ══
    else if(p.id==="silent_era"){
      [[1,0.60,0.9],[2,0.25,0.55],[3,0.10,0.30],[4,0.04,0.18]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.tanh(x*1.3);}
        ws.curve=cv; o.connect(ws); ws.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,5000); lp.Q.value=1.5;
    }
    // ══ MOTOWN — Soul électrique ══
    else if(p.id==="motown"){
      const mc=ctx.createOscillator(); const mm=ctx.createOscillator(); const mmg=ctx.createGain();
      mc.type="sine"; mc.frequency.value=freq;
      mm.type="sine"; mm.frequency.value=freq*1.0;
      mmg.gain.setValueAtTime(freq*3.8,now); mmg.gain.exponentialRampToValueAtTime(freq*0.4,now+0.55*release);
      mm.connect(mmg); mmg.connect(mc.frequency);
      const mcg=ctx.createGain(); mcg.gain.setValueAtTime(0.65,now+0.003); mcg.gain.exponentialRampToValueAtTime(0.001,now+release);
      mc.connect(mcg); mcg.connect(masterGain); mc.start(); mm.start(); oscs.push(mc,mm);
      lp.frequency.value=Math.min(freq*7,9000); lp.Q.value=1.5;
    }
    // ══ GLAMROCK — Piano dramatique glam ══
    else if(p.id==="glamrock"){
      [-6,-2,0,2,6].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=f; g.gain.value=0.14;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      [[2,0.15,0.5],[3,0.05,0.25]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*7,10000); lp.Q.value=2.0;
    }
    // ══ MELANCHOLY — Mélancolie pure ══
    else if(p.id==="melancholy"){
      [[1,0.55,3.0],[2,0.15,1.8],[3,0.04,0.8],[0.5,0.22,3.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.009); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=4.0; vibG.gain.value=freq*0.002;
      vib.connect(vibG); vibG.connect(masterGain.gain); vib.start(); oscs.push(vib);
      lp.frequency.value=Math.min(freq*4,3500); lp.Q.value=1.0;
    }
    // ══ HOPE — Piano lumière du matin ══
    else if(p.id==="hope"){
      [[1,0.60,2.5],[2,0.30,1.5],[3,0.14,0.8],[4,0.06,0.4],[5,0.02,0.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.007); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*9,13000); lp.Q.value=0.4;
    }
    // ══ ANGER — Piano agressif et martelé ══
    else if(p.id==="anger"){
      const hrd=ctx.createOscillator(); const hrdG=ctx.createGain();
      hrd.type="square"; hrd.frequency.value=freq*8;
      hrdG.gain.setValueAtTime(0.25,now); hrdG.gain.exponentialRampToValueAtTime(0.001,now+0.025);
      hrd.connect(hrdG); hrdG.connect(masterGain); hrd.start(); oscs.push(hrd);
      [[1,0.70,0.8],[2,0.35,0.5],[3,0.15,0.3]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.sign(x)*Math.pow(Math.abs(x),0.5);}
        ws.curve=cv; o.connect(ws); ws.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,9000); lp.Q.value=2.5;
    }
    // ══ TENDER — Douceur absolue ══
    else if(p.id==="tender"){
      [[1,0.52,2.8],[2,0.16,1.6],[3,0.04,0.7]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.013); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,4000); lp.Q.value=0.4;
    }
    // ══ NOSTALGIA — Nostalgie enfance ══
    else if(p.id==="nostalgia"){
      const n_wow=ctx.createOscillator(); const n_wG=ctx.createGain();
      n_wow.type="sine"; n_wow.frequency.value=0.35; n_wG.gain.value=freq*0.004;
      n_wow.start(); oscs.push(n_wow);
      [[1,0.58,2.5],[2,0.20,1.4],[3,0.06,0.7]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        n_wow.connect(n_wG); n_wG.connect(o.frequency);
        gn.gain.setValueAtTime(g,now+0.011); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,5000); lp.Q.value=0.7;
    }
    // ══ FM GRAND — DX7 style ══
    else if(p.id==="fm_grand"){
      [[freq,freq*1.0,freq*3.5,0.65,2.8,0.4,2.0],[freq*2,freq*2.0,freq*7.0,0.20,1.5,0.1,1.2]].forEach(([cf,mf_base,mf,cg,mi,mf2,md])=>{
        const fc=ctx.createOscillator(); const fm=ctx.createOscillator(); const fmg=ctx.createGain();
        fc.type="sine"; fc.frequency.value=cf;
        fm.type="sine"; fm.frequency.value=mf;
        fmg.gain.setValueAtTime(cf*mi,now); fmg.gain.exponentialRampToValueAtTime(cf*mf2,now+md);
        fm.connect(fmg); fmg.connect(fc.frequency);
        const fcg=ctx.createGain(); fcg.gain.value=cg;
        fc.connect(fcg); fcg.connect(masterGain); fc.start(); fm.start(); oscs.push(fc,fm);
      });
      lp.frequency.value=Math.min(freq*10,15000); lp.Q.value=0.5;
    }
    // ══ FM SOFT — Cloches douces FM ══
    else if(p.id==="fm_soft"){
      const fsc=ctx.createOscillator(); const fsm=ctx.createOscillator(); const fsmg=ctx.createGain();
      fsc.type="sine"; fsc.frequency.value=freq;
      fsm.type="sine"; fsm.frequency.value=freq*2.0;
      fsmg.gain.setValueAtTime(freq*1.2,now); fsmg.gain.exponentialRampToValueAtTime(freq*0.08,now+1.5*release);
      fsm.connect(fsmg); fsmg.connect(fsc.frequency);
      const fscg=ctx.createGain(); fscg.gain.setValueAtTime(0.55,now+0.006); fscg.gain.exponentialRampToValueAtTime(0.001,now+release*1.5);
      fsc.connect(fscg); fscg.connect(masterGain); fsc.start(); fsm.start(); oscs.push(fsc,fsm);
      lp.frequency.value=Math.min(freq*6,8000); lp.Q.value=0.6;
    }
    // ══ ADDITIVE — Synthèse additive pure ══
    else if(p.id==="additive_p"){
      [[1,1/1],[2,1/2],[3,1/3],[4,1/4],[5,1/5],[6,1/6],[7,1/7],[8,1/8]].forEach(([r,g])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r; gn.gain.value=g*0.45;
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,14000); lp.Q.value=0.4;
    }
    // ══ WAVETABLE — Morphing entre formes d'onde ══
    else if(p.id==="wavetable_p"){
      ["sine","triangle","sawtooth"].forEach((type,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type=type; o.frequency.value=freq; g.gain.value=0.22;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfoW=ctx.createOscillator(); const lfoWG=ctx.createGain();
      lfoW.type="sine"; lfoW.frequency.value=0.2; lfoWG.gain.value=freq*0.003;
      lfoW.connect(lfoWG); lfoWG.connect(masterGain.gain); lfoW.start(); oscs.push(lfoW);
      lp.frequency.value=Math.min(freq*7,10000); lp.Q.value=1.0;
    }
    // ══ GRANULAR — Piano granulaire fragmenté ══
    else if(p.id==="granular_p"){
      for(let i=0;i<6;i++){
        const f=freq*Math.pow(2,(Math.random()*20-10)/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f;
        g.gain.setValueAtTime(0,now+i*0.05); g.gain.linearRampToValueAtTime(0.15,now+i*0.05+0.1); g.gain.linearRampToValueAtTime(0,now+i*0.05+0.3);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      }
      lp.frequency.value=Math.min(freq*6,7000); lp.Q.value=1.5;
    }
    // ══ RAIN_P — Gouttes de pluie sur le clavier ══
    else if(p.id==="rain_p"){
      [[1,0.55,3.0],[2,0.18,2.0],[3,0.05,1.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.009); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfoR=ctx.createOscillator(); const lfoRG=ctx.createGain();
      lfoR.type="sine"; lfoR.frequency.value=0.8; lfoRG.gain.value=0.03;
      lfoR.connect(lfoRG); lfoRG.connect(masterGain.gain); lfoR.start(); oscs.push(lfoR);
      lp.frequency.value=Math.min(freq*5,6000); lp.Q.value=0.8;
    }
    // ══ FOREST_P — Résonance bois et air ══
    else if(p.id==="forest_p"){
      [[1,0.50,3.5],[1.5,0.15,2.0],[3,0.06,1.0],[0.5,0.20,4.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="triangle"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.018); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*3,3500); lp.Q.value=0.6;
    }
    // ══ CAVE_P — Écho de pierre ══
    else if(p.id==="cave_p"){
      [[1,0.60,4.0],[2,0.12,2.5],[3,0.03,1.2],[0.5,0.25,5.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.014); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*3,2500); lp.Q.value=2.5;
    }
    // ══ OCEAN_P — Vagues lentes ══
    else if(p.id==="ocean_p"){
      [1,2,3].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.25/(i+1),now+0.3);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const wave=ctx.createOscillator(); const waveG=ctx.createGain();
      wave.type="sine"; wave.frequency.value=0.08; waveG.gain.value=0.06;
      wave.connect(waveG); waveG.connect(masterGain.gain); wave.start(); oscs.push(wave);
      lp.frequency.value=Math.min(freq*4,5000); lp.Q.value=0.5;
    }
    // ══ WIND_P — Vent dans les cordes ══
    else if(p.id==="wind_p"){
      [1,1.5,2,3].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.18/(i+1),now+0.4+i*0.1);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const windLFO=ctx.createOscillator(); const windG=ctx.createGain();
      windLFO.type="sine"; windLFO.frequency.value=0.15; windG.gain.value=0.05;
      windLFO.connect(windG); windG.connect(masterGain.gain); windLFO.start(); oscs.push(windLFO);
      lp.frequency.value=Math.min(freq*5,6000); lp.Q.value=0.4;
    }
    // ══ CHURCH BELL — Cloche de bronze ══
    else if(p.id==="church_bell"){
      [[1,0.70,4.0],[2.76,0.40,2.2],[5.40,0.20,1.0],[10.9,0.08,0.5],[1.0,0.10,5.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,16000); lp.Q.value=0.3;
    }
    // ══ CRYSTAL — Verre cristal pur ══
    else if(p.id==="crystal"){
      [[1,0.75,3.0],[3.0,0.25,1.5],[5.0,0.08,0.7]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,16000); lp.Q.value=0.5;
    }
    // ══ METAL_P — Plaques industrielles ══
    else if(p.id==="metal_p"){
      [[1,0.55,2.0],[2.76,0.38,1.0],[5.40,0.18,0.5],[8.93,0.07,0.25]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.tanh(x*1.6);}
        ws.curve=cv; gn.gain.setValueAtTime(g,now+0.002); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(ws); ws.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*9,13000); lp.Q.value=1.5;
    }
    // ══ TUBULAR — Cloches tubulaires orchestrales ══
    else if(p.id==="tubular"){
      [[1,0.65,3.5],[2.756,0.35,1.8],[5.404,0.15,0.8],[8.933,0.05,0.4]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.001); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*11,15000); lp.Q.value=0.4;
    }
    // ══ BOWL — Bol tibétain, méditation ══
    else if(p.id==="bowl"){
      [[1,0.65,5.0],[2.8,0.20,3.0],[5.5,0.06,1.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.004); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const spin=ctx.createOscillator(); const spinG=ctx.createGain();
      spin.type="sine"; spin.frequency.value=0.12; spinG.gain.value=0.05;
      spin.connect(spinG); spinG.connect(masterGain.gain); spin.start(); oscs.push(spin);
      lp.frequency.value=Math.min(freq*7,9000); lp.Q.value=0.3;
    }
    // ══ BROKEN — Piano cassé, notes manquantes ══
    else if(p.id==="broken"){
      [[1,0.50,1.5],[2,0.12,0.7],[3,0.03,0.3]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r*(1+((Math.random()-0.5)*0.02));
        gn.gain.setValueAtTime(g,now+0.009); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,4000); lp.Q.value=1.8;
    }
    // ══ GHOST_P — Piano fantôme mi-entendu ══
    else if(p.id==="ghost_p"){
      [1,2,3,5].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now+i*0.12); g.gain.linearRampToValueAtTime(0.15/(i+1),now+i*0.12+0.2);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,4500); lp.Q.value=2.0;
    }
    // ══ HAUNTED — Piano hanté, horreur ══
    else if(p.id==="haunted"){
      [[1,0.45,3.5],[0.5,0.35,4.5],[1.003,0.15,3.8]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.025); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const hLFO=ctx.createOscillator(); const hLFOG=ctx.createGain();
      hLFO.type="sine"; hLFO.frequency.value=0.08; hLFOG.gain.value=0.06;
      hLFO.connect(hLFOG); hLFOG.connect(masterGain.gain); hLFO.start(); oscs.push(hLFO);
      lp.frequency.value=Math.min(freq*2,1800); lp.Q.value=3.0;
    }
    // ══ DECAYED — Cordes pourries et bois pourri ══
    else if(p.id==="decayed"){
      [-30,-15,0,15,30].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f; g.gain.value=0.12;
        const ws=ctx.createWaveShaper(); const cv=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;cv[i]=Math.tanh(x*2.2);}
        ws.curve=cv; o.connect(ws); ws.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*3,2500); lp.Q.value=2.0;
    }
    // ══ WARPED — Clavier tordu par la chaleur ══
    else if(p.id==="warped"){
      [-40,-20,-8,0,8,20,40].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="triangle"; o.frequency.value=f; g.gain.value=0.10;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*4,4500); lp.Q.value=1.5;
    }
    // ══ SINE_P — Sine pur minimaliste ══
    else if(p.id==="sine_p"){
      [[1,0.70,2.0],[2,0.15,1.0],[3,0.03,0.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.004); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,8000); lp.Q.value=0.3;
    }
    // ══ GLASS_P — Minimalisme Philip Glass ══
    else if(p.id==="glass_p"){
      [[1,0.65,2.5],[2,0.20,1.5],[3,0.06,0.8],[4,0.02,0.4]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*7,10000); lp.Q.value=0.4;
    }
    // ══ SATIE — Gymnopedie nudité ══
    else if(p.id==="satie"){
      [[1,0.60,2.8],[2,0.18,1.6],[3,0.05,0.8]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.007); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,7000); lp.Q.value=0.5;
    }
    // ══ ARVO — Tintinnabuli Pärt ══
    else if(p.id==="arvo"){
      [[1,0.55,4.0],[3,0.20,3.0],[5,0.06,1.5]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.018); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*5,6000); lp.Q.value=0.4;
    }
    // ══ ENO_P — Ambient Brian Eno ══
    else if(p.id==="eno_p"){
      [1,2,4].forEach((r,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.20/(i+1),now+0.3);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const lfoE=ctx.createOscillator(); const lfoEG=ctx.createGain();
      lfoE.type="sine"; lfoE.frequency.value=0.03; lfoEG.gain.value=0.04;
      lfoE.connect(lfoEG); lfoEG.connect(masterGain.gain); lfoE.start(); oscs.push(lfoE);
      lp.frequency.value=Math.min(freq*4,5000); lp.Q.value=0.3;
    }
    // ══ STORM — Dramatique rapide ══
    else if(p.id==="storm"){
      const stH=ctx.createOscillator(); const stHG=ctx.createGain();
      stH.type="square"; stH.frequency.value=freq*9;
      stHG.gain.setValueAtTime(0.22,now); stHG.gain.exponentialRampToValueAtTime(0.001,now+0.022);
      stH.connect(stHG); stHG.connect(masterGain); stH.start(); oscs.push(stH);
      [[1,0.68,2.0],[2,0.32,1.2],[3,0.14,0.65],[4,0.06,0.35],[5,0.02,0.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*11,16000); lp.Q.value=1.0;
    }
    // ══ HEROIC — Fanfare triomphale ══
    else if(p.id==="heroic"){
      [[1,0.70,1.8],[2,0.35,1.1],[3,0.15,0.6],[4,0.06,0.35],[5,0.02,0.2]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.003); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,15000); lp.Q.value=0.6;
    }
    // ══ TRAGIC — Descente dans l'obscurité ══
    else if(p.id==="tragic"){
      [[1,0.55,3.0],[2,0.16,1.8],[3,0.04,0.9],[0.5,0.28,3.8]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.010); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const tLFO=ctx.createOscillator(); const tLFOG=ctx.createGain();
      tLFO.type="sine"; tLFO.frequency.value=0.07; tLFOG.gain.value=0.035;
      tLFO.connect(tLFOG); tLFOG.connect(masterGain.gain); tLFO.start(); oscs.push(tLFO);
      lp.frequency.value=Math.min(freq*3,2800); lp.Q.value=1.5;
    }
    // ══ EPIC — Orchestral gonflant ══
    else if(p.id==="epic"){
      [[1,0.62,3.5],[2,0.26,2.5],[3,0.10,1.5],[4,0.04,0.8],[0.5,0.22,4.0]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(0,now); gn.gain.linearRampToValueAtTime(g,now+0.15);
        gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*8,11000); lp.Q.value=0.5;
    }
    // ══ LULLABY — Berceuse douce ══
    else if(p.id==="lullaby"){
      [[1,0.52,3.0],[2,0.14,1.8],[3,0.03,0.7]].forEach(([r,g,d])=>{
        const o=ctx.createOscillator(); const gn=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*r;
        gn.gain.setValueAtTime(g,now+0.018); gn.gain.exponentialRampToValueAtTime(0.001,now+d*release);
        o.connect(gn); gn.connect(masterGain); o.start(); oscs.push(o);
      });
      const rock=ctx.createOscillator(); const rockG=ctx.createGain();
      rock.type="sine"; rock.frequency.value=0.5; rockG.gain.value=0.04;
      rock.connect(rockG); rockG.connect(masterGain.gain); rock.start(); oscs.push(rock);
      lp.frequency.value=Math.min(freq*4,4500); lp.Q.value=0.4;
    }

    // ══════════════════════════════════════════════════════════
    // PADS
    // ══════════════════════════════════════════════════════════
    else if(p.id==="bleed"){
      const fund=ctx.createOscillator(); const fundG=ctx.createGain();
      fund.type="sine"; fund.frequency.value=freq; fundG.gain.value=0.50;
      fund.connect(fundG); fundG.connect(masterGain); fund.start(); oscs.push(fund);
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.28;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      const h2=ctx.createOscillator(); const h2G=ctx.createGain();
      h2.type="sine"; h2.frequency.value=freq*2;
      h2G.gain.setValueAtTime(0.18,now); h2G.gain.exponentialRampToValueAtTime(0.001,now+3.5);
      h2.connect(h2G); h2G.connect(masterGain); h2.start(); oscs.push(h2);
      const h3=ctx.createOscillator(); const h3G=ctx.createGain();
      h3.type="sine"; h3.frequency.value=freq*3;
      h3G.gain.setValueAtTime(0.08,now); h3G.gain.exponentialRampToValueAtTime(0.001,now+1.8);
      h3.connect(h3G); h3G.connect(masterGain); h3.start(); oscs.push(h3);
      const det=ctx.createOscillator(); const detG=ctx.createGain();
      det.type="triangle"; det.frequency.value=freq*Math.pow(2,5/1200); detG.gain.value=0.22;
      det.connect(detG); detG.connect(masterGain); det.start(); oscs.push(det);
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=4.2;
      lfoG.gain.setValueAtTime(0,now); lfoG.gain.linearRampToValueAtTime(freq*0.003,now+1.5);
      lfo.connect(lfoG); lfoG.connect(fund.frequency); lfo.start(); oscs.push(lfo);
      lp.frequency.value=Math.min(freq*5,3200); lp.Q.value=0.8;
    }
    else if(p.id==="void"){
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.55;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      const carrier=ctx.createOscillator(); const modulator=ctx.createOscillator(); const modGain=ctx.createGain();
      carrier.type="sawtooth"; carrier.frequency.value=freq;
      modulator.type="sine"; modulator.frequency.value=freq*0.501; modGain.gain.value=1.0;
      modulator.connect(modGain); modGain.connect(carrier.frequency);
      const carrierG=ctx.createGain(); carrierG.gain.value=0.30;
      carrier.connect(carrierG); carrierG.connect(masterGain);
      carrier.start(); modulator.start(); oscs.push(carrier,modulator);
      const tension=ctx.createOscillator(); const tensionG=ctx.createGain();
      tension.type="triangle"; tension.frequency.value=freq*Math.pow(2,7/1200); tensionG.gain.value=0.20;
      tension.connect(tensionG); tensionG.connect(masterGain); tension.start(); oscs.push(tension);
      const lfo=ctx.createOscillator(); const lfoGain=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=0.15; lfoGain.gain.value=0.08;
      lfo.connect(lfoGain); lfoGain.connect(masterGain.gain); lfo.start(); oscs.push(lfo);
      lp.frequency.value=Math.min(freq*2.5,800); lp.Q.value=2.5;
    }
    else if(p.id==="frost"){
      const fm1c=ctx.createOscillator(); const fm1m=ctx.createOscillator(); const fm1mg=ctx.createGain();
      fm1c.type="sine"; fm1c.frequency.value=freq; fm1m.type="sine"; fm1m.frequency.value=freq*3.5;
      fm1mg.gain.setValueAtTime(freq*2.8,now); fm1mg.gain.exponentialRampToValueAtTime(freq*0.4,now+2.5);
      fm1m.connect(fm1mg); fm1mg.connect(fm1c.frequency);
      const fm1g=ctx.createGain(); fm1g.gain.value=0.45;
      fm1c.connect(fm1g); fm1g.connect(masterGain); fm1c.start(); fm1m.start(); oscs.push(fm1c,fm1m);
      const fm2c=ctx.createOscillator(); const fm2m=ctx.createOscillator(); const fm2mg=ctx.createGain();
      fm2c.type="sine"; fm2c.frequency.value=freq*2; fm2m.type="sine"; fm2m.frequency.value=freq*7.0;
      fm2mg.gain.setValueAtTime(freq*1.5,now); fm2mg.gain.exponentialRampToValueAtTime(freq*0.1,now+1.8);
      fm2m.connect(fm2mg); fm2mg.connect(fm2c.frequency);
      const fm2g=ctx.createGain(); fm2g.gain.value=0.18;
      fm2c.connect(fm2g); fm2g.connect(masterGain); fm2c.start(); fm2m.start(); oscs.push(fm2c,fm2m);
      const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=freq*1.2; hp.Q.value=0.8;
      masterGain.disconnect(lp); masterGain.connect(hp); hp.connect(lp);
      lp.frequency.value=Math.min(freq*9,14000); lp.Q.value=0.6;
    }
    else if(p.id==="ember"){
      [-8,-3,0,3,8].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="triangle"; o.frequency.value=f; g.gain.value=0.18;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.30;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=Math.min(freq*4,2800); lp.Q.value=1.0;
    }
    else if(p.id==="lunar"){
      [1,1.5,2,3].forEach((ratio,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*ratio;
        g.gain.setValueAtTime(0.25/(i+1),now); g.gain.linearRampToValueAtTime(0.15/(i+1),now+2.0);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.type="bandpass"; lp.frequency.value=freq*2.5; lp.Q.value=4.0;
    }
    else if(p.id==="static"){
      [-5,0,5].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=f; g.gain.value=0.20;
        const ws=ctx.createWaveShaper(); const curve=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;curve[i]=(Math.PI+200)*x/(Math.PI+200*Math.abs(x));}
        ws.curve=curve; o.connect(ws); ws.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*3.5,2200); lp.Q.value=1.5;
    }
    else if(p.id==="depth"){
      [-3,0,3].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        [0.25,0.5,1].forEach((r,i)=>{
          const o=ctx.createOscillator(); const g=ctx.createGain();
          o.type=i===2?"triangle":"sine"; o.frequency.value=f*r; g.gain.value=[0.35,0.30,0.10][i];
          o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
        });
      });
      lp.frequency.value=Math.min(freq*1.8,600); lp.Q.value=3.0;
    }
    else if(p.id==="ghost"){
      [1,2,3,4,5].forEach((ratio,i)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=freq*ratio;
        g.gain.setValueAtTime(0,now+i*0.15); g.gain.linearRampToValueAtTime(0.20/ratio,now+i*0.15+0.3);
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.type="bandpass"; lp.frequency.value=freq*3; lp.Q.value=5.0;
    }
    else if(p.id==="neon"){
      [-10,-6,-3,0,3,6,10].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=f; g.gain.value=0.12;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.setValueAtTime(freq*1.5,now);
      lp.frequency.linearRampToValueAtTime(Math.min(freq*8,12000),now+0.4);
      lp.Q.value=3.5;
    }
    else if(p.id==="abyss"){
      [-15,-7,0,7,15].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="triangle"; o.frequency.value=f*0.5; g.gain.value=0.15;
        const ws=ctx.createWaveShaper(); const curve=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;curve[i]=Math.tanh(x*3);}
        ws.curve=curve; o.connect(ws); ws.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*1.5,500); lp.Q.value=4.0;
    }
    else if(p.id==="silk"){
      [-4,-1,0,1,4].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sine"; o.frequency.value=f; g.gain.value=0.18;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.20;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=Math.min(freq*4,2500); lp.Q.value=0.5;
    }
    else if(p.id==="pulse"){
      const o=ctx.createOscillator(); const g=ctx.createGain();
      o.type="square"; o.frequency.value=freq; g.gain.value=0.40;
      o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      const click=ctx.createOscillator(); const clickG=ctx.createGain();
      click.type="sine"; click.frequency.value=freq*4;
      clickG.gain.setValueAtTime(0.3,now); clickG.gain.exponentialRampToValueAtTime(0.001,now+0.05);
      click.connect(clickG); clickG.connect(masterGain); click.start(); oscs.push(click);
      lp.frequency.value=Math.min(freq*6,8000); lp.Q.value=2.0;
    }
    else if(p.id==="nuts"){
      const fund=ctx.createOscillator(); const fundG=ctx.createGain();
      fund.type="sawtooth"; fund.frequency.value=freq; fundG.gain.value=0.35;
      fund.connect(fundG); fundG.connect(masterGain); fund.start(); oscs.push(fund);
      const f1=ctx.createBiquadFilter(); f1.type="bandpass"; f1.frequency.value=Math.min(500,freq*2.2); f1.Q.value=8;
      const f1Osc=ctx.createOscillator(); const f1G=ctx.createGain();
      f1Osc.type="sawtooth"; f1Osc.frequency.value=freq; f1G.gain.value=0.28;
      f1Osc.connect(f1G); f1G.connect(f1); f1.connect(masterGain); f1Osc.start(); oscs.push(f1Osc);
      const f2=ctx.createBiquadFilter(); f2.type="bandpass"; f2.frequency.value=Math.min(1800,freq*5); f2.Q.value=10;
      const f2Osc=ctx.createOscillator(); const f2G=ctx.createGain();
      f2Osc.type="sawtooth"; f2Osc.frequency.value=freq; f2G.gain.value=0.15;
      f2Osc.connect(f2G); f2G.connect(f2); f2.connect(masterGain); f2Osc.start(); oscs.push(f2Osc);
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=5.0;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.006,now+0.8);
      vib.connect(vibG); vibG.connect(fund.frequency); vib.start(); oscs.push(vib);
      lp.frequency.value=Math.min(freq*4,3500); lp.Q.value=0.7;
    }
    // ══════════════════════════════════════════════════════════
    // BLADEE — Lead cristallin métallique
    // Technique : FM inharmonique + résonance cristal + pitch drift
    // Son : froid, métallique, futuriste comme le son Drain Gang
    // ══════════════════════════════════════════════════════════
    else if(p.id==="bladee"){
      // FM cristallin — ratio inharmonique = métal glacé
      const c1=ctx.createOscillator(); const m1=ctx.createOscillator(); const m1g=ctx.createGain();
      c1.type="sine"; c1.frequency.value=freq;
      m1.type="sine"; m1.frequency.value=freq*3.14; // ratio π = très inharmonique
      m1g.gain.setValueAtTime(freq*2.0,now); m1g.gain.exponentialRampToValueAtTime(freq*0.1,now+0.4);
      m1.connect(m1g); m1g.connect(c1.frequency);
      const c1g=ctx.createGain(); c1g.gain.value=0.45;
      c1.connect(c1g); c1g.connect(masterGain); c1.start(); m1.start(); oscs.push(c1,m1);

      // Octave supérieure cristalline
      const c2=ctx.createOscillator(); const m2=ctx.createOscillator(); const m2g=ctx.createGain();
      c2.type="sine"; c2.frequency.value=freq*2;
      m2.type="sine"; m2.frequency.value=freq*6.28;
      m2g.gain.setValueAtTime(freq*1.2,now); m2g.gain.exponentialRampToValueAtTime(freq*0.05,now+0.3);
      m2.connect(m2g); m2g.connect(c2.frequency);
      const c2g=ctx.createGain(); c2g.gain.value=0.20;
      c2.connect(c2g); c2g.connect(masterGain); c2.start(); m2.start(); oscs.push(c2,m2);

      // Pitch drift lent = instabilité Drain Gang
      const drift=ctx.createOscillator(); const driftG=ctx.createGain();
      drift.type="sine"; drift.frequency.value=0.3;
      driftG.gain.value=freq*0.004;
      drift.connect(driftG); driftG.connect(c1.frequency); drift.start(); oscs.push(drift);

      lp.frequency.value=Math.min(freq*8,14000); lp.Q.value=2.0;
    }

    // ══════════════════════════════════════════════════════════
    // SUICIDE — Lead sombre distordu $uicideboy$
    // Technique : supersaw désaccordé + distorsion hard + sub
    // Son : agressif, sombre, saturé — New Orleans horrorcore
    // ══════════════════════════════════════════════════════════
    else if(p.id==="suicide"){
      // Supersaw très désaccordé = mur de son sombre
      [-20,-12,-5,0,5,12,20].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=f; g.gain.value=0.12;
        // Distorsion hard = agressivité $uicideboy$
        const ws=ctx.createWaveShaper(); const curve=new Float32Array(256);
        for(let i=0;i<256;i++){const x=(i*2/256)-1;curve[i]=Math.sign(x)*Math.pow(Math.abs(x),0.3);}
        ws.curve=curve;
        o.connect(ws); ws.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      // Sub grave = poids horrorcore
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.30;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=Math.min(freq*3,3500); lp.Q.value=3.0;
    }

    // ══════════════════════════════════════════════════════════
    // KENCAR — Lead crispy bright supersaw
    // Technique : supersaw serré + filtre peaking aigu + attaque snap
    // Son : brillant, tranchant, snap agressif — Ken Carson / Opium
    // ══════════════════════════════════════════════════════════
    else if(p.id==="kencar"){
      // Supersaw serré = brightness
      [-8,-4,-1,0,1,4,8].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="sawtooth"; o.frequency.value=f; g.gain.value=0.14;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
      // Snap d'attaque = crispy Ken Carson
      const snap=ctx.createOscillator(); const snapG=ctx.createGain();
      snap.type="square"; snap.frequency.value=freq*3;
      snapG.gain.setValueAtTime(0.25,now); snapG.gain.exponentialRampToValueAtTime(0.001,now+0.03);
      snap.connect(snapG); snapG.connect(masterGain); snap.start(); oscs.push(snap);
      // Filtre qui s'ouvre = brightness explosive
      lp.frequency.setValueAtTime(freq*2,now);
      lp.frequency.linearRampToValueAtTime(Math.min(freq*12,18000),now+0.05);
      lp.Q.value=4.0;
    }

    // ══════════════════════════════════════════════════════════
    // FUTURE — Lead synth 808 mafia
    // Technique : FM doux + portamento + vibrato tardif
    // Son : planant, mélancolique mais puissant — Hendrix / 56 Nights
    // ══════════════════════════════════════════════════════════
    else if(p.id==="future"){
      // FM principal doux = corps du lead Future
      const fc=ctx.createOscillator(); const fm=ctx.createOscillator(); const fmg=ctx.createGain();
      fc.type="sine"; fc.frequency.value=freq;
      fm.type="sine"; fm.frequency.value=freq*2.0; // ratio 2 = doux harmonique
      fmg.gain.setValueAtTime(freq*1.5,now); fmg.gain.exponentialRampToValueAtTime(freq*0.3,now+0.6);
      fm.connect(fmg); fmg.connect(fc.frequency);
      const fcg=ctx.createGain(); fcg.gain.value=0.50;
      fc.connect(fcg); fcg.connect(masterGain); fc.start(); fm.start(); oscs.push(fc,fm);

      // Harmonique douce = chaleur 808 Mafia
      const harm=ctx.createOscillator(); const harmG=ctx.createGain();
      harm.type="triangle"; harm.frequency.value=freq*1.5; // quinte = chaleur
      harmG.gain.value=0.15;
      harm.connect(harmG); harmG.connect(masterGain); harm.start(); oscs.push(harm);

      // Sub = le "poids" Future
      const sub=ctx.createOscillator(); const subG=ctx.createGain();
      sub.type="sine"; sub.frequency.value=freq*0.5; subG.gain.value=0.20;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);

      // Vibrato tardif = expressivité Future
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=3.5;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.008,now+1.0);
      vib.connect(vibG); vibG.connect(fc.frequency); vib.start(); oscs.push(vib);

      lp.frequency.value=Math.min(freq*6,8000); lp.Q.value=1.2;
    }

    // ══════════════════════════════════════════════════════════
    // TRAVIS — Lead flûte éthérée
    // Technique : sine + souffle + vibrato + harmoniques aériennes
    // Son : flottant, atmosphérique, spatial — Astroworld / UTOPIA
    // ══════════════════════════════════════════════════════════
    else if(p.id==="travis"){
      // Corps flûte = sine pur avec attaque douce
      const fl=ctx.createOscillator(); const flG=ctx.createGain();
      fl.type="sine"; fl.frequency.value=freq; flG.gain.value=0.55;
      fl.connect(flG); flG.connect(masterGain); fl.start(); oscs.push(fl);

      // Harmonique de quinte = overtone flûte
      const ov=ctx.createOscillator(); const ovG=ctx.createGain();
      ov.type="sine"; ov.frequency.value=freq*1.5;
      ovG.gain.setValueAtTime(0.12,now); ovG.gain.linearRampToValueAtTime(0.04,now+0.5);
      ov.connect(ovG); ovG.connect(masterGain); ov.start(); oscs.push(ov);

      // Souffle flûte = bruit filtré aigu
      const noiseOsc=ctx.createOscillator(); const noiseG=ctx.createGain();
      const noiseFilter=ctx.createBiquadFilter();
      noiseOsc.type="sawtooth"; noiseOsc.frequency.value=freq*8;
      noiseFilter.type="bandpass"; noiseFilter.frequency.value=freq*6; noiseFilter.Q.value=1.5;
      noiseG.gain.setValueAtTime(0.06,now); noiseG.gain.exponentialRampToValueAtTime(0.01,now+0.3);
      noiseOsc.connect(noiseFilter); noiseFilter.connect(noiseG); noiseG.connect(masterGain);
      noiseOsc.start(); oscs.push(noiseOsc);

      // Vibrato flûte naturel
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=5.5;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.005,now+0.4);
      vib.connect(vibG); vibG.connect(fl.frequency); vib.start(); oscs.push(vib);

      // Filtre passe-haut = légèreté aérienne Travis
      const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=freq*0.8; hp.Q.value=0.5;
      masterGain.disconnect(lp); masterGain.connect(hp); hp.connect(lp);
      lp.frequency.value=Math.min(freq*10,16000); lp.Q.value=0.4;
    }

    // ══════════════════════════════════════════════════════════
    // CARTI — Lead distordu rage Playboi Carti
    // Technique : square wave clippé + ringmod + octave up
    // Son : agressif, aliasé, violent — Whole Lotta Red / Narcissist
    // ══════════════════════════════════════════════════════════
    else if(p.id==="carti"){
      // Square clippé dur = violence Carti
      const sq=ctx.createOscillator(); const sqG=ctx.createGain();
      sq.type="square"; sq.frequency.value=freq; sqG.gain.value=0.35;
      const ws=ctx.createWaveShaper(); const curve=new Float32Array(256);
      for(let i=0;i<256;i++){const x=(i*2/256)-1;curve[i]=Math.max(-0.7,Math.min(0.7,x*4));}
      ws.curve=curve;
      sq.connect(sqG); sqG.connect(ws); ws.connect(masterGain); sq.start(); oscs.push(sq);

      // Octave up = crispy alias Carti
      const oct=ctx.createOscillator(); const octG=ctx.createGain();
      oct.type="square"; oct.frequency.value=freq*2; octG.gain.value=0.20;
      const ws2=ctx.createWaveShaper(); const curve2=new Float32Array(256);
      for(let i=0;i<256;i++){const x=(i*2/256)-1;curve2[i]=Math.max(-0.6,Math.min(0.6,x*3));}
      ws2.curve=curve2;
      oct.connect(octG); octG.connect(ws2); ws2.connect(masterGain); oct.start(); oscs.push(oct);

      // Ring mod = instabilité / chaos
      const ring=ctx.createOscillator(); const ringG=ctx.createGain();
      ring.type="sine"; ring.frequency.value=freq*1.003; // micro-désaccord = beat fréquence
      ringG.gain.value=0.15;
      ring.connect(ringG); ringG.connect(masterGain); ring.start(); oscs.push(ring);

      lp.frequency.value=Math.min(freq*5,10000); lp.Q.value=1.5;
    }

    // ══════════════════════════════════════════════════════════
    // SYNTHÈSE FORMANTIQUE — Modèle source-filtre
    // Source : oscillateur en dent de scie (cordes vocales)
    // Filtre : bandpass F1/F2/F3/F4 (cavités résonantes du conduit vocal)
    // Principe identique aux VST Alter/Ego, Cantor, VOCALOID
    // ══════════════════════════════════════════════════════════
    else if(["soprano","mezzo","alto_v","tenor","baritone","bass_v","falsetto","croon",
             "belt","choir","gospel","monks","unison","madrigal",
             "vocoder","talkbox","glitch_v","pitch_v","formant",
             "trap_v","rnb_v","pop_v","jazz_v","opera_v",
             "throat","yodel","pygmy","muezzin","siren_v",
             "breathy"].includes(p.id)){

      // ── Profils formantiques par voix ──────────────────────
      // [F1, F2, F3, F4, breathiness, vibratoRate, vibratoDepth, srcType]
      const VOICE_PROFILES = {
        // Voix classiques féminines
        soprano:  {f:[800,1150,2900,3900], br:0.04, vr:5.8, vd:0.010, src:"sawtooth", sub:0.0},
        mezzo:    {f:[600,1000,2700,3500], br:0.06, vr:5.2, vd:0.012, src:"sawtooth", sub:0.05},
        alto_v:   {f:[450, 880,2600,3300], br:0.08, vr:4.8, vd:0.014, src:"sawtooth", sub:0.08},
        // Voix classiques masculines
        tenor:    {f:[400, 750,2600,3200], br:0.05, vr:5.5, vd:0.011, src:"sawtooth", sub:0.08},
        baritone: {f:[350, 600,2400,3000], br:0.07, vr:5.0, vd:0.013, src:"sawtooth", sub:0.12},
        bass_v:   {f:[300, 500,2200,2800], br:0.09, vr:4.5, vd:0.015, src:"sawtooth", sub:0.18},
        // Voix stylisées
        falsetto: {f:[900,1400,3100,4200], br:0.12, vr:6.0, vd:0.008, src:"sine",     sub:0.0},
        croon:    {f:[450, 900,2500,3200], br:0.10, vr:4.8, vd:0.012, src:"sawtooth", sub:0.10},
        belt:     {f:[750,1200,2800,3700], br:0.03, vr:5.0, vd:0.009, src:"sawtooth", sub:0.06},
        breathy:  {f:[600,1000,2600,3400], br:0.35, vr:4.0, vd:0.008, src:"sine",     sub:0.0},
        opera_v:  {f:[700,1100,2700,3600], br:0.04, vr:6.2, vd:0.018, src:"sawtooth", sub:0.04},
        // Chœur / Ensemble
        choir:    {f:[600,1050,2650,3500], br:0.08, vr:5.0, vd:0.013, src:"sawtooth", sub:0.06},
        gospel:   {f:[650,1100,2700,3600], br:0.10, vr:5.2, vd:0.014, src:"sawtooth", sub:0.08},
        monks:    {f:[320, 560,2200,3000], br:0.05, vr:0.0, vd:0.000, src:"sawtooth", sub:0.20},
        unison:   {f:[550, 950,2550,3300], br:0.06, vr:5.0, vd:0.012, src:"sawtooth", sub:0.10},
        madrigal: {f:[580,1020,2620,3450], br:0.07, vr:5.4, vd:0.011, src:"sawtooth", sub:0.05},
        // Voix traitées
        vocoder:  {f:[400, 800,2000,3200], br:0.02, vr:0.0, vd:0.000, src:"sawtooth", sub:0.15},
        talkbox:  {f:[500, 900,2300,3400], br:0.04, vr:2.0, vd:0.006, src:"sawtooth", sub:0.12},
        glitch_v: {f:[350, 700,1800,3000], br:0.15, vr:8.0, vd:0.020, src:"square",   sub:0.05},
        pitch_v:  {f:[750,1300,2900,4000], br:0.06, vr:7.0, vd:0.016, src:"sawtooth", sub:0.04},
        formant:  {f:[500, 850,2400,3200], br:0.08, vr:3.5, vd:0.010, src:"sawtooth", sub:0.10},
        // Voix trap/genre
        trap_v:   {f:[550,1000,2500,3300], br:0.06, vr:2.0, vd:0.008, src:"sawtooth", sub:0.18},
        rnb_v:    {f:[620,1080,2650,3500], br:0.08, vr:5.5, vd:0.016, src:"sawtooth", sub:0.08},
        pop_v:    {f:[700,1200,2800,3700], br:0.07, vr:5.0, vd:0.012, src:"sawtooth", sub:0.04},
        jazz_v:   {f:[500, 900,2400,3200], br:0.12, vr:4.0, vd:0.014, src:"sawtooth", sub:0.10},
        // Voix ethniques
        throat:   {f:[150, 500,1500,3500], br:0.03, vr:0.0, vd:0.000, src:"sawtooth", sub:0.30},
        yodel:    {f:[700,1200,2900,3800], br:0.10, vr:7.0, vd:0.020, src:"sawtooth", sub:0.05},
        pygmy:    {f:[580,1040,2600,3450], br:0.12, vr:4.5, vd:0.015, src:"sawtooth", sub:0.08},
        muezzin:  {f:[450, 850,2300,3100], br:0.06, vr:4.0, vd:0.018, src:"sawtooth", sub:0.14},
        siren_v:  {f:[900,1400,3100,4300], br:0.08, vr:6.5, vd:0.025, src:"sine",     sub:0.02},
      };

      const vp = VOICE_PROFILES[p.id] || {f:[600,1000,2600,3400], br:0.08, vr:5.0, vd:0.012, src:"sawtooth", sub:0.08};
      const [F1,F2,F3,F4] = vp.f;

      // ── Source glottale (cordes vocales) ───────────────────
      // Pour le CHŒUR : 4 sources légèrement désaccordées
      const voiceCount = ["choir","gospel","unison","madrigal","monks"].includes(p.id) ? 4 : 1;
      const detunes = voiceCount === 4 ? [-8,-2,2,8] : [0];

      detunes.forEach((cents, vi) => {
        const f = freq * Math.pow(2, cents/1200);
        const src = ctx.createOscillator();
        const srcG = ctx.createGain();
        src.type = vp.src;
        src.frequency.value = f;
        srcG.gain.value = 0.3 / voiceCount;
        src.start(); oscs.push(src);

        // Vibrato (delayed entry, natural voice)
        if(vp.vr > 0){
          const vib = ctx.createOscillator(); const vibG = ctx.createGain();
          vib.type = "sine"; vib.frequency.value = vp.vr + vi * 0.1;
          vibG.gain.setValueAtTime(0, now);
          vibG.gain.linearRampToValueAtTime(freq * vp.vd, now + 0.6);
          vib.connect(vibG); vibG.connect(src.frequency);
          vib.start(); oscs.push(vib);
        }

        // ── Filtres formantiques F1..F4 ──────────────────────
        [[F1,0.40,14],[F2,0.35,18],[F3,0.18,22],[F4,0.07,20]].forEach(([fFreq, fGain, Q]) => {
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = fFreq;
          bp.Q.value = Q;
          const bpG = ctx.createGain(); bpG.gain.value = fGain / voiceCount;
          src.connect(srcG); srcG.connect(bp); bp.connect(bpG); bpG.connect(masterGain);
        });

        // Source directe (sub body)
        if(vp.sub > 0){
          const subSrc = ctx.createOscillator(); const subG = ctx.createGain();
          subSrc.type = "sine"; subSrc.frequency.value = f;
          subG.gain.value = vp.sub / voiceCount;
          subSrc.connect(subG); subG.connect(masterGain);
          subSrc.start(); oscs.push(subSrc);
        }
      });

      // ── Bruit de souffle (breathiness) ────────────────────
      if(vp.br > 0){
        const bufSize = ctx.sampleRate * 1;
        const noiseBuffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for(let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true;
        const breathBP = ctx.createBiquadFilter();
        breathBP.type = "bandpass"; breathBP.frequency.value = 3500; breathBP.Q.value = 2;
        const breathG = ctx.createGain(); breathG.gain.value = vp.br * 0.35;
        noise.connect(breathBP); breathBP.connect(breathG); breathG.connect(masterGain);
        noise.start(); oscs.push(noise);
      }

      // ── Cas spécial : throat singing ──────────────────────
      // Harmoniques résonantes supplémentaires (chant diphonique)
      if(p.id === "throat"){
        [3,4,5,6,7,8].forEach(ratio => {
          const harm = ctx.createOscillator(); const harmG = ctx.createGain();
          harm.type = "sine"; harm.frequency.value = freq * ratio;
          harmG.gain.value = 0.08 / ratio;
          const notch = ctx.createBiquadFilter();
          notch.type = "bandpass"; notch.frequency.value = freq * ratio; notch.Q.value = 30;
          harm.connect(harmG); harmG.connect(notch); notch.connect(masterGain);
          harm.start(); oscs.push(harm);
        });
      }

      // ── Cas spécial : vocoder — ring mod + pulse source ───
      if(p.id === "vocoder"){
        const ring = ctx.createOscillator(); const ringG = ctx.createGain();
        ring.type = "square"; ring.frequency.value = freq * 1.5;
        ringG.gain.value = 0.12;
        ring.connect(ringG); ringG.connect(masterGain);
        ring.start(); oscs.push(ring);
      }

      lp.frequency.value = Math.min(F3 * 2.5, 12000); lp.Q.value = 0.6;
    }

    // ══════════════════════════════════════════════════════════
    // 808 — Trap bass : sine + pitch slide + distorsion douce
    // ══════════════════════════════════════════════════════════
    else if(p.id==="sub808"){
      const sine=ctx.createOscillator(); sine.type="sine";
      sine.frequency.setValueAtTime(freq*2,now);
      sine.frequency.exponentialRampToValueAtTime(freq,now+0.08);
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=Math.tanh(x*2.5)*0.8;} ws.curve=wc;
      const envG=ctx.createGain();
      envG.gain.setValueAtTime(0.85,now);
      envG.gain.exponentialRampToValueAtTime(0.001,now+4.5);
      sine.connect(ws); ws.connect(envG); envG.connect(masterGain); sine.start(); oscs.push(sine);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=0.25;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    // ══════════════════════════════════════════════════════════
    // ACID — TB-303 : sawtooth + filtre resonant sweep
    // ══════════════════════════════════════════════════════════
    else if(p.id==="acid"){
      const sq=ctx.createOscillator(); sq.type="sawtooth"; sq.frequency.value=freq;
      const acidLP=ctx.createBiquadFilter(); acidLP.type="lowpass"; acidLP.Q.value=18;
      acidLP.frequency.setValueAtTime(freq*12,now);
      acidLP.frequency.exponentialRampToValueAtTime(freq*1.5,now+0.35);
      const envG=ctx.createGain();
      envG.gain.setValueAtTime(0,now);
      envG.gain.linearRampToValueAtTime(0.9,now+0.005);
      envG.gain.exponentialRampToValueAtTime(0.5,now+0.10);
      sq.connect(acidLP); acidLP.connect(envG); envG.connect(masterGain); sq.start(); oscs.push(sq);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.20;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*8; lp.Q.value=0.5;
    }
    // ══════════════════════════════════════════════════════════
    // SUB — Sub bass pur : sine + sous-harmonique + warmth
    // ══════════════════════════════════════════════════════════
    else if(p.id==="sub"){
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=Math.tanh(x*1.2)*0.92;} ws.curve=wc;
      ws.connect(masterGain);
      [[1,0.65],[0.5,0.30],[2,0.06]].forEach(([ratio,g])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain(); og.gain.value=g;
        o.connect(og); og.connect(ws); o.start(); oscs.push(o);
      });
      lp.frequency.value=freq*5; lp.Q.value=0.4;
    }
    // ══════════════════════════════════════════════════════════
    // GROWL — Dubstep : saw+square + waveshaper + LFO filtre
    // ══════════════════════════════════════════════════════════
    else if(p.id==="growl"){
      // Saw + saturation douce (tanh, pas de clip dur) → filtre LP Q modéré
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const sawG=ctx.createGain(); sawG.gain.value=0.55;
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=Math.tanh(x*2.2)*0.85;} ws.curve=wc;
      // Filtre LP Q=6 (modéré, pas criant) avec LFO lent 1.4Hz
      const growlLP=ctx.createBiquadFilter(); growlLP.type="lowpass"; growlLP.Q.value=6;
      growlLP.frequency.value=freq*3;
      const lfoOsc=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfoOsc.type="sine"; lfoOsc.frequency.value=1.4; lfoG.gain.value=freq*3;
      lfoOsc.connect(lfoG); lfoG.connect(growlLP.frequency); lfoOsc.start(); oscs.push(lfoOsc);
      // Sub sine propre
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.35;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      saw.connect(sawG); sawG.connect(ws); ws.connect(growlLP); growlLP.connect(masterGain);
      saw.start(); oscs.push(saw);
      lp.frequency.value=Math.min(freq*8,6000); lp.Q.value=0.5;
    }
    else if(p.id==="wobble"){
      // Saw (plus musical que square) → filtre LP Q=7 → LFO 1.8Hz
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const sawG=ctx.createGain(); sawG.gain.value=0.50;
      // Saturation douce pour le mid-range sans agressivité
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=Math.tanh(x*1.8)*0.88;} ws.curve=wc;
      // Filtre Q=7 (assez pour le mouvement, pas assez pour criailler)
      const wobLP=ctx.createBiquadFilter(); wobLP.type="lowpass"; wobLP.Q.value=7;
      wobLP.frequency.value=freq*2.5;
      // LFO 1.8 Hz — perceptible mais pas fatiguant
      const lfoOsc=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfoOsc.type="sine"; lfoOsc.frequency.value=1.8; lfoG.gain.value=freq*4;
      lfoOsc.connect(lfoG); lfoG.connect(wobLP.frequency); lfoOsc.start(); oscs.push(lfoOsc);
      // Sub sine propre
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.38;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      saw.connect(sawG); sawG.connect(ws); ws.connect(wobLP); wobLP.connect(masterGain);
      saw.start(); oscs.push(saw);
      lp.frequency.value=Math.min(freq*7,5000); lp.Q.value=0.5;
    }

    // ══════════════════════════════════════════════════════════
    // BASS — 19 algorithmes supplémentaires
    // ══════════════════════════════════════════════════════════
    else if(p.id==="bass_pluck"){
      // Karplus-Strong : burst de bruit → LP decay → son de corde pincée
      const nLen=Math.floor(ctx.sampleRate*0.06);
      const nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      const nd=nBuf.getChannelData(0); for(let i=0;i<nLen;i++) nd[i]=Math.random()*2-1;
      const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf;
      const ksLP=ctx.createBiquadFilter(); ksLP.type="lowpass"; ksLP.frequency.value=freq*4; ksLP.Q.value=1;
      const ksEnv=ctx.createGain();
      ksEnv.gain.setValueAtTime(0.9,now); ksEnv.gain.exponentialRampToValueAtTime(0.001,now+0.9);
      nSrc.connect(ksLP); ksLP.connect(ksEnv); ksEnv.connect(masterGain); nSrc.start(); oscs.push(nSrc);
      // Sub sine pour définir la hauteur
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.30;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    else if(p.id==="bass_moog"){
      // Ladder filter Moog approximation : 4 LP 1-pole cascadés = -24dB/oct
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const drv=ctx.createWaveShaper(); const dc=new Float32Array(256);
      for(let i=0;i<256;i++){const x=(i/128)-1;dc[i]=Math.tanh(x*1.6);} drv.curve=dc;
      // 4 étages LP (chacun -6dB/oct → total -24dB/oct)
      let chain=drv;
      for(let s=0;s<4;s++){
        const stage=ctx.createBiquadFilter(); stage.type="lowpass"; stage.Q.value=0.5;
        // Cutoff sweep à l'attaque (ouverture Moog)
        stage.frequency.setValueAtTime(freq*2,now);
        stage.frequency.exponentialRampToValueAtTime(freq*5,now+0.12);
        chain.connect(stage); chain=stage;
      }
      const stageG=ctx.createGain(); stageG.gain.value=0.65;
      chain.connect(stageG); stageG.connect(masterGain);
      saw.connect(drv); saw.start(); oscs.push(saw);
      lp.frequency.value=freq*8; lp.Q.value=0.5;
    }
    else if(p.id==="bass_fuzz"){
      // Fuzz : saw → clip dur → HP présence → blend sub
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=(x>0?1:-1)*Math.min(1,Math.abs(x)*12)*0.85;} ws.curve=wc;
      const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=freq*1.5; hp.Q.value=1;
      const hpG=ctx.createGain(); hpG.gain.value=0.40;
      saw.connect(ws); ws.connect(hp); hp.connect(hpG); hpG.connect(masterGain); saw.start(); oscs.push(saw);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.45;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="bass_punch"){
      // Punch : sine + transient click haute fréquence à decay ultra rapide
      const sine=ctx.createOscillator(); sine.type="sine"; sine.frequency.value=freq;
      const sineG=ctx.createGain(); sineG.gain.value=0.60;
      sine.connect(sineG); sineG.connect(masterGain); sine.start(); oscs.push(sine);
      // Click transient : harmonique haute avec decay rapide (donne l'impact)
      const click=ctx.createOscillator(); click.type="sine"; click.frequency.value=freq*5;
      const clickG=ctx.createGain();
      clickG.gain.setValueAtTime(0.55,now); clickG.gain.exponentialRampToValueAtTime(0.001,now+0.05);
      click.connect(clickG); clickG.connect(masterGain); click.start(); oscs.push(click);
      // Sub octave dessous pour le poids
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=0.25;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*7; lp.Q.value=0.5;
    }
    else if(p.id==="bass_orbit"){
      // Orbit : sine sub + FM punch sideband (mod=freq×4, index court)
      const carrier=ctx.createOscillator(); carrier.type="sine"; carrier.frequency.value=freq;
      const mod=ctx.createOscillator(); mod.type="sine"; mod.frequency.value=freq*4;
      const modG=ctx.createGain();
      modG.gain.setValueAtTime(freq*2.8,now); modG.gain.exponentialRampToValueAtTime(0.001,now+0.12);
      mod.connect(modG); modG.connect(carrier.frequency);
      const carrG=ctx.createGain(); carrG.gain.value=0.55;
      carrier.connect(carrG); carrG.connect(masterGain); carrier.start(); mod.start(); oscs.push(carrier,mod);
      // Sub propre une octave en dessous
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=0.38;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*5; lp.Q.value=0.6;
    }
    else if(p.id==="bass_anlog"){
      // Anlog : sawtooth → 2 LP cascadés légèrement désaccordés → tanh chaud
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const lp1=ctx.createBiquadFilter(); lp1.type="lowpass"; lp1.frequency.value=freq*3.2; lp1.Q.value=0.9;
      const lp2=ctx.createBiquadFilter(); lp2.type="lowpass"; lp2.frequency.value=freq*2.8; lp2.Q.value=0.8;
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
      for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.tanh(x*1.8)*0.85;} ws.curve=wc;
      const anlogG=ctx.createGain(); anlogG.gain.value=0.62;
      saw.connect(lp1); lp1.connect(lp2); lp2.connect(ws); ws.connect(anlogG); anlogG.connect(masterGain);
      saw.start(); oscs.push(saw);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    else if(p.id==="bass_tape"){
      // Tape : saw + wow (0.7Hz) + flutter (9Hz tiny) + tanh + LP chaud
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const wow=ctx.createOscillator(); const wowG=ctx.createGain();
      wow.type="sine"; wow.frequency.value=0.7; wowG.gain.value=freq*0.005;
      wow.connect(wowG); wowG.connect(saw.frequency); wow.start(); oscs.push(wow);
      const flutter=ctx.createOscillator(); const flutG=ctx.createGain();
      flutter.type="sine"; flutter.frequency.value=9.0; flutG.gain.value=freq*0.0008;
      flutter.connect(flutG); flutG.connect(saw.frequency); flutter.start(); oscs.push(flutter);
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
      for(let i=0;i<256;i++){const x=(i/128)-1;wc[i]=Math.tanh(x*1.5)*0.88;} ws.curve=wc;
      const sawG=ctx.createGain(); sawG.gain.value=0.60;
      saw.connect(sawG); sawG.connect(ws); ws.connect(masterGain); saw.start(); oscs.push(saw);
      lp.frequency.value=freq*4; lp.Q.value=0.6;
    }
    else if(p.id==="bass_harm"){
      // Additive : 6 harmoniques sinus avec amplitudes décroissantes
      [[1,0.55],[2,0.25],[3,0.12],[4,0.06],[5,0.03],[6,0.015]].forEach(([ratio,g])=>{
        const o=ctx.createOscillator(); o.type="sine";
        o.frequency.value=freq*ratio*(1+Math.random()*0.0005); // micro-détune naturel
        const og=ctx.createGain(); og.gain.value=g;
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=freq*7; lp.Q.value=0.5;
    }
    else if(p.id==="bass_funk"){
      // Funk auto-wah : square + BP filtre qui s'ouvre à l'attaque puis se referme
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.Q.value=6;
      bp.frequency.setValueAtTime(freq*8,now);
      bp.frequency.exponentialRampToValueAtTime(freq*2,now+0.28); // sweep wah
      const bpG=ctx.createGain(); bpG.gain.value=0.55;
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.30;
      sq.connect(bp); bp.connect(bpG); bpG.connect(masterGain); sq.start(); oscs.push(sq);
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    else if(p.id==="bass_hum"){
      // Hum : square → tanh power saturation + HP notch sur harmonique 2 → corps gras
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1; const y=Math.tanh(x*3.5); wc[i]=y*Math.sign(x)*Math.pow(Math.abs(y),0.7)*0.7;} ws.curve=wc;
      const notch=ctx.createBiquadFilter(); notch.type="notch"; notch.frequency.value=freq*2; notch.Q.value=3;
      const humLP=ctx.createBiquadFilter(); humLP.type="lowpass"; humLP.frequency.value=freq*4; humLP.Q.value=0.7;
      const humG=ctx.createGain(); humG.gain.value=0.58;
      sq.connect(ws); ws.connect(notch); notch.connect(humLP); humLP.connect(humG); humG.connect(masterGain);
      sq.start(); oscs.push(sq);
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="bass_metal"){
      // FM inharmonique : carrier=freq, mod=freq×3.5, index décroissant
      const carrier=ctx.createOscillator(); carrier.type="sine"; carrier.frequency.value=freq;
      const mod=ctx.createOscillator(); mod.type="sine"; mod.frequency.value=freq*3.5;
      const modG=ctx.createGain();
      modG.gain.setValueAtTime(freq*5,now); modG.gain.exponentialRampToValueAtTime(freq*0.3,now+0.6);
      mod.connect(modG); modG.connect(carrier.frequency);
      const carrG=ctx.createGain(); carrG.gain.value=0.65;
      carrier.connect(carrG); carrG.connect(masterGain);
      carrier.start(); mod.start(); oscs.push(carrier,mod);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.25;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    else if(p.id==="bass_glitch"){
      // Ring modulation : saw × osc(freq×1.014) = sidebands inharmoniques
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const ring=ctx.createOscillator(); ring.type="sine"; ring.frequency.value=freq*1.014;
      // RM via audio-rate AM : saw → rmGain, ring → rmGain.gain
      const rmGain=ctx.createGain(); rmGain.gain.value=0;
      saw.connect(rmGain); ring.connect(rmGain.gain);
      const rmG2=ctx.createGain(); rmG2.gain.value=0.45;
      rmGain.connect(rmG2); rmG2.connect(masterGain);
      saw.start(); ring.start(); oscs.push(saw,ring);
      // Sub propre pour ancrer la hauteur
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.35;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="bass_deep"){
      // Ultra-deep : sines à freq, freq×0.5, freq×0.25 + LP serré
      const deepLP=ctx.createBiquadFilter(); deepLP.type="lowpass"; deepLP.frequency.value=freq*2; deepLP.Q.value=0.5;
      deepLP.connect(masterGain);
      [[1,0.30],[0.5,0.42],[0.25,0.28]].forEach(([ratio,g])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain(); og.gain.value=g;
        o.connect(og); og.connect(deepLP); o.start(); oscs.push(o);
      });
      lp.frequency.value=freq*3; lp.Q.value=0.4;
    }
    else if(p.id==="bass_trap"){
      // Trap 808 variante sombre : slide plus long, cible basse (freq×0.82)
      const sine=ctx.createOscillator(); sine.type="sine";
      sine.frequency.setValueAtTime(freq*2.8,now);
      sine.frequency.exponentialRampToValueAtTime(freq*0.82,now+0.18); // plus sombre
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1;wc[i]=Math.tanh(x*3.0)*0.78;} ws.curve=wc;
      const envG=ctx.createGain();
      envG.gain.setValueAtTime(0.88,now); envG.gain.exponentialRampToValueAtTime(0.001,now+5.0);
      sine.connect(ws); ws.connect(envG); envG.connect(masterGain); sine.start(); oscs.push(sine);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=0.22;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*5; lp.Q.value=0.4;
    }
    else if(p.id==="bass_mono"){
      // Monosynth clean : saw → 2 LP cascadés (-12dB/oct) sans mouvement
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const lp1=ctx.createBiquadFilter(); lp1.type="lowpass"; lp1.frequency.value=freq*4; lp1.Q.value=0.707;
      const lp2=ctx.createBiquadFilter(); lp2.type="lowpass"; lp2.frequency.value=freq*4; lp2.Q.value=0.707;
      const monoG=ctx.createGain(); monoG.gain.value=0.60;
      saw.connect(lp1); lp1.connect(lp2); lp2.connect(monoG); monoG.connect(masterGain);
      saw.start(); oscs.push(saw);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=0.28;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    else if(p.id==="bass_wind"){
      // Wind : noise burst court (attaque percussive) + corps résonant → basse pizzicato
      const nLen=Math.floor(ctx.sampleRate*0.06); // burst 60ms
      const nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      const nd=nBuf.getChannelData(0);
      for(let i=0;i<nLen;i++){const env=Math.exp(-i/(nLen*0.15)); nd[i]=(Math.random()*2-1)*env;}
      const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=false;
      const bodyBP=ctx.createBiquadFilter(); bodyBP.type="bandpass"; bodyBP.frequency.value=freq*2.5; bodyBP.Q.value=8;
      const nG=ctx.createGain(); nG.gain.value=0.45;
      nSrc.connect(bodyBP); bodyBP.connect(nG); nG.connect(masterGain); nSrc.start(); oscs.push(nSrc);
      // Sine avec decay medium pour le corps
      const sine=ctx.createOscillator(); sine.type="sine"; sine.frequency.value=freq;
      const sineG=ctx.createGain();
      sineG.gain.setValueAtTime(0.55,now); sineG.gain.exponentialRampToValueAtTime(0.001,now+0.7*release);
      sine.connect(sineG); sineG.connect(masterGain); sine.start(); oscs.push(sine);
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="bass_piano"){
      // Piano bass : harmoniques avec decay exponentiel différent par partiel
      [[1,0.55,2.2],[2,0.28,1.3],[3,0.14,0.75],[4,0.08,0.45],[5,0.04,0.28]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.003);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      // Click de marteau léger
      const ck=ctx.createOscillator(); ck.type="square"; ck.frequency.value=freq*8;
      const ckG=ctx.createGain();
      ckG.gain.setValueAtTime(0.18,now); ckG.gain.exponentialRampToValueAtTime(0.001,now+0.02);
      ck.connect(ckG); ckG.connect(masterGain); ck.start(); oscs.push(ck);
      lp.frequency.value=Math.min(freq*10,14000); lp.Q.value=0.5;
    }
    else if(p.id==="bass_dist"){
      // Foldback distortion : saw → pliage du signal (triangle clip) → LP
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){
        const x=(i/256)-1;
        // Foldback : replie le signal au lieu de le clipper
        const t=Math.abs(x)*2; const fold=t<=1?t:2-t;
        wc[i]=(x>=0?fold:-fold)*0.82;
      } ws.curve=wc;
      const distLP=ctx.createBiquadFilter(); distLP.type="lowpass"; distLP.frequency.value=freq*4; distLP.Q.value=1;
      const distG=ctx.createGain(); distG.gain.value=0.55;
      saw.connect(ws); ws.connect(distLP); distLP.connect(distG); distG.connect(masterGain); saw.start(); oscs.push(saw);
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq;
      const subG=ctx.createGain(); subG.gain.value=0.38;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="bass_stack"){
      // Stack : 3 saws désaccordés (-10,0,+10 cents) → comb peigne → HP pour enlever vase → bite aggressive
      const stackLP=ctx.createBiquadFilter(); stackLP.type="lowpass"; stackLP.frequency.value=freq*5; stackLP.Q.value=1.2;
      stackLP.connect(masterGain);
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(512);
      for(let i=0;i<512;i++){const x=(i/256)-1; wc[i]=Math.tanh(x*2.5)*0.80;} ws.curve=wc;
      ws.connect(stackLP);
      [-10,0,+10].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=f;
        const sawG=ctx.createGain(); sawG.gain.value=0.30;
        saw.connect(sawG); sawG.connect(ws); saw.start(); oscs.push(saw);
      });
      // Sub sine ancrage
      const sub=ctx.createOscillator(); sub.type="sine"; sub.frequency.value=freq*0.5;
      const subG=ctx.createGain(); subG.gain.value=0.32;
      sub.connect(subG); subG.connect(masterGain); sub.start(); oscs.push(sub);
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }

    // ══════════════════════════════════════════════════════════
    // SPECTER — Pad formantique vocal (inspiré Cantor / LF model)
    // Source : pulse glottal LF asymétrique (DFT manuelle)
    // Filtre : peaking EQ en série F1→F5 (modèle tube vocal)
    // Aspiration : noise AM audio-rate synchronisé au pulse glottal
    // ══════════════════════════════════════════════════════════
    else if(p.id==="specter"){
      // LF glottal wave (Liljencrants-Fant) — asymétrique : ouverture lente / fermeture rapide
      const LFN=64; const lfReal=new Float32Array(LFN+1); const lfImag=new Float32Array(LFN+1);
      const SAMP=1024; const pulse=new Float32Array(SAMP);
      const tp=0.40,te=0.72,ta=0.06;
      for(let i=0;i<SAMP;i++){const t=i/SAMP;pulse[i]=t<te?Math.sin(Math.PI*t/tp)*Math.exp(-Math.PI*Math.abs(t-tp)/te):-Math.exp(-(t-te)/ta)*0.3;}
      for(let n=1;n<=LFN;n++){let re=0,im=0;for(let i=0;i<SAMP;i++){const a=2*Math.PI*n*i/SAMP;re+=pulse[i]*Math.cos(a);im+=pulse[i]*Math.sin(a);}lfReal[n]=re/SAMP;lfImag[n]=im/SAMP;}
      const lfWave=ctx.createPeriodicWave(lfReal,lfImag,{disableNormalization:false});

      // 4 voix désaccordées avec micro-délais (épaisseur naturelle d'ensemble)
      [[-7,0,0.30],[0,8,0.38],[6,15,0.28],[-2,21,0.24]].forEach(([cents,dlyMs,vGain])=>{
        const f=freq*Math.pow(2,cents/1200);
        const src=ctx.createOscillator(); src.setPeriodicWave(lfWave); src.frequency.value=f;

        // Vibrato naturel (entrée progressive + taux modulé)
        const vib=ctx.createOscillator(); const vibG=ctx.createGain();
        vib.type="sine"; vib.frequency.value=5.0+cents*0.005;
        vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(f*0.009,now+1.0);
        vib.connect(vibG); vibG.connect(src.frequency); vib.start(); oscs.push(vib);
        const vibMod=ctx.createOscillator(); const vibModG=ctx.createGain();
        vibMod.type="sine"; vibMod.frequency.value=0.18; vibModG.gain.value=0.5;
        vibMod.connect(vibModG); vibModG.connect(vib.frequency); vibMod.start(); oscs.push(vibMod);

        // Aspiration pulse-synchrone : rectifier → AM du bruit
        const rect=ctx.createWaveShaper();
        const rc=new Float32Array(512); for(let i=0;i<512;i++){const x=(i/256)-1;rc[i]=Math.max(0,x*1.4);} rect.curve=rc;
        src.connect(rect);
        const nBuf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
        const nd=nBuf.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
        const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=true;
        const nAM=ctx.createGain(); nAM.gain.value=0;
        rect.connect(nAM.gain); nSrc.connect(nAM);
        const nBP=ctx.createBiquadFilter(); nBP.type="bandpass"; nBP.frequency.value=Math.min(800,f*2); nBP.Q.value=1.5;
        const nG=ctx.createGain(); nG.gain.value=0.05*vGain;
        nAM.connect(nBP); nBP.connect(nG);
        nSrc.start(); oscs.push(nSrc);

        // Formants en série (peaking EQ cascade = tube vocal)
        const FORM=[[Math.min(640,f*2.1),640/80,13],[Math.min(1080,f*3.8),1080/100,12],[Math.min(2400,f*8),2400/160,10],[Math.min(3300,f*11),3300/200,7],[Math.min(4000,f*13),4000/280,4]];
        let chain=src;
        FORM.forEach(([fq,Q,gdB])=>{const eq=ctx.createBiquadFilter();eq.type="peaking";eq.frequency.value=fq;eq.Q.value=Q;eq.gain.value=gdB;chain.connect(eq);chain=eq;});

        // Délai inter-voix + mix
        const dly=ctx.createDelay(0.05); dly.delayTime.value=dlyMs/1000;
        const vG=ctx.createGain(); vG.gain.value=vGain;
        chain.connect(dly); nG.connect(dly); dly.connect(vG); vG.connect(masterGain);

        src.start(); oscs.push(src);
      });

      lp.frequency.value=5000; lp.Q.value=0.4;
    }

    // ══════════════════════════════════════════════════════════
    // GHIBLI — Instruments orchestraux / japonais / magiques
    // ══════════════════════════════════════════════════════════
    else if(p.id==="gh_musicbox"){
      // Boîte à musique : fondamentale + harmoniques avec decay très rapide
      // Les tines métalliques ont des partiels à ×2, ×3, ×4 qui s'éteignent vite
      [[1,0.60,1.8],[2,0.22,0.6],[3,0.10,0.35],[4,0.05,0.18],[6,0.02,0.10]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      // Click métallique d'attaque
      const ck=ctx.createOscillator(); ck.type="triangle"; ck.frequency.value=freq*9;
      const ckG=ctx.createGain();
      ckG.gain.setValueAtTime(0.12,now); ckG.gain.exponentialRampToValueAtTime(0.001,now+0.015);
      ck.connect(ckG); ckG.connect(masterGain); ck.start(); oscs.push(ck);
      lp.frequency.value=Math.min(freq*12,12000); lp.Q.value=0.5;
    }
    else if(p.id==="gh_flute"){
      // Flûte : sine doux + noise filtré bande étroite (souffle) + vibrato naturel
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=5.2;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.010,now+0.5);
      vib.connect(vibG); vib.start(); oscs.push(vib);
      const fl=ctx.createOscillator(); fl.type="sine"; fl.frequency.value=freq;
      vibG.connect(fl.frequency);
      // 2ème harmonique très faible (flûte ouverte)
      const fl2=ctx.createOscillator(); fl2.type="sine"; fl2.frequency.value=freq*2;
      const fl2G=ctx.createGain(); fl2G.gain.value=0.08;
      fl2.connect(fl2G); fl2G.connect(masterGain); fl2.start(); oscs.push(fl2);
      // Souffle : bruit HP+LP étroit autour du fondamental
      const nLen=ctx.sampleRate*2; const nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      const nd=nBuf.getChannelData(0); for(let i=0;i<nLen;i++) nd[i]=Math.random()*2-1;
      const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=true;
      const nHP=ctx.createBiquadFilter(); nHP.type="highpass"; nHP.frequency.value=freq*0.9;
      const nLP=ctx.createBiquadFilter(); nLP.type="lowpass"; nLP.frequency.value=freq*1.4;
      const nG=ctx.createGain(); nG.gain.value=0.06;
      nSrc.connect(nHP); nHP.connect(nLP); nLP.connect(nG); nG.connect(masterGain); nSrc.start(); oscs.push(nSrc);
      const flG=ctx.createGain(); flG.gain.value=0.55;
      fl.connect(flG); flG.connect(masterGain); fl.start(); oscs.push(fl);
      lp.frequency.value=freq*8; lp.Q.value=0.4;
    }
    else if(p.id==="gh_accord"){
      // Accordéon : 3 saws légèrement désaccordés + trémolo amplitude 8Hz
      const trem=ctx.createOscillator(); const tremG=ctx.createGain();
      trem.type="sine"; trem.frequency.value=8.0; tremG.gain.value=0.18;
      trem.connect(tremG); trem.start(); oscs.push(trem);
      const accLP=ctx.createBiquadFilter(); accLP.type="lowpass"; accLP.frequency.value=freq*5; accLP.Q.value=0.5;
      accLP.connect(masterGain);
      [-8,0,+8].forEach((cents,i)=>{
        const f=freq*Math.pow(2,cents/1200);
        const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=f;
        const sawG=ctx.createGain(); sawG.gain.value=0.28;
        // AM trémolo via audio-rate : sawG.gain + tremG
        const baseG=ctx.createGain(); baseG.gain.value=0.28;
        saw.connect(baseG); baseG.connect(accLP);
        tremG.connect(baseG.gain); // trémolo AM
        saw.start(); oscs.push(saw);
      });
      lp.frequency.value=freq*6; lp.Q.value=0.5;
    }
    else if(p.id==="gh_celesta"){
      // Célesta : partiel fondamental + 4ème harmonique brillant + decay doux
      [[1,0.55,2.0],[2,0.18,1.0],[4,0.12,0.55],[6,0.05,0.28]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      // Triangle chaud pour le corps (légèrement filtré)
      const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=freq;
      const triG=ctx.createGain();
      triG.gain.setValueAtTime(0.20,now+0.001);
      triG.gain.exponentialRampToValueAtTime(0.001,now+1.5*release);
      tri.connect(triG); triG.connect(masterGain); tri.start(); oscs.push(tri);
      lp.frequency.value=Math.min(freq*14,14000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_harp"){
      // Harpe : partiels avec decay progressif — corps grave tient plus longtemps
      [[1,0.55,1.4],[2,0.28,0.8],[3,0.14,0.5],[4,0.07,0.3],[5,0.04,0.18],[6,0.02,0.12]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio*(1+Math.random()*0.0003);
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      // Légère présence "pluck" haute freq
      const plk=ctx.createOscillator(); plk.type="triangle"; plk.frequency.value=freq*8;
      const plkG=ctx.createGain();
      plkG.gain.setValueAtTime(0.08,now); plkG.gain.exponentialRampToValueAtTime(0.001,now+0.04);
      plk.connect(plkG); plkG.connect(masterGain); plk.start(); oscs.push(plk);
      lp.frequency.value=Math.min(freq*10,12000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_strings"){
      // Cordes : saws désaccordés (-12,−5,0,+5,+12 cents) + LP doux + attaque progressive
      const strLP=ctx.createBiquadFilter(); strLP.type="lowpass"; strLP.frequency.value=freq*4; strLP.Q.value=0.5;
      strLP.connect(masterGain);
      [-12,-5,0,+5,+12].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=f;
        const vib=ctx.createOscillator(); const vibG=ctx.createGain();
        vib.type="sine"; vib.frequency.value=4.8+(Math.random()-0.5)*0.4;
        vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(f*0.006,now+0.8);
        vib.connect(vibG); vibG.connect(saw.frequency); vib.start(); oscs.push(vib);
        const sawG=ctx.createGain(); sawG.gain.value=0.16;
        saw.connect(sawG); sawG.connect(strLP); saw.start(); oscs.push(saw);
      });
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="gh_oboe"){
      // Hautbois : saw riche → BP nasal étroit + harmoniques supplémentaires
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=freq*3.5; bp.Q.value=5;
      const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=freq*0.8;
      const oboLP=ctx.createBiquadFilter(); oboLP.type="lowpass"; oboLP.frequency.value=freq*7; oboLP.Q.value=0.5;
      // Légère nasalité : peaking autour de 800–1200Hz
      const peak=ctx.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=Math.min(1100,freq*3); peak.Q.value=3; peak.gain.value=8;
      const oboG=ctx.createGain(); oboG.gain.value=0.42;
      saw.connect(hp); hp.connect(bp); bp.connect(peak); peak.connect(oboLP); oboLP.connect(oboG); oboG.connect(masterGain);
      // Vibrato hautbois (rapide, étroit)
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=6.0;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.007,now+0.3);
      vib.connect(vibG); vibG.connect(saw.frequency); vib.start(); oscs.push(vib);
      saw.start(); oscs.push(saw);
      lp.frequency.value=freq*8; lp.Q.value=0.4;
    }
    else if(p.id==="gh_bells"){
      // Cloches — partiels inharmoniques typiques (ratio standard de cloche)
      // [1, 1.505, 2.0, 2.756, 3.548, 5.040, 6.756] avec decay decroissants
      [[1,0.50,3.0],[1.505,0.28,1.8],[2.0,0.18,1.2],[2.756,0.12,0.8],[3.548,0.07,0.5],[5.040,0.04,0.3]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*15,16000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_horn"){
      // Cor français : triangle + saw atténué → LP chaud + vibrato large entrée progressive
      const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=freq;
      const saw=ctx.createOscillator(); saw.type="sawtooth"; saw.frequency.value=freq;
      const sawG=ctx.createGain(); sawG.gain.value=0.18;
      const hornLP=ctx.createBiquadFilter(); hornLP.type="lowpass"; hornLP.frequency.value=freq*3.5; hornLP.Q.value=0.6;
      hornLP.connect(masterGain);
      const triG=ctx.createGain(); triG.gain.value=0.45;
      tri.connect(triG); triG.connect(hornLP); tri.start(); oscs.push(tri);
      saw.connect(sawG); sawG.connect(hornLP); saw.start(); oscs.push(saw);
      // Vibrato cor (large, entre progressivement)
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=5.5;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.012,now+0.6);
      vib.connect(vibG); vibG.connect(tri.frequency); vibG.connect(saw.frequency); vib.start(); oscs.push(vib);
      lp.frequency.value=freq*5; lp.Q.value=0.5;
    }
    else if(p.id==="gh_marimba"){
      // Marimba : partiels boisés (4ème partiel dominant = caractère marimba)
      // Marimba a un fort 4ème harmonique et une chute rapide des aigus
      [[1,0.55,0.9],[4,0.35,0.4],[10,0.08,0.15]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,10000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_koto"){
      // Koto : corde pincée japonaise — pitch bend descendant à l'attaque + decay additif
      const kSine=ctx.createOscillator(); kSine.type="sine"; kSine.frequency.value=freq;
      // Bend léger vers le bas (doigt qui glisse)
      kSine.frequency.setValueAtTime(freq*1.04,now);
      kSine.frequency.exponentialRampToValueAtTime(freq,now+0.06);
      [[1,0.55,1.2],[2,0.20,0.65],[3,0.09,0.38],[4,0.04,0.22]].forEach(([ratio,g,dec],i)=>{
        const o= i===0 ? kSine : ctx.createOscillator(); o.type="sine"; if(i>0) o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,10000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_shaku"){
      // Shakuhachi : souffle bambou — sine + bruit important (embouchure) + vibrato lent profond
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=4.5;
      vibG.gain.setValueAtTime(0,now); vibG.gain.linearRampToValueAtTime(freq*0.022,now+0.4);
      vib.connect(vibG); vib.start(); oscs.push(vib);
      const sh=ctx.createOscillator(); sh.type="sine"; sh.frequency.value=freq;
      vibG.connect(sh.frequency);
      const shG=ctx.createGain(); shG.gain.value=0.45;
      sh.connect(shG); shG.connect(masterGain); sh.start(); oscs.push(sh);
      // Souffle bambou : bruit large filtré passe-bande autour de freq*1.5
      const nLen=ctx.sampleRate*2; const nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      const nd=nBuf.getChannelData(0); for(let i=0;i<nLen;i++) nd[i]=Math.random()*2-1;
      const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=true;
      const nBP=ctx.createBiquadFilter(); nBP.type="bandpass"; nBP.frequency.value=freq*1.5; nBP.Q.value=1.2;
      const nG=ctx.createGain(); nG.gain.value=0.20;
      nSrc.connect(nBP); nBP.connect(nG); nG.connect(masterGain); nSrc.start(); oscs.push(nSrc);
      lp.frequency.value=freq*7; lp.Q.value=0.4;
    }
    else if(p.id==="gh_kalimba"){
      // Kalimba : lamelles — fondamental + quelques partiels inharmoniques légers + decay rapide
      [[1,0.62,1.4],[2.02,0.15,0.55],[3.08,0.08,0.28],[4.18,0.04,0.15]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*10,8000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_lullaby"){
      // Berceuse : triangles très doux désaccordés + LP soyeux (pad naïf et tendre)
      const lullLP=ctx.createBiquadFilter(); lullLP.type="lowpass"; lullLP.frequency.value=freq*3; lullLP.Q.value=0.4;
      lullLP.connect(masterGain);
      [-6,0,+6].forEach((cents,i)=>{
        const f=freq*Math.pow(2,cents/1200);
        const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=f;
        const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
        lfo.type="sine"; lfo.frequency.value=0.30+i*0.05; lfoG.gain.value=f*0.003;
        lfo.connect(lfoG); lfoG.connect(tri.frequency); lfo.start(); oscs.push(lfo);
        const triG=ctx.createGain(); triG.gain.value=0.30;
        tri.connect(triG); triG.connect(lullLP); tri.start(); oscs.push(tri);
      });
      lp.frequency.value=freq*4; lp.Q.value=0.4;
    }
    else if(p.id==="gh_totoro"){
      // Totoro : grave rond et amical — triangle basse octave + ronronnement lent
      const triLow=ctx.createOscillator(); triLow.type="triangle"; triLow.frequency.value=freq*0.5;
      const growlLFO=ctx.createOscillator(); const growlG=ctx.createGain();
      growlLFO.type="sine"; growlLFO.frequency.value=1.8; growlG.gain.value=freq*0.008;
      growlLFO.connect(growlG); growlG.connect(triLow.frequency); growlLFO.start(); oscs.push(growlLFO);
      const triG=ctx.createGain(); triG.gain.value=0.50;
      triLow.connect(triG); triG.connect(masterGain); triLow.start(); oscs.push(triLow);
      // Fondamental léger
      const fund=ctx.createOscillator(); fund.type="sine"; fund.frequency.value=freq;
      const fundG=ctx.createGain(); fundG.gain.value=0.28;
      fund.connect(fundG); fundG.connect(masterGain); fund.start(); oscs.push(fund);
      lp.frequency.value=freq*3; lp.Q.value=0.6;
    }
    else if(p.id==="gh_chime"){
      // Carillon éolien : 5 partiels inharmoniques avec decay lents + phases aléatoires
      [[1,0.40,2.8],[1.32,0.25,2.0],[1.82,0.18,1.5],[2.40,0.10,1.0],[3.08,0.06,0.7]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio*(1+Math.random()*0.002);
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,12000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_sprite"){
      // Lutin scintillant : clochettes très hautes (×2, ×3, ×4) + decay flash
      [[2,0.35,0.8],[3,0.25,0.5],[4,0.18,0.32],[5,0.10,0.20],[7,0.05,0.12]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      // Fondamental léger pour ancrer la hauteur
      const base=ctx.createOscillator(); base.type="sine"; base.frequency.value=freq;
      const baseG=ctx.createGain();
      baseG.gain.setValueAtTime(0.30,now+0.001);
      baseG.gain.exponentialRampToValueAtTime(0.001,now+0.6*release);
      base.connect(baseG); baseG.connect(masterGain); base.start(); oscs.push(base);
      lp.frequency.value=Math.min(freq*16,18000); lp.Q.value=0.4;
    }
    else if(p.id==="gh_meadow"){
      // Prairie : bruit filtré bande large (vent/insectes) + 2 sines doux + LFO trémolo lent
      const nLen=ctx.sampleRate*2; const nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      const nd=nBuf.getChannelData(0); for(let i=0;i<nLen;i++) nd[i]=Math.random()*2-1;
      const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=true;
      const nHP=ctx.createBiquadFilter(); nHP.type="highpass"; nHP.frequency.value=800;
      const nLP2=ctx.createBiquadFilter(); nLP2.type="lowpass"; nLP2.frequency.value=3500;
      const nG=ctx.createGain(); nG.gain.value=0.08;
      nSrc.connect(nHP); nHP.connect(nLP2); nLP2.connect(nG); nG.connect(masterGain); nSrc.start(); oscs.push(nSrc);
      // 2 sines harmonieux + LFO de trémolo très lent
      const tremLFO=ctx.createOscillator(); const tremG=ctx.createGain();
      tremLFO.type="sine"; tremLFO.frequency.value=0.22; tremG.gain.value=0.08;
      tremLFO.connect(tremG); tremLFO.start(); oscs.push(tremLFO);
      [1, 1.5].forEach(ratio=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain(); og.gain.value=0.22;
        tremG.connect(og.gain);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=freq*6; lp.Q.value=0.4;
    }

    // ══════════════════════════════════════════════════════════
    // DS — Sons inspirés jeux Nintendo DS (chiptune, square, pulse)
    // ══════════════════════════════════════════════════════════
    else if(p.id==="ds_chip"){
      // Square wave classique chiptune + légère deuxième voix à l'octave
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const sq2=ctx.createOscillator(); sq2.type="square"; sq2.frequency.value=freq*2;
      const sqG=ctx.createGain(); sqG.gain.value=0.38;
      const sq2G=ctx.createGain(); sq2G.gain.value=0.12;
      // Bitcrusher léger : quantification 6-bit via WaveShaper
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
      const steps=64; for(let i=0;i<256;i++){const x=(i/128)-1; wc[i]=Math.round(x*steps)/steps;}  ws.curve=wc;
      sq.connect(sqG); sq2.connect(sq2G); sqG.connect(ws); sq2G.connect(ws); ws.connect(masterGain);
      sq.start(); sq2.start(); oscs.push(sq,sq2);
      lp.frequency.value=Math.min(freq*8,8000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_pulse"){
      // Pulse 25% duty cycle via PeriodicWave (son Game Boy iconic)
      const N=32; const real=new Float32Array(N+1); const imag=new Float32Array(N+1);
      const D=0.25; // duty cycle
      for(let n=1;n<=N;n++){real[n]=0; imag[n]=(2/(n*Math.PI))*Math.sin(n*Math.PI*D);}
      const pw=ctx.createPeriodicWave(real,imag,{disableNormalization:false});
      const osc=ctx.createOscillator(); osc.setPeriodicWave(pw); osc.frequency.value=freq;
      const oscG=ctx.createGain(); oscG.gain.value=0.55;
      osc.connect(oscG); oscG.connect(masterGain); osc.start(); oscs.push(osc);
      lp.frequency.value=Math.min(freq*7,7000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_tri8"){
      // Canal triangle NES — très pur, octave basse, pas de distorsion
      const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=freq*0.5;
      const triG=ctx.createGain(); triG.gain.value=0.65;
      tri.connect(triG); triG.connect(masterGain); tri.start(); oscs.push(tri);
      lp.frequency.value=freq*3; lp.Q.value=0.4;
    }
    else if(p.id==="ds_poke"){
      // Pokemon : cloche douce — sine + harmoniques pairs doux + decay
      [[1,0.52,1.2],[2,0.24,0.65],[4,0.10,0.32],[6,0.04,0.18]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.002);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      // Très léger vibrato chip
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=6.5; vibG.gain.value=freq*0.004;
      vib.connect(vibG); vib.start(); oscs.push(vib);
      lp.frequency.value=Math.min(freq*10,9000); lp.Q.value=0.4;
    }
    else if(p.id==="ds_mario"){
      // Mario : square + octave haute — son rebondissant plateforme
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const sqHi=ctx.createOscillator(); sqHi.type="square"; sqHi.frequency.value=freq*2;
      const sqG=ctx.createGain(); sqG.gain.value=0.38;
      const sqHiG=ctx.createGain(); sqHiG.gain.value=0.18;
      // Envelope rapide sur la voix haute (fraîcheur d'attaque)
      sqHiG.gain.setValueAtTime(0.28,now);
      sqHiG.gain.exponentialRampToValueAtTime(0.06,now+0.08);
      sq.connect(sqG); sqHi.connect(sqHiG);
      sqG.connect(masterGain); sqHiG.connect(masterGain);
      sq.start(); sqHi.start(); oscs.push(sq,sqHi);
      lp.frequency.value=Math.min(freq*6,6000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_zelda"){
      // Zelda : 2 squares légèrement désaccordés (+5 cents) + sustain héroïque
      const N=24; const real=new Float32Array(N+1); const imag=new Float32Array(N+1);
      const D=0.5;
      for(let n=1;n<=N;n+=2){imag[n]=(2/(n*Math.PI));}
      const pw=ctx.createPeriodicWave(real,imag,{disableNormalization:false});
      [-4,+4].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); o.setPeriodicWave(pw); o.frequency.value=f;
        const og=ctx.createGain(); og.gain.value=0.30;
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*6,6000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_kirby"){
      // Kirby : sine très doux + vibrato lent et large + octave haute légère
      const vib=ctx.createOscillator(); const vibG=ctx.createGain();
      vib.type="sine"; vib.frequency.value=4.0; vibG.gain.value=freq*0.018;
      vib.connect(vibG); vib.start(); oscs.push(vib);
      const ki=ctx.createOscillator(); ki.type="sine"; ki.frequency.value=freq;
      vibG.connect(ki.frequency);
      const kiG=ctx.createGain(); kiG.gain.value=0.50;
      ki.connect(kiG); kiG.connect(masterGain); ki.start(); oscs.push(ki);
      const kiHi=ctx.createOscillator(); kiHi.type="sine"; kiHi.frequency.value=freq*2;
      const kiHiG=ctx.createGain(); kiHiG.gain.value=0.12;
      kiHi.connect(kiHiG); kiHiG.connect(masterGain); kiHi.start(); oscs.push(kiHi);
      lp.frequency.value=freq*5; lp.Q.value=0.4;
    }
    else if(p.id==="ds_dung"){
      // Donjon : square + pulse 25% + LP sombre + légère résonance
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const dungLP=ctx.createBiquadFilter(); dungLP.type="lowpass"; dungLP.frequency.value=freq*2.5; dungLP.Q.value=1.5;
      dungLP.connect(masterGain);
      const sqG=ctx.createGain(); sqG.gain.value=0.40;
      sq.connect(sqG); sqG.connect(dungLP); sq.start(); oscs.push(sq);
      // Sub octave triangle pour profondeur
      const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=freq*0.5;
      const triG=ctx.createGain(); triG.gain.value=0.25;
      tri.connect(triG); triG.connect(dungLP); tri.start(); oscs.push(tri);
      lp.frequency.value=freq*3; lp.Q.value=0.5;
    }
    else if(p.id==="ds_battle"){
      // Battle : square + bitcrusher fort (4-bit) + présence aggressive
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
      const steps=8; for(let i=0;i<256;i++){const x=(i/128)-1; wc[i]=Math.round(x*steps)/steps*0.9;} ws.curve=wc;
      // Boost médiums
      const peak=ctx.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=Math.min(2000,freq*4); peak.Q.value=2; peak.gain.value=10;
      const battleG=ctx.createGain(); battleG.gain.value=0.48;
      sq.connect(ws); ws.connect(peak); peak.connect(battleG); battleG.connect(masterGain);
      sq.start(); oscs.push(sq);
      lp.frequency.value=Math.min(freq*6,5000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_crystal"){
      // Crystal : partiels harmoniques + inharmoniques chip (son cristallin DS)
      [[1,0.45,2.0],[2,0.22,1.2],[3,0.12,0.7],[5,0.06,0.4],[7,0.03,0.22]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,12000); lp.Q.value=0.4;
    }
    else if(p.id==="ds_echo"){
      // Echo chip : square + delay avec feedback (son Pokemon grotte)
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq;
      const sqG=ctx.createGain(); sqG.gain.value=0.40;
      const dly=ctx.createDelay(0.5); dly.delayTime.value=0.16;
      const fbG=ctx.createGain(); fbG.gain.value=0.35;
      sq.connect(sqG); sqG.connect(masterGain); sqG.connect(dly);
      dly.connect(fbG); fbG.connect(dly); dly.connect(masterGain);
      sq.start(); oscs.push(sq);
      lp.frequency.value=Math.min(freq*5,5000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_bass8"){
      // Bass8 : triangle carré basse octave — son de bassline NES/DS
      const tri=ctx.createOscillator(); tri.type="triangle"; tri.frequency.value=freq*0.5;
      const sq=ctx.createOscillator(); sq.type="square"; sq.frequency.value=freq*0.5;
      const triG=ctx.createGain(); triG.gain.value=0.50;
      const sqG=ctx.createGain(); sqG.gain.value=0.15;
      const b8LP=ctx.createBiquadFilter(); b8LP.type="lowpass"; b8LP.frequency.value=freq*2; b8LP.Q.value=0.7;
      b8LP.connect(masterGain);
      tri.connect(triG); sq.connect(sqG); triG.connect(b8LP); sqG.connect(b8LP);
      tri.start(); sq.start(); oscs.push(tri,sq);
      lp.frequency.value=freq*3; lp.Q.value=0.5;
    }
    else if(p.id==="ds_warp"){
      // Warp : square + sweep pitch vers le haut (effet warp/téléportation DS)
      const sq=ctx.createOscillator(); sq.type="square";
      sq.frequency.setValueAtTime(freq*0.5,now);
      sq.frequency.exponentialRampToValueAtTime(freq*2,now+0.12);
      sq.frequency.exponentialRampToValueAtTime(freq,now+0.25);
      const ws=ctx.createWaveShaper(); const wc=new Float32Array(256);
      const steps=16; for(let i=0;i<256;i++){const x=(i/128)-1; wc[i]=Math.round(x*steps)/steps;} ws.curve=wc;
      const warpG=ctx.createGain(); warpG.gain.value=0.50;
      sq.connect(ws); ws.connect(warpG); warpG.connect(masterGain); sq.start(); oscs.push(sq);
      lp.frequency.value=Math.min(freq*6,5000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_noise"){
      // Bruit filtré canal noise NES/DS — son snare/hi-hat chip
      const nLen=Math.floor(ctx.sampleRate*0.3);
      const nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      const nd=nBuf.getChannelData(0); for(let i=0;i<nLen;i++) nd[i]=Math.random()*2-1;
      const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=false;
      // Filtre passe-bande accordé sur la hauteur (le canal bruit NES avait une pitch)
      const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=freq*2; bp.Q.value=2;
      const envG=ctx.createGain();
      envG.gain.setValueAtTime(0.70,now);
      envG.gain.exponentialRampToValueAtTime(0.001,now+0.35*release);
      nSrc.connect(bp); bp.connect(envG); envG.connect(masterGain); nSrc.start(); oscs.push(nSrc);
      lp.frequency.value=Math.min(freq*8,8000); lp.Q.value=0.5;
    }
    else if(p.id==="ds_star"){
      // Étoile Mario : harmoniques sines rapides + scintillement (LFO trémolo rapide)
      const sparkLFO=ctx.createOscillator(); const sparkG=ctx.createGain();
      sparkLFO.type="sine"; sparkLFO.frequency.value=12.0; sparkG.gain.value=0.12;
      sparkLFO.connect(sparkG); sparkLFO.start(); oscs.push(sparkLFO);
      [[2,0.40,1.4],[3,0.22,0.9],[4,0.14,0.55],[5,0.08,0.32],[1,0.25,1.8]].forEach(([ratio,g,dec])=>{
        const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*ratio;
        const og=ctx.createGain();
        og.gain.setValueAtTime(g,now+0.001);
        og.gain.exponentialRampToValueAtTime(0.001,now+dec*release);
        sparkG.connect(og.gain); // trémolo scintillement
        o.connect(og); og.connect(masterGain); o.start(); oscs.push(o);
      });
      lp.frequency.value=Math.min(freq*12,12000); lp.Q.value=0.4;
    }

    else {
      [-6,-2,0,2,6].forEach(cents=>{
        const f=freq*Math.pow(2,cents/1200);
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type="triangle"; o.frequency.value=f; g.gain.value=0.18;
        o.connect(g); g.connect(masterGain); o.start(); oscs.push(o);
      });
    }

    activeNodes.current[key]={oscs,masterGain};
    setActiveKeys(prev=>new Set([...prev,key]));
  },[preset,volume,octave,attack,filter,getCtx]);

  const stopNote=useCallback((key)=>{
    const node=activeNodes.current[key]; if(!node) return;
    const{oscs,masterGain}=node; const ctx=audioCtxRef.current; const now=ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value,now);
    masterGain.gain.linearRampToValueAtTime(0,now+release);
    setTimeout(()=>oscs.forEach(o=>{try{o.stop();}catch(e){}}),release*1000+100);
    delete activeNodes.current[key];
    setActiveKeys(prev=>{const s=new Set(prev);s.delete(key);return s;});
  },[release]);

  const folderKeys=Object.keys(BANK);

  const navigatePreset=useCallback((dir)=>{
    const presets=BANK[activeFolder].presets;
    if(!presets.length) return;
    const idx=presets.findIndex(p=>p.id===preset?.id);
    const next=((idx+dir)+presets.length)%presets.length;
    setPreset(presets[next]);
  },[activeFolder,preset]);

  const navigateFolder=useCallback((dir)=>{
    const idx=folderKeys.indexOf(activeFolder);
    const next=((idx+dir)+folderKeys.length)%folderKeys.length;
    switchFolder(folderKeys[next]);
  },[activeFolder,folderKeys]);

  const togglePlay=useCallback(()=>{
    if(isPlaying){clearTimeout(seqRef.current);setIsPlaying(false);setRollPos(-1);Object.keys(activeNodes.current).forEach(k=>stopNote(k));return;}
    setIsPlaying(true); let i=0;
    const step=()=>{
      if(i>0){const prev=NOTES.find(n=>n.note===MELODY[i-1].note);if(prev)stopNote(prev.note);}
      if(i>=MELODY.length){setIsPlaying(false);setRollPos(-1);return;}
      const cur=NOTES.find(n=>n.note===MELODY[i].note);
      if(cur)playNote(cur);
      setRollPos(i); seqRef.current=setTimeout(step,MELODY[i].dur*1000); i++;
    };
    step();
  },[isPlaying,playNote,stopNote]);

  useEffect(()=>{
    const down=(e)=>{
      if(e.repeat) return;
      if(e.key===" "||e.code==="Space"){ e.preventDefault(); togglePlay(); return; }
      if(e.key==="ArrowUp")   { e.preventDefault(); navigatePreset(-1); return; }
      if(e.key==="ArrowDown") { e.preventDefault(); navigatePreset(+1); return; }
      if(e.key==="ArrowLeft") { e.preventDefault(); navigateFolder(-1); return; }
      if(e.key==="ArrowRight"){ e.preventDefault(); navigateFolder(+1); return; }
      const n=KB[e.key.toLowerCase()]; if(!n) return;
      const obj=NOTES.find(x=>x.note===n); if(obj) playNote(obj);
    };
    const up=(e)=>{const n=KB[e.key.toLowerCase()];if(n)stopNote(n);};
    window.addEventListener("keydown",down); window.addEventListener("keyup",up);
    return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
  },[playNote,stopNote,navigatePreset,navigateFolder,togglePlay]);

  // ══════════════════════════════════════════════════════════════════════════
  // BAGPIPE DEMO — Scotland the Brave + gracenotes + drone continu
  // ══════════════════════════════════════════════════════════════════════════
  const stopBagpipeDemo=useCallback(()=>{
    bpTimersRef.current.forEach(clearTimeout); bpTimersRef.current=[];
    if(bpDroneRef.current){
      try{
        const{droneOsc,droneGain,ctx}=bpDroneRef.current;
        const now=ctx.currentTime;
        droneGain.gain.cancelScheduledValues(now);
        droneGain.gain.setValueAtTime(droneGain.gain.value,now);
        droneGain.gain.linearRampToValueAtTime(0,now+0.3);
        setTimeout(()=>{try{droneOsc.stop();}catch(e){}},400);
      }catch(e){}
      bpDroneRef.current=null;
    }
    setBpDemoPlaying(false);
  },[]);

  const playBagpipeDemo=useCallback(()=>{
    if(bpDemoPlaying){stopBagpipeDemo();return;}

    const ctx=getCtx();
    const pp=BANK.BAGPIPES.presets[0].params; // Highland Brave
    const out=analyserRef.current;
    const mF=(m)=>440*Math.pow(2,(m-69)/12);

    // ── Gamme cornemuse (GHB) ────────────────────────────────────────────────
    const LG=55,LA=57,B=59,C=61,D=62,E=64,HG=67,HA=69,HB=71,HD=74,HE=76;

    // ── Scotland the Brave — [midi, beats, gracenote|null] ───────────────────
    // 4/4, 108 BPM
    const BEAT=60/108;
    const G=0.030; // durée gracenote (30ms)
    const score=[
      // ── Phrase A ────────────────────────────────────────────────────────
      [HG,0.5,null],[HA,0.5,HG], [HB,1,HA],  [HA,0.5,null],[HG,0.5,null],
      [HE,1,null],  [HD,0.5,null],[HB,0.5,HD],[HG,1,null],
      // ── Phrase B ────────────────────────────────────────────────────────
      [HG,0.5,null],[HA,0.5,HG], [HB,0.5,HA],[HD,0.5,null],
      [HE,1.5,null],[HD,0.5,null],[HB,0.5,null],[HA,0.5,null],
      [HB,0.5,HA],  [HA,0.5,HG], [HG,1,null],
      // ── Pont montant ────────────────────────────────────────────────────
      [HD,0.5,null],[HE,0.5,HD], [HG+12,1,null],[HE,0.5,null],[HD,0.5,null],
      [HB,1,null],  [HD,0.5,null],[HE,0.5,HD],
      [HG+12,0.5,null],[HA+12,0.5,null],[HB+12,1,null],
      // ── Descente finale ─────────────────────────────────────────────────
      [HA,0.5,null],[HG,0.5,null],[HE,0.5,null],[HD,0.5,null],
      [HB,0.5,null],[HA,0.5,HG], [HG,2,null],
    ];

    const totalBeats=score.reduce((s,[,d,gn])=>s+d+(gn!==null?G/BEAT:0),0);
    const totalSec=totalBeats*BEAT+1.5;

    // ── PeriodicWave partagée (évite de recalculer à chaque note) ────────────
    const N=32; const real=new Float32Array(N); const imag=new Float32Array(N);
    for(let n=1;n<N;n++) imag[n]=(Math.sin(n*Math.PI*pp.pulseWidth)/(n*Math.PI))*2;
    const wave=ctx.createPeriodicWave(real,imag,{disableNormalization:false});

    // ── DRONE continu — La grave + quinte ───────────────────────────────────
    const droneGain=ctx.createGain(); const now=ctx.currentTime;
    droneGain.gain.setValueAtTime(0,now);
    droneGain.gain.linearRampToValueAtTime(pp.droneGain*0.7,now+0.4);
    droneGain.gain.setValueAtTime(pp.droneGain*0.7,now+totalSec-0.5);
    droneGain.gain.linearRampToValueAtTime(0,now+totalSec);

    [LA,LA-12,E].forEach(m=>{
      const o=ctx.createOscillator(); o.type="sawtooth"; o.frequency.value=mF(m);
      const f=ctx.createBiquadFilter(); f.type="lowpass"; f.frequency.value=pp.droneLPHz; f.Q.value=0.6;
      o.connect(f); f.connect(droneGain); o.start(now); o.stop(now+totalSec+0.2);
    });
    droneGain.connect(out);
    bpDroneRef.current={droneOsc:{stop:()=>{}},droneGain,ctx};

    // ── Lecteur de notes — legato (chaque note enchaîne sans silence) ────────
    const playNote=(freq,startT,durS)=>{
      const osc=ctx.createOscillator(); osc.setPeriodicWave(wave); osc.frequency.value=freq;
      const lfo=ctx.createOscillator(); const lfoG=ctx.createGain();
      lfo.type="sine"; lfo.frequency.value=pp.vibratoRate;
      lfoG.gain.value=freq*pp.vibratoDepth;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      const env=ctx.createGain();
      // Legato : pas de silence entre notes — on coupe au tout dernier moment
      env.gain.setValueAtTime(0.72,startT);
      env.gain.setValueAtTime(0.72,startT+durS-0.008);
      env.gain.linearRampToValueAtTime(0,startT+durS+0.008);
      const lp=ctx.createBiquadFilter(); lp.type="lowpass";
      lp.frequency.value=pp.brightness; lp.Q.value=pp.nasalQ;
      osc.connect(env); env.connect(lp); lp.connect(out);
      lfo.start(startT); osc.start(startT);
      lfo.stop(startT+durS+0.05); osc.stop(startT+durS+0.05);
    };

    // ── Séquencement ────────────────────────────────────────────────────────
    let t=now+0.5;
    score.forEach(([midi,beats,grace])=>{
      if(grace!==null){playNote(mF(grace),t,G); t+=G;}
      const d=beats*BEAT;
      playNote(mF(midi),t,d); t+=d;
    });

    setBpDemoPlaying(true);
    // Auto-stop quand la mélodie se termine
    const tid=setTimeout(()=>stopBagpipeDemo(),(totalSec+0.2)*1000);
    bpTimersRef.current=[tid];
  },[bpDemoPlaying,stopBagpipeDemo,getCtx]);

  const currentPresets=BANK[activeFolder].presets.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  const whiteNotes=NOTES.filter(n=>!n.black);
  const wW=38;
  const blackLeft=(n)=>NOTES.slice(0,NOTES.indexOf(n)).filter(x=>!x.black).length*wW-11;
  const C=(preset||{color:"#888888"}).color;

  return (
    <>
    <style>{`
      @keyframes sfTitleGrad{0%{background-position:0% center}100%{background-position:200% center}}
      @keyframes sfTitleBreath{0%,100%{filter:brightness(1)}50%{filter:brightness(1.5)}}
      @keyframes sfPlayPulse{0%,100%{box-shadow:0 0 8px var(--c,#888),0 0 0px transparent}50%{box-shadow:0 0 20px var(--c,#888),0 0 40px var(--c,#888)55}}
      @keyframes sfSpaceHint{0%,100%{opacity:.35}50%{opacity:.9}}
      @keyframes sfPresetSlide{from{opacity:.6;transform:translateX(-4px)}to{opacity:1;transform:translateX(0)}}
      .sf-title{
        background:linear-gradient(90deg,#fff 0%,var(--c,#e03030) 45%,#fff 100%);
        background-size:200%;
        -webkit-background-clip:text;background-clip:text;
        -webkit-text-fill-color:transparent;
        animation:sfTitleGrad 5s linear infinite,sfTitleBreath 3s ease infinite;
      }
      .preset-item{transition:background .18s ease,border-color .18s ease,transform .12s ease}
      .preset-item:hover{transform:translateX(3px);background:rgba(255,255,255,.04)!important}
      .folder-btn{transition:background .18s ease,color .18s ease,border-color .18s ease}
      .folder-btn:hover{background:rgba(255,255,255,.06)!important;color:#999!important}
      .key-white{transition:background .05s ease,box-shadow .08s ease,transform .05s ease;transform-origin:top center}
      .key-white.on{transform:scaleY(.97) translateY(2px)}
      .key-white:hover:not(.on){background:linear-gradient(180deg,#1e1e2e 0%,#161625 100%)!important;box-shadow:0 0 8px rgba(255,255,255,.06)!important}
      .key-black{transition:background .05s ease,box-shadow .08s ease,transform .05s ease;transform-origin:top center}
      .key-black.on{transform:scaleY(.95) translateY(2px)}
      .key-black:hover:not(.on){background:linear-gradient(180deg,#131320 0%,#1a1a28 100%)!important}
      .nav-btn{transition:all .18s ease!important}
      .nav-btn:hover{background:rgba(255,255,255,.07)!important;border-color:#3a3a6a!important;color:#aaa!important}
      .oct-btn{transition:all .18s ease!important}
      .oct-btn:hover{filter:brightness(1.25)}
      .play-btn{transition:all .18s ease!important}
      .play-btn:hover{transform:scale(1.04)}
      .play-btn.active{animation:sfPlayPulse 1.4s ease infinite}
      .space-hint{animation:sfSpaceHint 2.2s ease infinite;font-size:7px;letter-spacing:1px;opacity:.4}
      .knob-wrap{transition:transform .18s ease,filter .18s ease}
      .knob-wrap:hover{transform:scale(1.1);filter:brightness(1.18)}
      .sf-search:focus{border-color:var(--c,#555)!important;box-shadow:0 0 8px var(--c,#555)44!important;outline:none}
      .bp-btn{transition:all .18s ease!important}
      .bp-btn:hover{filter:brightness(1.2)}
    `}</style>
    <div style={{minHeight:"100vh",background:"radial-gradient(ellipse at 20% 0%,#0e0820 0%,#06060e 50%,#060a10 100%)",fontFamily:"'Share Tech Mono',monospace",display:"flex",flexDirection:"column",color:"#ccc",overflow:"hidden"}}>

      {/* Top Bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 24px",borderBottom:"1px solid #12122a",background:"#08080f"}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div className="sf-title" style={{'--c':C,fontSize:20,fontWeight:900,letterSpacing:6,fontFamily:"'Orbitron',sans-serif"}}>SOULFORGE</div>
          <div style={{fontSize:9,color:"#333",letterSpacing:3}}>VST INSTRUMENT v1.0</div>
          <button className="bp-btn" onClick={playBagpipeDemo} style={{
            padding:"4px 12px",border:`1px solid ${bpDemoPlaying?"#4ca840":"#1a2a1a"}`,
            background:bpDemoPlaying?"#4ca84022":"transparent",
            color:bpDemoPlaying?"#4ca840":"#2a4a2a",
            fontSize:9,letterSpacing:1,cursor:"pointer",fontFamily:"inherit",
          }}>{bpDemoPlaying?"◼ STOP PIPES":"🎵 TEST CORNEMUSE"}</button>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {/* Prev/Next preset */}
          <button className="nav-btn" onClick={()=>navigatePreset(-1)} style={{background:"transparent",border:`1px solid #1a1a2e`,color:"#555",width:26,height:26,cursor:"pointer",fontFamily:"inherit",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}} title="Preset précédent (↑)">▲</button>
          <button className="nav-btn" onClick={()=>navigatePreset(+1)} style={{background:"transparent",border:`1px solid #1a1a2e`,color:"#555",width:26,height:26,cursor:"pointer",fontFamily:"inherit",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}} title="Preset suivant (↓)">▼</button>
          <div style={{textAlign:"right",minWidth:140}}>
            <div style={{fontSize:8,color:"#333",letterSpacing:2}}>
              <span style={{color:"#555",cursor:"pointer",marginRight:6}} onClick={()=>navigateFolder(-1)}>◀</span>
              <span style={{color:BANK[activeFolder].color}}>{BANK[activeFolder].label}</span>
              <span style={{color:"#555",cursor:"pointer",marginLeft:6}} onClick={()=>navigateFolder(+1)}>▶</span>
            </div>
            <div style={{fontSize:13,color:C,letterSpacing:3,fontFamily:"'Orbitron',sans-serif"}}>{preset?.name||"—"}</div>
          </div>
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* Browser */}
        <div style={{width:280,borderRight:"1px solid #12122a",background:"#07070d",display:"flex",flexShrink:0}}>

          {/* Colonne dossiers */}
          <div style={{width:88,borderRight:"1px solid #0d0d1a",display:"flex",flexDirection:"column",overflowY:"auto"}}>
            <div style={{padding:"8px 6px",fontSize:7,letterSpacing:2,color:"#222",borderBottom:"1px solid #0d0d1a"}}>FOLDERS</div>
            {folderKeys.map(key=>{
              const folder=BANK[key]; if(!folder) return null;
              const active=activeFolder===key;
              return(
                <button key={key} className="folder-btn" onClick={()=>switchFolder(key)} style={{
                  display:"flex",alignItems:"center",gap:5,
                  padding:"7px 8px",border:"none",cursor:"pointer",fontFamily:"inherit",
                  fontSize:7,letterSpacing:0.5,textAlign:"left",width:"100%",
                  background:active?folder.color+"28":"transparent",
                  color:active?folder.color:"#3a3a4a",
                  borderLeft:active?`2px solid ${folder.color}`:"2px solid transparent",
                  borderBottom:"1px solid #0a0a12",
                }}>
                  <span style={{fontSize:10,lineHeight:1}}>{folder.label.split(" ")[0]}</span>
                  <span style={{letterSpacing:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:44}}>
                    {folder.label.replace(/^[\S]+\s*/,"")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Colonne presets */}
          <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
            <div style={{padding:"6px 10px",borderBottom:"1px solid #0d0d1a",display:"flex",alignItems:"center",gap:6}}>
              <input className="sf-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="search..."
                style={{'--c':C,flex:1,background:"#0a0a14",border:"1px solid #14142a",color:"#666",padding:"4px 7px",fontSize:9,letterSpacing:1,fontFamily:"inherit",outline:"none",minWidth:0,transition:"border-color .18s ease,box-shadow .18s ease"}}/>
              <span style={{fontSize:8,color:"#222",letterSpacing:1,flexShrink:0}}>{currentPresets.length}</span>
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {currentPresets.map(p=>{
                const active=preset?.id===p.id;
                return(
                  <div key={p.id} className="preset-item" onClick={()=>setPreset(p)} style={{
                    padding:"8px 10px",cursor:"pointer",borderBottom:"1px solid #0a0a12",
                    background:active?p.color+"22":"transparent",
                    borderLeft:`2px solid ${active?p.color:"transparent"}`,
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {active && <div style={{width:4,height:4,borderRadius:"50%",background:p.color,boxShadow:`0 0 6px ${p.color}`,flexShrink:0}}/>}
                      <div style={{fontSize:10,letterSpacing:1.5,fontFamily:"'Orbitron',sans-serif",color:active?p.color:"#555"}}>{p.name}</div>
                    </div>
                    {active && <div style={{fontSize:7,color:"#333",marginTop:3,letterSpacing:0.5,paddingLeft:10}}>{p.desc}</div>}
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Center */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Visualizer + Knobs */}
          <div style={{display:"flex",borderBottom:"1px solid #12122a",background:"#07070d"}}>
            <div style={{flex:1,padding:"16px 20px",borderRight:"1px solid #12122a"}}>
              <div style={{fontSize:8,letterSpacing:3,color:"#333",marginBottom:10}}>OSCILLOSCOPE</div>
              <Visualizer analyserRef={analyserRef} color={C}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:10}}>
                {[["ENGINE",(preset?.id||"none").toUpperCase()],["FOLDER",activeFolder],["ACTIVE",activeKeys.size]].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:8,color:"#333",letterSpacing:2}}>{l}</div><div style={{fontSize:10,color:C,letterSpacing:2}}>{v}</div></div>
                ))}
              </div>
            </div>
            <div style={{padding:"16px 20px"}}>
              <div style={{fontSize:8,letterSpacing:3,color:"#333",marginBottom:14}}>SOUND ENGINE</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"16px 20px"}}>
                <Knob label="ATTACK"  value={attack}  min={0.001} max={2.0} onChange={setAttack}  color={C}/>
                <Knob label="RELEASE" value={release} min={0.1}   max={4.0} onChange={setRelease} color={C}/>
                <Knob label="VOLUME"  value={volume}  min={0}     max={1.0} onChange={setVolume}  color={C}/>
                <Knob label="REVERB"  value={reverb}  min={0}     max={1.0} onChange={setReverb}  color={C}/>
                <Knob label="CHORUS"  value={chorus}  min={0}     max={1.0} onChange={setChorus}  color={C}/>
                <Knob label="FILTER"  value={filter}  min={0}     max={1.0} onChange={setFilter}  color={C}/>
              </div>
            </div>
          </div>

          {/* Piano Roll */}
          <div style={{padding:"12px 20px",borderBottom:"1px solid #12122a",background:"#07070d"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <div style={{fontSize:8,letterSpacing:3,color:"#333"}}>DEMO PLAYER</div>
              <button className={`play-btn${isPlaying?" active":""}`} onClick={togglePlay} style={{'--c':C,
                padding:"5px 16px",border:`1px solid ${isPlaying?C:"#2a2a3a"}`,
                background:isPlaying?C+"22":"transparent",color:isPlaying?C:"#555",
                fontSize:9,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",
              }}>
                {isPlaying?"◼ STOP":"▶ PLAY DEMO"}
                {!isPlaying && <span className="space-hint" style={{marginLeft:8}}>[SPACE]</span>}
              </button>
              <div style={{fontSize:8,color:"#333",letterSpacing:1}}>Moonlight Sonata — Beethoven</div>
            </div>
            <div style={{display:"flex",gap:3,alignItems:"flex-end",height:44,background:"#06060e",padding:"4px",borderRadius:4,border:"1px solid #12122a"}}>
              {MELODY.map((m,i)=>{
                const h=NOTE_HEIGHT[m.note]||18; const isActive=rollPos===i;
                return <div key={i} style={{width:Math.max(18,m.dur*36),height:h,background:isActive?C:C+"33",borderRadius:2,boxShadow:isActive?`0 0 10px ${C}`:"none",transition:"background 0.08s,box-shadow 0.08s",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <div style={{fontSize:5,color:isActive?"#fff":"transparent"}}>{m.note}</div>
                </div>;
              })}
            </div>
          </div>

          {/* Octave */}
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"8px 20px",borderBottom:"1px solid #12122a",background:"#08080f"}}>
            <div style={{fontSize:8,letterSpacing:3,color:"#333"}}>OCTAVE</div>
            {[-2,-1,0,1,2].map(o=>(
              <button key={o} className="oct-btn" onClick={()=>setOctave(o)} style={{
                width:28,height:22,border:"1px solid",borderColor:octave===o?C:"#1a1a2e",
                background:octave===o?C+"22":"transparent",color:octave===o?C:"#444",
                cursor:"pointer",fontSize:9,fontFamily:"inherit",
                boxShadow:octave===o?`0 0 8px ${C}55`:"none",
              }}>{o>0?`+${o}`:o}</button>
            ))}
            <div style={{marginLeft:"auto",fontSize:8,color:"#333",letterSpacing:2}}>
              {activeKeys.size>0?[...activeKeys].join(" · "):"A S D F G H J  |  W E T Y U O P"}
            </div>
          </div>

          {/* Keyboard */}
          <div style={{flex:1,background:"#06060e",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
            <div style={{position:"relative",height:130}}>
              <div style={{display:"flex"}}>
                {whiteNotes.map((n,i)=>{
                  const on=activeKeys.has(n.note); const kb=Object.entries(KB).find(([k,v])=>v===n.note)?.[0];
                  return <div key={n.note} className={`key-white${on?" on":""}`}
                    onMouseDown={()=>playNote(n)} onMouseUp={()=>stopNote(n.note)}
                    onMouseLeave={()=>{if(activeKeys.has(n.note))stopNote(n.note);}}
                    onTouchStart={e=>{e.preventDefault();playNote(n);}} onTouchEnd={()=>stopNote(n.note)}
                    style={{width:wW-1,height:130,marginRight:1,
                      background:on?`linear-gradient(180deg,${C} 0%,${C}88 100%)`:"linear-gradient(180deg,#181828 0%,#0d0d1c 60%,#080812 100%)",
                      border:`1px solid ${on?C:"#1e1e32"}`,borderRadius:"0 0 5px 5px",cursor:"pointer",
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",paddingBottom:8,
                      boxShadow:on?`0 0 22px ${C}77,inset 0 0 8px ${C}33`:"inset 0 -3px 6px rgba(0,0,0,.4)",
                      userSelect:"none"}}>
                    <div style={{fontSize:7,color:on?"#fff":"#2a2a40",fontWeight:on?"bold":"normal"}}>{kb?.toUpperCase()}</div>
                  </div>;
                })}
              </div>
              {NOTES.filter(n=>n.black).map(n=>{
                const on=activeKeys.has(n.note); const kb=Object.entries(KB).find(([k,v])=>v===n.note)?.[0];
                return <div key={n.note} className={`key-black${on?" on":""}`}
                  onMouseDown={e=>{e.stopPropagation();playNote(n);}} onMouseUp={()=>stopNote(n.note)}
                  onMouseLeave={()=>{if(activeKeys.has(n.note))stopNote(n.note);}}
                  onTouchStart={e=>{e.preventDefault();playNote(n);}} onTouchEnd={()=>stopNote(n.note)}
                  style={{position:"absolute",left:blackLeft(n),top:0,width:22,height:82,zIndex:2,
                    background:on?`linear-gradient(180deg,${C} 0%,${C}aa 100%)`:"linear-gradient(180deg,#0c0c18 0%,#060610 50%,#0e0e1c 100%)",
                    border:`1px solid ${on?C:"#2a2a40"}`,borderRadius:"0 0 4px 4px",cursor:"pointer",
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",paddingBottom:5,
                    boxShadow:on?`0 0 16px ${C}99,inset 0 0 6px ${C}44`:"inset 0 -5px 8px rgba(0,0,0,.7),inset 0 1px 2px rgba(255,255,255,.05)",
                    userSelect:"none"}}>
                  <div style={{fontSize:6,color:on?"#fff":"#333"}}>{kb?.toUpperCase()}</div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div style={{padding:"5px 24px",borderTop:"1px solid #12122a",background:"linear-gradient(90deg,#04040a,#06060e,#04040a)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16}}>
        <div style={{fontSize:7,color:"#252535",letterSpacing:2}}>SOULFORGE INSTRUMENTS © 2025</div>
        <div style={{display:"flex",gap:20,alignItems:"center"}}>
          <div style={{fontSize:7,color:"#2a2a3a",letterSpacing:1}}>
            <span style={{color:"#333"}}>ENGINE · </span>
            <span style={{color:"#444"}}>{(preset?.engine||"—").toUpperCase()}</span>
          </div>
          <div style={{fontSize:7,color:"#2a2a3a",letterSpacing:1}}>
            <span style={{color:"#333"}}>PRESET · </span>
            <span style={{color:"#444"}}>{currentPresets.indexOf(preset)+1}/{currentPresets.length}</span>
          </div>
          <div style={{fontSize:7,color:"#2a2a3a",letterSpacing:1}}>
            <span style={{color:"#333"}}>FOLDER · </span>
            <span style={{color:"#444"}}>{BANK[activeFolder].presets.length} presets</span>
          </div>
        </div>
        <div style={{fontSize:8,color:C,letterSpacing:3,textShadow:`0 0 10px ${C}88`}}>
          {activeKeys.size>0?`♦ ${activeKeys.size} NOTE${activeKeys.size>1?"S":""} ACTIVE`:isPlaying?"▶ PLAYING DEMO":"● READY"}
        </div>
      </div>
    </div>
    </>
  );
}
