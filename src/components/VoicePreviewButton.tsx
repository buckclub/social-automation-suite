/**
 * Tiny play-button that auditions a TTS voice. Drop next to any voice
 * picker so users can hear the voice before committing to a render.
 *
 * Behavior:
 *  - First click → synthesizes (~1-3s on ElevenLabs / instant on Polly)
 *    and plays the cached sample. Spinner during synth.
 *  - Subsequent clicks for the same voice → instant playback from
 *    backend cache (no API call).
 *  - Clicking while playing stops playback.
 *  - Disabled when voice_id is empty or "__config__".
 *
 * Backend caches per (provider, voice_id) at .cache/voice_previews/
 * so the chars-per-preview cost is paid once across the whole session.
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

interface Props {
  provider: string;          // "elevenlabs" | "streamlabs_polly" | …
  voiceId: string;           // empty / sentinel = button disabled
  className?: string;
}

export function VoicePreviewButton({ provider, voiceId, className }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop playback if the voice changes mid-play (user switched voices
  // — they probably want the new one, not the prior one finishing).
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
    }
  }, [provider, voiceId]);

  const disabled =
    busy ||
    !voiceId ||
    voiceId === "__config__" ||
    voiceId.startsWith("__");

  const onClick = async () => {
    if (disabled) return;
    // Pause if already playing this voice.
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    setBusy(true);
    try {
      const r = await api.ttsPreview({ provider, voice_id: voiceId });
      const audio = new Audio(`${API_BASE}${r.url}`);
      audioRef.current = audio;
      audio.addEventListener("ended", () => {
        setPlaying(false);
        audioRef.current = null;
      });
      audio.addEventListener("error", () => {
        setPlaying(false);
        audioRef.current = null;
        toast({
          title: "Preview playback failed",
          description: "Audio file unreachable. Check backend logs.",
          variant: "destructive",
        });
      });
      await audio.play();
      setPlaying(true);
    } catch (e: unknown) {
      toast({
        title: "Preview unavailable",
        description: e instanceof Error ? e.message : "Synthesis failed",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "Pick a specific voice to preview"
          : playing
            ? "Stop preview"
            : "Hear a sample of this voice"
      }
      className={className}
    >
      {busy
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : playing
          ? <Pause className="h-3.5 w-3.5" />
          : <Play className="h-3.5 w-3.5" />}
    </Button>
  );
}
