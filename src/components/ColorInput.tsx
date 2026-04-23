import { Input } from "@/components/ui/input";

const NAMED_TO_HEX: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", gray: "#808080", orange: "#ffa500",
  pink: "#ffc0cb", purple: "#800080", cyan: "#00ffff",
};

function toHex(v: string): string {
  if (!v) return "#ffffff";
  const s = v.trim().toLowerCase();
  if (s.startsWith("#")) {
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) {
      // Expand short hex
      return "#" + s.slice(1).split("").map((c) => c + c).join("");
    }
  }
  return NAMED_TO_HEX[s] ?? "#ffffff";
}

interface ColorInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function ColorInput({ value, onChange, placeholder }: ColorInputProps) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={toHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 shrink-0 rounded border border-border bg-secondary cursor-pointer"
        aria-label="Color picker"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "#ffffff"}
        className="h-8 text-xs bg-secondary border-border font-mono"
      />
    </div>
  );
}
