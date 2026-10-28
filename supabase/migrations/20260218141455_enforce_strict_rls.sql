-- Enforce strict RLS by removing permissive policies and ensuring isolation policies

-- 1. Enable RLS on all core tables to ensure security is active
ALTER TABLE public.colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recrutamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ponto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ferias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

-- 2. Drop permissive policies that might allow cross-tenant access
-- Dropping "Allow all access to authenticated users" from previous migrations
DROP POLICY IF EXISTS "Allow all access to authenticated users" ON public.colaboradores;
DROP POLICY IF EXISTS "Allow all access to authenticated users" ON public.vagas;
DROP POLICY IF EXISTS "Allow all access to authenticated users" ON public.recrutamento;
DROP POLICY IF EXISTS "Allow all access to authenticated users" ON public.ponto;
DROP POLICY IF EXISTS "Allow all access to authenticated users" ON public.ferias;

-- Dropping granular permissive policies on avaliacoes
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.avaliacoes;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.avaliacoes;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.avaliacoes;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.avaliacoes;

-- 3. Drop existing isolation policies to recreate them with strict definitions
DROP POLICY IF EXISTS "Colaboradores isolation" ON public.colaboradores;
DROP POLICY IF EXISTS "Vagas isolation" ON public.vagas;
DROP POLICY IF EXISTS "Recrutamento isolation" ON public.recrutamento;
DROP POLICY IF EXISTS "Ponto isolation" ON public.ponto;
DROP POLICY IF EXISTS "Ferias isolation" ON public.ferias;
DROP POLICY IF EXISTS "Avaliacoes isolation" ON public.avaliacoes;

-- 4. Create strict organization-based isolation policies

-- COLABORADORES
-- Users can only see/modify records belonging to their organization
-- We also allow users to see/edit their own record (user_id = auth.uid()) to ensure profile management and bootstrapping works
CREATE POLICY "Colaboradores isolation" ON public.colaboradores
FOR ALL USING (
  organization_id = public.get_my_org_id()
  OR user_id = auth.uid()
)
WITH CHECK (
  organization_id = public.get_my_org_id()
  OR user_id = auth.uid()
);

-- VAGAS
CREATE POLICY "Vagas isolation" ON public.vagas
FOR ALL USING (
  organization_id = public.get_my_org_id()
)
WITH CHECK (
  organization_id = public.get_my_org_id()
);

-- RECRUTAMENTO
CREATE POLICY "Recrutamento isolation" ON public.recrutamento
FOR ALL USING (
  organization_id = public.get_my_org_id()
)
WITH CHECK (
  organization_id = public.get_my_org_id()
);

-- PONTO
CREATE POLICY "Ponto isolation" ON public.ponto
FOR ALL USING (
  organization_id = public.get_my_org_id()
)
WITH CHECK (
  organization_id = public.get_my_org_id()
);

-- FERIAS
CREATE POLICY "Ferias isolation" ON public.ferias
FOR ALL USING (
  organization_id = public.get_my_org_id()
)
WITH CHECK (
  organization_id = public.get_my_org_id()
);

-- AVALIACOES
CREATE POLICY "Avaliacoes isolation" ON public.avaliacoes
FOR ALL USING (
  organization_id = public.get_my_org_id()
)
WITH CHECK (
  organization_id = public.get_my_org_id()
);
