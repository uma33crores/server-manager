import { useEffect, useState } from 'react';

interface PageLoaderProps {
  label?: string;
  fullscreen?: boolean;
}

export default function PageLoader({ label = 'Loading...', fullscreen = false }: PageLoaderProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const wrapper = fullscreen
    ? 'min-h-screen bg-surface flex items-center justify-center'
    : 'flex items-center justify-center py-16';

  return (
    <div className={`${wrapper} transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-12 h-12 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border-2 border-sky-500/30 border-t-sky-500 animate-loader-spin" />
          <span className="text-sky-500 text-lg font-mono font-bold">$</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1 font-mono text-sm text-text-muted">
            <span className="text-sky-500">{'>_'}</span>
            <span>{label}</span>
            <span className="inline-flex gap-0.5 ml-0.5">
              <span className="w-1 h-3.5 bg-sky-500 animate-loader-blink" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-3.5 bg-sky-500 animate-loader-blink" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-3.5 bg-sky-500 animate-loader-blink" style={{ animationDelay: '300ms' }} />
            </span>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-0.5 w-6 rounded-full bg-sky-500/60 animate-loader-bar"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
