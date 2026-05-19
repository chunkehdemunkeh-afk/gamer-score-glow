
-- Roles enum + table
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Updated-at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  gamertag TEXT NOT NULL UNIQUE,
  xuid TEXT NOT NULL UNIQUE,
  gamerpic TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own profile" ON public.profiles
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Completions
CREATE TYPE public.completion_status AS ENUM ('approved', 'flagged', 'rejected');

CREATE TABLE public.completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL,
  game_name TEXT NOT NULL,
  game_cover_url TEXT,
  total_gamerscore INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL,
  hours_played NUMERIC(8,2) NOT NULL CHECK (hours_played > 0),
  points INTEGER NOT NULL DEFAULT 0,
  status completion_status NOT NULL DEFAULT 'approved',
  flag_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, title_id)
);
ALTER TABLE public.completions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_completions_user ON public.completions(user_id);
CREATE INDEX idx_completions_status_date ON public.completions(status, completed_at DESC);

CREATE POLICY "Approved completions are public" ON public.completions
  FOR SELECT USING (status = 'approved' OR auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own completions" ON public.completions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own completions" ON public.completions
  FOR UPDATE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can delete own completions" ON public.completions
  FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_completions_updated_at
BEFORE UPDATE ON public.completions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-game aggregate stats (anti-cheat baseline)
CREATE TABLE public.game_stats (
  title_id TEXT PRIMARY KEY,
  game_name TEXT NOT NULL,
  median_hours NUMERIC(8,2),
  submission_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.game_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Game stats are public" ON public.game_stats
  FOR SELECT USING (true);

-- Recompute median + count when completions change
CREATE OR REPLACE FUNCTION public.refresh_game_stats(_title_id TEXT, _game_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.game_stats (title_id, game_name, median_hours, submission_count, updated_at)
  SELECT
    _title_id,
    _game_name,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours_played),
    COUNT(*),
    now()
  FROM public.completions
  WHERE title_id = _title_id AND status = 'approved'
  ON CONFLICT (title_id) DO UPDATE
  SET median_hours = EXCLUDED.median_hours,
      submission_count = EXCLUDED.submission_count,
      game_name = EXCLUDED.game_name,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_game_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_game_stats(
    COALESCE(NEW.title_id, OLD.title_id),
    COALESCE(NEW.game_name, OLD.game_name)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_completions_stats
AFTER INSERT OR UPDATE OR DELETE ON public.completions
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_game_stats();

-- Auto-create profile placeholder is NOT used (gamertag is set during onboarding via Xbox API)
