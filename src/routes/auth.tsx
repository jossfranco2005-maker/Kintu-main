import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  Leaf,
  ShieldCheck,
  UserPlus,
  TrendingUp,
} from "lucide-react";
import { KintuAvatar } from "@/components/kintu/KintuAvatar";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("demo@kintu.app");
  const [password, setPassword] = useState("kintuDemo123!");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/chat", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success(
          "¡Cuenta creada con éxito! 😉 Ahora solo revisa tu correo y habilita tu cuenta para poder iniciar sesión.",
        );
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!signInErr) navigate({ to: "/chat", replace: true });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/chat", replace: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo continuar";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function fillDemo() {
    setEmail("demo@kintu.app");
    setPassword("kintuDemo123!");
    toast.success("Credenciales de demo cargadas");
  }

  return (
    <div className="h-screen w-full bg-card overflow-y-auto lg:overflow-hidden">
      <style>{`
        @keyframes kintuHalo { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes kintuFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .kintu-halo { animation: kintuHalo 22s linear infinite; }
        .kintu-fade-in { animation: kintuFadeUp .55s cubic-bezier(.22,.61,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .kintu-halo, .kintu-fade-in { animation: none !important; }
        }
      `}</style>

      {/* Full-page layout, fits one screen on desktop, scrolls on mobile */}
      <div className="w-full min-h-screen lg:h-screen grid grid-cols-1 lg:grid-cols-12">
        {/* Left Column (Illustration & Brand) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-[#D9CDF5] via-[#B9A7EE] to-[#8B74E0] dark:bg-muted/30 px-6 py-8 sm:p-8 lg:py-6 lg:px-10 flex flex-col justify-center items-center text-center relative overflow-hidden border-b lg:border-b-0 lg:border-r border-[#E4E0F5] dark:border-hairline">
          {/* Ambient light glow */}
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 50% 30%, color-mix(in oklab, #4C3A8C 20%, transparent), transparent 60%)",
            }}
          />

          <div className="w-full relative z-10 flex flex-col items-center justify-center">
            {/* Eyebrow */}
            <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] uppercase text-[#4C3A8C]/70 dark:text-[#B9A9F5]/70 mb-5">
              <span className="w-1 h-1 rounded-full bg-[#4C3A8C]/60 dark:bg-[#B9A9F5]/60" />
              Finanzas con calma
              <span className="w-1 h-1 rounded-full bg-[#4C3A8C]/60 dark:bg-[#B9A9F5]/60" />
            </span>

            {/* Kintu mascot — halo de crecimiento girando despacio detrás,
                mismo avatar reactivo que usamos en el chat y el sidebar */}
            <div className="relative w-full max-w-[150px] sm:max-w-[170px] lg:max-w-[190px] aspect-square flex items-center justify-center">
              <div
                className="kintu-halo absolute inset-0 rounded-full opacity-70"
                style={{
                  background: "conic-gradient(from 0deg, #7C6FE0, #F6C76B, #7C6FE0)",
                  filter: "blur(1.5px)",
                }}
              />
              <div className="absolute inset-[7px] rounded-full bg-[#EDE9FB] dark:bg-[#1C1830]" />
              <div className="relative z-10 transition-transform hover:scale-105 duration-300">
                <KintuAvatar savingsRate={70} size={150} />
              </div>
            </div>

            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl text-[#4C3A8C] dark:text-[#B9A9F5] mt-5 sm:mt-6 font-semibold tracking-tight">
              Kintu
            </h1>
            <p className="mt-2 text-sm text-[#4A4463] dark:text-muted-foreground max-w-[260px] leading-relaxed">
              Tu libreta financiera, con un asistente detrás.
            </p>
          </div>

          {/* Core badges — una sola píldora de cristal, no tres cajas sueltas */}
          <div className="flex items-stretch rounded-full bg-white/70 dark:bg-card/40 backdrop-blur-sm border border-[#E4E0F5] dark:border-hairline shadow-sm mt-6 sm:mt-7 relative z-10 overflow-hidden">
            <div className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 text-[11px] text-[#4C3A8C] dark:text-muted-foreground font-semibold">
              <ShieldCheck
                className="w-3.5 h-3.5 text-[#7C6FE0] dark:text-[#B9A9F5]"
                strokeWidth={2.2}
              />
              <span>Seguro</span>
            </div>
            <div className="w-px bg-[#E4E0F5] dark:bg-hairline" />
            <div className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 text-[11px] text-[#4C3A8C] dark:text-muted-foreground font-semibold">
              <Lock className="w-3.5 h-3.5 text-[#7C6FE0] dark:text-[#B9A9F5]" strokeWidth={2.2} />
              <span>Privado</span>
            </div>
            <div className="w-px bg-[#E4E0F5] dark:bg-hairline" />
            <div className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 text-[11px] text-[#4C3A8C] dark:text-muted-foreground font-semibold">
              <TrendingUp
                className="w-3.5 h-3.5 text-[#7C6FE0] dark:text-[#B9A9F5]"
                strokeWidth={2.2}
              />
              <span>Confiable</span>
            </div>
          </div>
        </div>

        {/* Right Column (Form) */}
        <div className="lg:col-span-7 relative px-6 py-8 sm:p-10 md:p-12 lg:py-6 lg:px-14 flex flex-col justify-center bg-card overflow-hidden">
          {/* Ambient blobs, sutiles, no compiten con el formulario */}
          <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#7C6FE0]/5 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-[#F6C76B]/5 blur-3xl" />

          <div className="w-full max-w-md mx-auto relative z-10 kintu-fade-in">
            {/* Header */}
            <div className="mb-5 lg:mb-4">
              <h2 className="font-serif text-2xl sm:text-3xl lg:text-3xl text-foreground flex items-center gap-2 font-medium">
                {mode === "signin" ? "Bienvenido de nuevo" : "Crear una cuenta"}
                <Sparkles className="w-5 h-5 text-[#F6C76B]" strokeWidth={2.2} />
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Inicia sesión para continuar administrando tus finanzas."
                  : "Regístrate gratis para empezar a controlar tus gastos."}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5 lg:space-y-3">
              <div>
                <label
                  htmlFor="email"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5"
                >
                  Correo
                </label>
                <div className="relative">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-[#7C6FE0]/10 flex items-center justify-center pointer-events-none">
                    <Mail className="w-3.5 h-3.5 text-[#7C6FE0]" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ejemplo@kintu.app"
                    className="w-full min-h-[46px] pl-12 pr-3 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/25 focus:border-[#7C6FE0] transition-all shadow-sm"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-[#7C6FE0]/10 flex items-center justify-center pointer-events-none">
                    <Lock className="w-3.5 h-3.5 text-[#7C6FE0]" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full min-h-[46px] pl-12 pr-11 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/25 focus:border-[#7C6FE0] transition-all shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Extra options row (Remember me & Forgot Password) - wrap safely to prevent clip/overflow */}
              {mode === "signin" && (
                <div className="flex flex-wrap gap-3 items-center justify-between text-xs py-0.5">
                  <label className="flex items-center gap-2 text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-input h-4 w-4 accent-[#7C6FE0]"
                    />
                    <span>Recordarme</span>
                  </label>
                  <a
                    href="#forgot"
                    className="font-semibold text-[#7C6FE0] dark:text-[#B9A9F5] hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      toast.info("Función no disponible en la demo.");
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </a>
                </div>
              )}

              {/* Action Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-[#4C3A8C] to-[#7C6FE0] text-white font-semibold hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:opacity-60 disabled:hover:brightness-100"
              >
                <Leaf className="w-4 h-4" />
                {loading ? "Un momento..." : mode === "signin" ? "Entrar" : "Crear cuenta"}
              </button>
            </form>

            {/* Switch Mode Separator */}
            <div className="relative my-4 lg:my-3.5 text-center text-xs text-muted-foreground">
              <span className="bg-card px-3 relative z-10">o</span>
              <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-hairline" />
            </div>

            {/* Switch Mode Button */}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="w-full min-h-[48px] rounded-xl border-2 border-[#4C3A8C]/35 hover:border-[#4C3A8C] hover:bg-[#4C3A8C]/5 text-[#4C3A8C] dark:text-[#B9A9F5] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              <UserPlus className="w-4 h-4" />
              {mode === "signin" ? "Crear una cuenta nueva" : "Ya tengo cuenta, entrar"}
            </button>

            {/* Secure indicator footer */}
            <div className="mt-5 lg:mt-4 pt-4 border-t border-hairline flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="w-4 h-4 text-[#7C6FE0] dark:text-[#B9A9F5]" />
              <span>Seguro, privado y protegido</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
