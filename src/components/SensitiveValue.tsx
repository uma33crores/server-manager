import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = {
  value: string;
  isSensitive: boolean;
  className?: string;
};

export default function SensitiveValue({ value, isSensitive, className }: Props) {
  const [revealed, setRevealed] = useState(false);
  const display = isSensitive && !revealed ? '••••••••••••' : value;

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="font-mono text-sm text-text-primary break-all">{display}</span>
      {isSensitive && (
        <button
          onClick={() => setRevealed((r) => !r)}
          className="text-text-muted hover:text-sky-500 transition-colors flex-shrink-0"
          title={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}
