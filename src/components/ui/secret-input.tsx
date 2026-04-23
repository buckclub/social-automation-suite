import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Masked text input that DOES NOT trigger browser password-manager heuristics.
 *
 * Why not <input type="password">? Chrome / Firefox / Safari / 1Password / LastPass /
 * Bitwarden all scan pages for type="password" and offer to save the value as a
 * credential — annoying for API keys that aren't real passwords. So we use
 * type="text" with CSS masking (-webkit-text-security), plus every opt-out
 * attribute we can throw at the common password managers.
 *
 * A toggle eye icon lets the user reveal the value on purpose.
 */
interface SecretInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  // Whether the value is visible by default (user can still toggle).
  defaultVisible?: boolean;
  inputClassName?: string;
}

export const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(
  ({ className, inputClassName, defaultVisible = false, ...props }, ref) => {
    const [visible, setVisible] = React.useState(defaultVisible);
    return (
      <div className={cn("relative", className)}>
        <Input
          {...props}
          ref={ref}
          type="text"
          // Aggressive opt-out of all autofill / password-save heuristics:
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          // Chrome treats `new-password` as "don't suggest saving"; combined
          // with a non-credential name, Chrome's save-password prompt stays away.
          data-form-type="other"
          // 1Password / LastPass / Bitwarden opt-outs.
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          style={{
            ...(props.style || {}),
            // CSS masking — same visual effect as type="password".
            ...(visible
              ? {}
              : ({
                  WebkitTextSecurity: "disc",
                  textSecurity: "disc",
                } as React.CSSProperties)),
          }}
          className={cn("pr-9 font-mono", inputClassName)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-0 top-0 h-full px-2 text-muted-foreground hover:text-foreground hover:bg-transparent"
          aria-label={visible ? "Hide value" : "Show value"}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      </div>
    );
  },
);
SecretInput.displayName = "SecretInput";
