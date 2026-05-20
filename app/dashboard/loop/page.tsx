import { Repeat2 } from "lucide-react";

export default function LoopPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
        <Repeat2 size={32} className="text-white/15" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white/50 mb-2">Loop</h1>
        <p className="text-white/25 text-sm max-w-xs">
          Publique vídeos em loop contínuo a partir de pastas da sua biblioteca.
        </p>
      </div>
      <span className="px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400/60 text-xs font-semibold tracking-wide">
        Em construção
      </span>
    </div>
  );
}
