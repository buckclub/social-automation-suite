/**
 * ElevenLabs default library voices. These voice IDs are publicly callable
 * via the TTS API — user doesn't need to add them to their account first.
 * IDs are ElevenLabs' public defaults as of 2025. If any go stale and return
 * 404, ElevenLabs has reshuffled their library and the user should copy
 * a fresh voice_id from elevenlabs.io/app/voice-library.
 */
export const ELEVENLABS_LIBRARY: { id: string; name: string; description: string; category: string }[] = [
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",   description: "Deep, Resonant and Comforting · narration, ads", category: "Social Media" },
  { id: "9BWtsMINqrJLrRacOk9x", name: "Bella",   description: "Professional, Bright, Warm · long-form narrator",   category: "Educational" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger",   description: "Laid-Back, Casual, Resonant",                         category: "Conversational" },
  { id: "EXAVITQu4vr4xnSDxMAC", name: "Sarah",   description: "Mature, Reassuring, Confident",                        category: "Entertainment" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura",   description: "Enthusiast, Quirky Attitude",                          category: "Social Media" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", description: "Deep, Confident, Energetic · Australian",              category: "Conversational" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George",  description: "Warm, Captivating Storyteller · British",              category: "Narration" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum",  description: "Husky Trickster · gravelly, unsettling edge",          category: "Characters" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River",   description: "Relaxed, Neutral, Informative",                        category: "Conversational" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry",   description: "Fierce Warrior · animated character",                  category: "Characters" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam",    description: "Energetic, Social Media Creator · shorts/reels",       category: "Social Media" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice",   description: "Clear, Engaging Educator · British",                   category: "Educational" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", description: "Knowledgable, Professional · pleasing alto",           category: "Educational" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will",    description: "Relaxed Optimist · conversational",                    category: "Conversational" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: "Playful, Bright, Warm · trendy content",               category: "Conversational" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric",    description: "Smooth, Trustworthy · tenor, ~40s male",               category: "Conversational" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris",   description: "Charming, Down-to-Earth",                              category: "Conversational" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",  description: "Steady Broadcaster · news/professional · British",     category: "Educational" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",    description: "Velvety Actress · news/narration · British",           category: "Educational" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam",    description: "Dominant, Firm · brash confident tenor",               category: "Social Media" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill",    description: "Wise, Mature, Balanced · friendly, comforting",        category: "Advertisement" },
];
