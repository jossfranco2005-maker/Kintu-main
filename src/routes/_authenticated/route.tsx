import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNotifications } from "@/lib/notifications.functions";
import { getDashboard } from "@/lib/finance.functions";
import { KintuAvatar, deriveKintuLevel, KintuLevelBar } from "@/components/kintu/KintuAvatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  LogOut,
  MessageCircle,
  Wallet,
  LifeBuoy,
  LayoutDashboard,
  Menu,
  ChevronDown,
  Leaf,
  History,
  Bell,
  User,
  Mail,
  Calendar,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState("");

  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching profile:", error);
        throw error;
      }

      if (!data) {
        const defaultName = user.email ? user.email.split("@")[0] : "Usuario Kintu";
        const { data: newProfile, error: insertError } = await supabase
          .from("profiles")
          .insert({ id: user.id, display_name: defaultName })
          .select()
          .single();

        if (insertError) {
          console.error("Error inserting profile:", insertError);
          throw insertError;
        }
        return newProfile;
      }

      return data;
    },
    enabled: !!user?.id,
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (newName: string) => {
      if (!user?.id) throw new Error("No user authenticated");
      const { data, error } = await supabase
        .from("profiles")
        .update({ display_name: newName })
        .eq("id", user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success("Perfil actualizado con éxito");
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Error al actualizar perfil";
      toast.error(message);
    },
  });

  const handleStartEdit = () => {
    setTempName(profileQuery.data?.display_name || "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveName = async () => {
    if (!tempName.trim()) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    await updateProfileMutation.mutateAsync(tempName.trim());
    setIsEditing(false);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-EC", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const getBannerGradient = (name: string) => {
    const gradients = [
      "from-[#D9CDF5] via-[#B9A7EE] to-[#8B74E0] dark:from-[#2e2652] dark:to-[#4C3A8C]",
      "from-[#EDE9FB] via-[#D9CDF5] to-[#7C6FE0] dark:from-[#1C1830] dark:to-[#7C6FE0]/80",
      "from-[#F5E6D3] via-[#E8BFA2] to-[#D98E73] dark:from-[#2A1810] dark:to-[#D98E73]/70",
      "from-[#E3F4E3] via-[#BCE3BC] to-[#7CB342] dark:from-[#0F200F] dark:to-[#7CB342]/70",
      "from-[#E1F5FE] via-[#B3E5FC] to-[#0288D1] dark:from-[#0A192F] dark:to-[#0288D1]/70",
      "from-[#FCE4EC] via-[#F8BBD0] to-[#E91E63] dark:from-[#2D1B28] dark:to-[#E91E63]/70",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  };

  const getNotificationsFn = useServerFn(getNotifications);
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotificationsFn(),
    refetchInterval: 30000,
  });
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  // Mismos datos que alimentan el árbol grande del dashboard, para que la
  // mini versión del sidebar respire con la misma data real.
  const getDashboardFn = useServerFn(getDashboard);
  const dashboardQuery = useQuery({
    queryKey: ["finance", "dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: 30000,
  });
  const dash = dashboardQuery.data;
  const savingsRate =
    dash && dash.income > 0
      ? Math.max(0, Math.min(100, ((dash.income - dash.expense) / dash.income) * 100))
      : 0;
  const { level: treeLevel, progressPct: treeProgress } = deriveKintuLevel(savingsRate);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    // Shell fijo al alto de la pantalla. overflow-hidden evita que el
    // documento completo se desplace: solo <main> hace scroll interno.
    // Al ser el aside un item flex de un padre con altura fija, se
    // estira automáticamente al 100% del alto sin necesitar sticky.
    <div className="h-screen overflow-hidden flex flex-col lg:flex-row bg-gradient-to-br from-[#D9CDF5] via-[#B9A7EE] to-[#8B74E0] dark:bg-background text-foreground">
      {/* MOBILE HEADER */}
      <header className="lg:hidden flex items-center justify-between border-b border-[#E4E0F5] bg-card px-4 py-3 shrink-0 z-40">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#7C6FE0]/10 flex items-center justify-center text-[#7C6FE0]">
            <Leaf className="w-4 h-4 fill-[#7C6FE0]" />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-base font-semibold leading-none text-[#4C3A8C] dark:text-[#B9A9F5]">
              Kintu
            </span>
            <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
              Tu libertad financiera
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/notifications"
            aria-label="Notificaciones"
            className="relative w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center text-foreground hover:bg-muted"
          >
            <Bell className="w-4.5 h-4.5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#7C6FE0]" />
            )}
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center text-foreground hover:bg-muted"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* MOBILE MENU DRAWER */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-64 max-w-[80vw] h-full bg-card p-6 flex flex-col justify-between border-r border-[#E4E0F5]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6">
              <div className="flex items-center gap-2 pb-4 border-b border-hairline">
                <div className="w-8 h-8 rounded-xl bg-[#7C6FE0]/10 flex items-center justify-center text-[#7C6FE0]">
                  <Leaf className="w-4 h-4 fill-[#7C6FE0]" />
                </div>
                <div className="flex flex-col">
                  <span className="font-serif text-base font-semibold text-[#4C3A8C] dark:text-[#B9A9F5]">
                    Kintu
                  </span>
                  <span className="text-[9px] text-muted-foreground">Tu libertad financiera</span>
                </div>
              </div>

              <nav className="flex flex-col gap-1">
                <MobileNavLink
                  to="/dashboard"
                  icon={<LayoutDashboard className="w-4 h-4" />}
                  label="Panel"
                  onClick={() => setMobileMenuOpen(false)}
                />
                <MobileNavLink
                  to="/chat"
                  icon={<MessageCircle className="w-4 h-4" />}
                  label="Chat"
                  onClick={() => setMobileMenuOpen(false)}
                />
                <MobileNavLink
                  to="/budgets"
                  icon={<Wallet className="w-4 h-4" />}
                  label="Presupuestos"
                  onClick={() => setMobileMenuOpen(false)}
                />
                <MobileNavLink
                  to="/movements"
                  icon={<History className="w-4 h-4" />}
                  label="Movimientos"
                  onClick={() => setMobileMenuOpen(false)}
                />
                <MobileNavLink
                  to="/notifications"
                  icon={<Bell className="w-4 h-4" />}
                  label="Notificaciones"
                  badge={unreadCount}
                  onClick={() => setMobileMenuOpen(false)}
                />
                <MobileNavLink
                  to="/tickets"
                  icon={<LifeBuoy className="w-4 h-4" />}
                  label="Casos"
                  onClick={() => setMobileMenuOpen(false)}
                />
              </nav>
            </div>

            <div className="flex flex-col gap-1.5 pt-4 border-t border-hairline">
              <button
                onClick={() => {
                  setIsProfileOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-[#4A4463] dark:text-muted-foreground/80 hover:bg-[#7C6FE0]/8 hover:text-[#4C3A8C] w-full text-left"
              >
                <User className="w-4 h-4 text-[#7C6FE0]" />
                <span>Ver perfil</span>
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-coral hover:bg-coral/10 w-full text-left"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DESKTOP LEFT SIDEBAR — item flex del shell con h-screen,
          por eso se estira solo al 100% del alto disponible y nunca
          se mueve, sin necesitar sticky. Nav scrollable en el medio
          (flex-1 overflow-y-auto), cuenta de usuario fija abajo
          (shrink-0 border-t). */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 h-full bg-card border-r border-[#E4E0F5] dark:border-hairline">
        {/* Logo — fijo arriba */}
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 px-6 py-5 shrink-0 border-b border-[#E4E0F5] dark:border-hairline"
        >
          <div className="w-9 h-9 rounded-xl bg-[#7C6FE0]/10 flex items-center justify-center text-[#7C6FE0] shrink-0">
            <Leaf className="w-4.5 h-4.5 fill-[#7C6FE0]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-serif text-lg font-bold leading-none text-[#4C3A8C] dark:text-[#B9A9F5]">
              Kintu
            </span>
            <span className="text-[10px] text-muted-foreground leading-none mt-1 truncate">
              Tu libertad financiera
            </span>
          </div>
        </Link>

        {/* Sección central — scrollable si el contenido no cabe, nav + árbol */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <nav className="flex flex-col gap-1">
            <SidebarNavLink
              to="/dashboard"
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Panel"
            />
            <SidebarNavLink to="/chat" icon={<MessageCircle className="w-4 h-4" />} label="Chat" />
            <SidebarNavLink
              to="/budgets"
              icon={<Wallet className="w-4 h-4" />}
              label="Presupuestos"
            />
            <SidebarNavLink
              to="/movements"
              icon={<History className="w-4 h-4" />}
              label="Movimientos"
            />
            <SidebarNavLink
              to="/notifications"
              icon={<Bell className="w-4 h-4" />}
              label="Notificaciones"
              badge={unreadCount}
            />
            <SidebarNavLink to="/tickets" icon={<LifeBuoy className="w-4 h-4" />} label="Casos" />
          </nav>

          {/* "Tu árbol crece" widget — tamaño fijo, no se estira */}
          <Link
            to="/dashboard"
            className="shrink-0 rounded-3xl bg-gradient-to-br from-[#EDE9FB] to-[#F5F4FA] dark:from-muted/10 dark:to-muted/10 border border-[#E4E0F5] dark:border-hairline shadow-sm p-5 flex flex-col items-center justify-center text-center hover:shadow-md transition-shadow"
          >
            <Avatar className="w-16 h-16 mb-2 bg-white/60 dark:bg-white/5 shrink-0">
              <AvatarFallback className="bg-transparent">
                <KintuAvatar
                  savingsRate={savingsRate}
                  incomes={dash?.income ?? 0}
                  expenses={dash?.expense ?? 0}
                  size={64}
                />
              </AvatarFallback>
            </Avatar>
            <p className="text-xs font-bold text-[#4C3A8C] dark:text-[#B9A9F5] leading-tight">
              ¡Tu árbol crece!
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-3 leading-tight">
              Cada ahorro te acerca a tus metas.
            </p>
            <KintuLevelBar
              level={treeLevel}
              progressPct={treeProgress}
              className="w-full shrink-0"
            />
          </Link>
        </div>

        {/* User Account — fijo abajo, siempre visible */}
        <div className="relative shrink-0 border-t border-[#E4E0F5] dark:border-hairline p-4">
          {userDropdownOpen && (
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-card border border-hairline rounded-2xl p-2 shadow-lg z-50">
              <button
                onClick={() => {
                  setIsProfileOpen(true);
                  setUserDropdownOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-xs font-semibold text-[#4A4463] dark:text-muted-foreground/80 hover:bg-muted transition-colors mb-1"
              >
                <User className="w-4 h-4 text-[#7C6FE0]" />
                <span>Ver perfil</span>
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-xs font-semibold text-coral hover:bg-coral/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          )}
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="w-full flex items-center justify-between gap-3 p-2 rounded-2xl bg-muted/40 dark:bg-muted/10 hover:bg-muted/70 transition-colors text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="w-8 h-8 shrink-0">
                <AvatarFallback className="bg-[#7C6FE0] text-white font-serif font-bold text-sm flex items-center justify-center w-full h-full">
                  {(profileQuery.data?.display_name || user?.email || "K")[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-bold text-foreground truncate">
                  {profileQuery.data?.display_name || "Cargando..."}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        </div>
      </aside>

      {/* MAIN VIEWPORT CONTENT — único elemento con scroll real del
          contenido de página. */}
      <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden bg-[#F5F4FA] dark:bg-[#15132A] min-h-0 min-w-0">
        <Outlet />
      </main>

      {/* PROFILE DIALOG */}
      <Dialog
        open={isProfileOpen}
        onOpenChange={(open) => {
          setIsProfileOpen(open);
          if (!open) setIsEditing(false);
        }}
      >
        <DialogContent className="sm:max-w-[480px] rounded-3xl p-0 overflow-hidden bg-white dark:bg-[#1C1830] border border-[#E4E0F5] dark:border-hairline shadow-2xl">
          {/* Header/Background card banner */}
          <div
            className={`h-28 bg-gradient-to-r ${getBannerGradient(profileQuery.data?.display_name || user?.email || "K")} relative shrink-0`}
          >
            {/* Float-out Avatar button - Centered & Premium style */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full border-4 border-white dark:border-[#1C1830] bg-[#7C6FE0] text-white flex items-center justify-center overflow-hidden w-24 h-24 shadow-lg transition-transform duration-300 hover:scale-105">
              <Avatar className="w-full h-full">
                <AvatarFallback className="bg-[#7C6FE0] text-white font-serif font-bold text-3xl flex items-center justify-center w-full h-full">
                  {(profileQuery.data?.display_name || user?.email || "K")[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>

          <div className="px-6 pt-16 pb-8 flex flex-col gap-6">
            {/* Profile Info / Edit Section - Centered */}
            <div className="flex flex-col items-center text-center gap-1">
              {isEditing ? (
                <div className="flex items-center justify-center gap-2 w-full max-w-[320px]">
                  <Input
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    className="h-10 px-3 rounded-xl border-[#E4E0F5] dark:border-hairline focus-visible:ring-[#7C6FE0] text-sm text-center"
                    placeholder="Tu nombre"
                    maxLength={50}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                  />
                  <Button
                    onClick={handleSaveName}
                    disabled={updateProfileMutation.isPending}
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl bg-[#7C6FE0] hover:bg-[#7C6FE0]/90 text-white shadow-sm"
                  >
                    {updateProfileMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    onClick={handleCancelEdit}
                    disabled={updateProfileMutation.isPending}
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl border-[#E4E0F5] dark:border-hairline hover:bg-muted"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 w-full max-w-full">
                  <h2 className="text-2xl font-bold font-serif text-foreground break-words max-w-[85%] leading-tight">
                    {profileQuery.data?.display_name || "Usuario Kintu"}
                  </h2>
                  <button
                    onClick={handleStartEdit}
                    className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-200 shrink-0 active:scale-95"
                    title="Editar nombre"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mt-1.5">
                Perfil de Usuario
              </p>
            </div>

            {/* Email and Join Date details grid */}
            <div className="grid grid-cols-1 gap-4">
              <div className="p-4 rounded-2xl bg-muted/40 dark:bg-muted/10 border border-[#E4E0F5]/50 dark:border-hairline/30 flex items-start gap-3 min-w-0 h-full transition-all duration-300 hover:shadow-md hover:border-[#7C6FE0]/30 hover:bg-white dark:hover:bg-muted/20 hover:-translate-y-0.5">
                <div className="w-10 h-10 rounded-xl bg-[#7C6FE0]/10 text-[#7C6FE0] dark:text-[#B9A9F5] flex items-center justify-center shrink-0 mt-0.5">
                  <Mail className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase leading-none">
                    Correo
                  </p>
                  <p className="text-xs text-foreground font-medium break-all [word-break:break-word] [overflow-wrap:anywhere] whitespace-pre-wrap mt-1.5 leading-relaxed">
                    {user?.email}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 dark:bg-muted/10 border border-[#E4E0F5]/50 dark:border-hairline/30 flex items-start gap-3 min-w-0 h-full transition-all duration-300 hover:shadow-md hover:border-[#7C6FE0]/30 hover:bg-white dark:hover:bg-muted/20 hover:-translate-y-0.5">
                <div className="w-10 h-10 rounded-xl bg-[#7C6FE0]/10 text-[#7C6FE0] dark:text-[#B9A9F5] flex items-center justify-center shrink-0 mt-0.5">
                  <Calendar className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase leading-none">
                    Miembro desde
                  </p>
                  <p className="text-xs text-foreground font-medium break-words whitespace-pre-wrap mt-1.5 leading-relaxed">
                    {formatDate(user?.created_at)}
                  </p>
                </div>
              </div>
            </div>

            {/* Kintu Tree Progress Mascot Card */}
            <div className="rounded-3xl bg-gradient-to-br from-[#EDE9FB] to-[#F5F4FA] dark:from-muted/10 dark:to-muted/10 border border-[#E4E0F5] dark:border-hairline p-5 flex flex-col sm:flex-row items-center gap-5 transition-all duration-300 hover:shadow-md hover:border-[#7C6FE0]/25">
              <div className="w-20 h-20 bg-white/60 dark:bg-white/5 rounded-2xl shrink-0 flex items-center justify-center shadow-sm border border-[#E4E0F5]/30 dark:border-hairline/10">
                <KintuAvatar
                  savingsRate={savingsRate}
                  incomes={dash?.income ?? 0}
                  expenses={dash?.expense ?? 0}
                  size={76}
                />
              </div>
              <div className="flex-1 w-full">
                <p className="text-xs font-bold text-[#4C3A8C] dark:text-[#B9A9F5] leading-tight mb-1">
                  Tu progreso Kintu
                </p>
                <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                  {treeLevel === 1 &&
                    "Tu semilla está brotando. ¡Seguí registrando para verla crecer!"}
                  {treeLevel === 2 && "Un pequeño brote ha surgido. ¡Vas por muy buen camino!"}
                  {treeLevel === 3 && "Tu arbolito está creciendo fuerte y sano."}
                  {treeLevel === 4 &&
                    "¡Tenés un árbol frondoso! Tus finanzas están muy saludables."}
                  {treeLevel === 5 && "¡Bosque Kintu! Sos un maestro de la libertad financiera."}
                </p>
                <KintuLevelBar
                  level={treeLevel}
                  progressPct={treeProgress}
                  className="w-full shrink-0"
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SidebarNavLink({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-[#4A4463] dark:text-muted-foreground/80 transition-all duration-200 hover:bg-[#7C6FE0]/8 hover:text-[#4C3A8C]"
      activeProps={{
        className:
          "text-white bg-[#4C3A8C] dark:bg-[#7C6FE0] dark:text-[#1C1830] shadow-sm font-bold active-link",
      }}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {!!badge && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#7C6FE0] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

function MobileNavLink({
  to,
  icon,
  label,
  onClick,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-[#4A4463] dark:text-muted-foreground/80 hover:bg-[#7C6FE0]/8 hover:text-[#4C3A8C]"
      activeProps={{
        className:
          "text-white bg-[#4C3A8C] dark:bg-[#7C6FE0] dark:text-[#1C1830] shadow-sm font-bold",
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!badge && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#7C6FE0] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}
