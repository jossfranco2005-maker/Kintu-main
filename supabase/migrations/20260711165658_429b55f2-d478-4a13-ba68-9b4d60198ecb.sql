
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('admin', 'agent', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read"  ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile write" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ TRANSACTIONS ============
CREATE TYPE public.tx_type AS ENUM ('income', 'expense');

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.tx_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  category TEXT NOT NULL,
  merchant TEXT,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'chat',
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.transactions (user_id, date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tx" ON public.transactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ BUDGETS ============
CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  month DATE NOT NULL, -- first day of month
  limit_amount NUMERIC(12,2) NOT NULL CHECK (limit_amount > 0),
  alert_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.80 CHECK (alert_threshold > 0 AND alert_threshold <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own budgets" ON public.budgets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ ALERTS ============
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL, -- 'threshold' | 'exceeded'
  percentage NUMERIC(5,2) NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own alerts" ON public.alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ CONVERSATIONS + MESSAGES ============
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conv" ON public.conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.messages (conversation_id, created_at);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own msgs" ON public.messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ KNOWLEDGE ARTICLES ============
CREATE TABLE public.knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'internal',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.knowledge_articles TO anon, authenticated;
GRANT ALL ON public.knowledge_articles TO service_role;
ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read approved kb" ON public.knowledge_articles FOR SELECT TO anon, authenticated USING (approved = true);
CREATE POLICY "admin manage kb" ON public.knowledge_articles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ TICKETS ============
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  summary TEXT NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  conversation_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING_HUMAN_REVIEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tickets read"   ON public.tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own tickets insert" ON public.tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agent tickets read" ON public.tickets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'agent') OR public.has_role(auth.uid(),'admin'));

-- ============ SEED KB ============
INSERT INTO public.knowledge_articles (title, content, category, approved, version, source) VALUES
('Cómo actualizar mis datos personales',
 'Para actualizar tus datos personales (nombre, teléfono, correo), ingresa a tu perfil y toca "Editar". Los cambios se aplican al instante. Si el sistema no acepta el cambio, un humano puede ayudarte desde soporte.',
 'cuenta', true, 1, 'kintu-kb/v1'),
('Qué hacer si no reconozco un cargo',
 'Si ves un movimiento que no reconoces, marca ese gasto como "no lo hice yo". Se abre un caso con un humano del equipo. No confirmes el cargo desde el chat: el asistente no puede resolver disputas por su cuenta.',
 'seguridad', true, 1, 'kintu-kb/v1'),
('Cómo fijar un presupuesto mensual',
 'Escribe algo como "presupuesto de 200 en comida, aviso al 80%" o abre la sección Presupuestos. Cada vez que confirmes un gasto de esa categoría, se recalcula y te avisamos al cruzar el umbral.',
 'presupuesto', true, 1, 'kintu-kb/v1'),
('Cómo hablar con un humano',
 'Escribe "quiero hablar con una persona" o describe un problema sensible (fraude, reclamo, tema regulatorio). Creamos un ticket con tu contexto y un humano del equipo te contacta. Ninguna acción sensible se ejecuta sola.',
 'soporte', true, 1, 'kintu-kb/v1');
