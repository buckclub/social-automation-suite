import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, Loader2, Copy, Check, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

/**
 * ElevenLabs Instant Voice Cloning panel.
 *
 * Two ways to give it a voice sample:
 *   1. Click "Record" → uses the browser's MediaRecorder to capture
 *      ~30-60s of mic audio.
 *   2. Drop a WAV/MP3/M4A from disk via the file input.
 *
 * Either way the file is POSTed to /api/tts/elevenlabs/clone-voice with
 * the user-supplied name + description. On success we surface the new
 * voice_id (with copy button) and call `onCloned` so the parent can
 * refetch the voice library — the new voice immediately appears in
 * every voice picker across the suite.
 *
 * Voice cloning requires a paid ElevenLabs tier (Starter+); the
 * backend translates a 402 from ElevenLabs into a clear error toast.
 */
export function ElevenLabsVoiceCloneCard({ onCloned }: { onCloned?: (voice_id: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ voice_id: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recStartRef = useRef<number>(0);
  const [recElapsed, setRecElapsed] = useState(0);

  // Tick the recording duration display every 250ms while recording.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setRecElapsed((Date.now() - recStartRef.current) / 1000);
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        // Free mic
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = mr;
      mr.start();
      recStartRef.current = Date.now();
      setRecElapsed(0);
      setRecording(true);
      setPickedFile(null);
    } catch (e: any) {
      toast({
        title: "Couldn't access microphone",
        description: e.message || "Browser denied mic permission.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setPickedFile(f);
      setRecordedBlob(null);
    }
  };

  const submit = async () => {
    let file: File | null = pickedFile;
    if (!file && recordedBlob) {
      file = new File([recordedBlob], "recording.webm", { type: "audio/webm" });
    }
    if (!file) {
      toast({ title: "No audio sample", description: "Record or upload first.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.cloneElevenLabsVoice(file, name.trim(), description.trim());
      setLastResult(r);
      toast({ title: "Voice cloned", description: `${r.name} → ${r.voice_id.slice(0, 12)}…` });
      // Reset inputs but keep the result visible.
      setName("");
      setDescription("");
      setPickedFile(null);
      setRecordedBlob(null);
      onCloned?.(r.voice_id);
    } catch (e: any) {
      toast({ title: "Clone failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copyId = async () => {
    if (!lastResult) return;
    await navigator.clipboard?.writeText(lastResult.voice_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const recDur = recordedBlob
    ? Math.round((recordedBlob.size / 16000) * 10) / 10  // very rough seconds estimate from webm bytes
    : 0;
  const haveSample = recordedBlob !== null || pickedFile !== null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Mic className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs font-semibold flex-1">Clone your own voice</p>
          <span className="text-[9px] text-muted-foreground">Instant Voice Cloning · paid tier</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug">
          Record or drop a 30–60s clean speech sample. ElevenLabs creates
          a custom voice in <em>your</em> account; the new <code>voice_id</code> is
          immediately pickable in every voice dropdown.
        </p>

        {/* Sample input */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {!recording ? (
            <Button size="sm" variant="outline" onClick={startRecording} disabled={submitting} className="h-9 gap-1">
              <Mic className="h-3.5 w-3.5" /> Record sample
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopRecording} className="h-9 gap-1">
              <Square className="h-3.5 w-3.5" /> Stop ({recElapsed.toFixed(1)}s)
            </Button>
          )}
          <label className="cursor-pointer">
            <Button asChild size="sm" variant="outline" className="h-9 gap-1 w-full">
              <span>
                <Upload className="h-3.5 w-3.5" />
                {pickedFile ? pickedFile.name.slice(0, 24) : "Upload WAV / MP3"}
              </span>
            </Button>
            <input
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"
              onChange={onPickFile}
              hidden
            />
          </label>
        </div>

        {recordedBlob && (
          <div className="text-[10px] text-muted-foreground flex items-center gap-2">
            <span>Recorded ~{recDur}s of audio · ready to upload</span>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
              onClick={() => setRecordedBlob(null)} title="Discard">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Voice name (e.g. 'My Voice')"
            className="bg-secondary border-border h-8 text-xs"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="bg-secondary border-border h-8 text-xs"
          />
        </div>

        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !haveSample}
          className="w-full gap-1"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
          Clone voice
        </Button>

        {lastResult && (
          <div className="rounded border border-success/40 bg-success/5 p-2 text-[10px] flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{lastResult.name}</div>
              <div className="text-muted-foreground font-mono truncate">{lastResult.voice_id}</div>
            </div>
            <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2" onClick={copyId}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy ID"}
            </Button>
          </div>
        )}

        <p className="text-[9px] text-amber-400/90 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          Voice slots count toward your ElevenLabs plan. Free tier has 0
          slots — Starter+ required.
        </p>
      </CardContent>
    </Card>
  );
}
