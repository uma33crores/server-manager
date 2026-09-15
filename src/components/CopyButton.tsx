import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

type Props = {
  value: string;
  label?: string;
  className?: string;
};

export default function CopyButton({ value, label, className }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 text-xs text-text-muted hover:text-sky-500 transition-colors ${className ?? ''}`}
      title={`Copy ${label ?? 'value'}`}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-emerald-500">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          {label && <span>{label}</span>}
        </>
      )}
    </button>
  );
}
