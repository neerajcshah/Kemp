/**
 * Lightweight Web Audio synthesizer for tactile card clicks, deals, and Kemp / Not Kemp calls.
 */

class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('kemp_muted') === '1';
  }

  ensureContext() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('kemp_muted', this.muted ? '1' : '0');
    return this.muted;
  }

  playTone(freq, duration = 0.12, type = 'triangle', gainPeak = 0.14, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  cardSnap() {
    this.playTone(340, 0.055, 'triangle', 0.11, 0);
    this.playTone(580, 0.045, 'sine', 0.07, 0.02);
  }

  dealSweep() {
    [280, 350, 420, 520].forEach((f, idx) => {
      this.playTone(f, 0.07, 'triangle', 0.09, idx * 0.055);
    });
  }

  raceLost() {
    this.playTone(210, 0.11, 'sawtooth', 0.09, 0);
    this.playTone(165, 0.14, 'sawtooth', 0.09, 0.08);
  }

  freezeAlarm() {
    this.playTone(466.16, 0.12, 'sawtooth', 0.14, 0);
    this.playTone(440, 0.22, 'sawtooth', 0.14, 0.12);
  }

  quadReadyChime() {
    // Unmistakable warm golden 4-note arpeggio played ONLY locally when your own hand hits 4-of-a-kind
    [523.25, 659.25, 783.99, 987.77].forEach((f, idx) => {
      this.playTone(f, 0.24, 'sine', 0.16, idx * 0.075);
    });
  }

  tellPing() {
    // Gentle parlor wood-tap / bell cue when someone performs a table gesture
    this.playTone(660, 0.08, 'sine', 0.09, 0);
    this.playTone(880, 0.11, 'triangle', 0.08, 0.06);
  }

  victoryChord() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
      this.playTone(f, 0.28, 'triangle', 0.12, idx * 0.065);
    });
  }

  blunderBuzz() {
    this.playTone(220, 0.18, 'sawtooth', 0.12, 0);
    this.playTone(155.56, 0.3, 'sawtooth', 0.13, 0.15);
  }
}

export const soundFX = new SoundFX();
