import type { Tone } from "../products";

export type TonePack = {
  id: Tone;
  direction: string;
  vo: string;
  picture: string;
  music: string;
};

/** Editable tone overlays. Compiler keys prompts on (category × tone × duration). */
export const TONE_PACKS: Record<Tone, TonePack> = {
  energetic: {
    id: "energetic",
    direction:
      "Upbeat and decisive. Fast but not chaotic. A reason to act today. Smile in the voice, never a shout.",
    vo: "Short sentences. Present tense. One benefit per line. End on the CTA.",
    picture:
      "Punch-in close-ups, motion in frame (tools, hands, doors, weather). Saturated but natural color. Hard cuts.",
    music: "Bright percussion bed, medium-fast. No lyrics competing with VO.",
  },
  trustworthy: {
    id: "trustworthy",
    direction:
      "Calm, neighborly, specific. No hype words. Feels like a local who shows up when they say they will.",
    vo: "Even, unhurried, plain speech. Name the city. Promise only what the brief supports.",
    picture:
      "Stable frames, real locations, faces if the photos allow. Soft daylight. Hold shots long enough to read them.",
    music: "Low, warm, unobtrusive. Space for VO. No trailer drums.",
  },
  premium: {
    id: "premium",
    direction:
      "Quiet confidence. Fewer words, more craft. The business feels established, not flashy.",
    vo: "Measured, lower register, pauses. No slang. CTA is an invitation, not a command.",
    picture:
      "Shallow depth, texture, negative space. Slow push-ins. Cream and ink grade. No stock-looking smiles.",
    music: "Sparse piano or strings, low volume. Silence is allowed.",
  },
  friendly: {
    id: "friendly",
    direction:
      "Warm, easy, human. A wave from across the street. Helpful, not salesy.",
    vo: "Conversational. Contractions ok. Talk to one person, not a crowd.",
    picture:
      "Open faces, everyday light, a little humor if the photos support it. Soft cuts, not whip pans.",
    music: "Acoustic or light indie bed. Smile in the arrangement.",
  },
};
