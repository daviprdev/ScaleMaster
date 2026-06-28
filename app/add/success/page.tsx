export default function AddSuccessPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/30 flex items-center justify-center mx-auto">
          <svg
            className="w-8 h-8 text-[#00FF41]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-white font-bold text-xl">Conta conectada!</h1>
        <p className="text-white/50 text-sm leading-relaxed">
          Sua conta do Instagram foi vinculada com sucesso. Você já pode fechar esta aba.
        </p>
      </div>
    </div>
  );
}
