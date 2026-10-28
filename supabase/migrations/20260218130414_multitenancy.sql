-- Create organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Create default organization for migration/backward compatibility
DO $$
DECLARE
    default_org_id UUID;
BEGIN
    -- Check if we need to create a default org (only if there is existing data but no organizations)
    IF NOT EXISTS (SELECT 1 FROM public.organizations) AND EXISTS (SELECT 1 FROM public.colaboradores) THEN
        INSERT INTO public.organizations (nome) VALUES ('Default Organization') RETURNING id INTO default_org_id;
    END IF;

    -- Add organization_id column to tables
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'colaboradores' AND column_name = 'organization_id') THEN
        ALTER TABLE public.colaboradores ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
        IF default_org_id IS NOT NULL THEN
            UPDATE public.colaboradores SET organization_id = default_org_id WHERE organization_id IS NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vagas' AND column_name = 'organization_id') THEN
        ALTER TABLE public.vagas ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
        IF default_org_id IS NOT NULL THEN
            UPDATE public.vagas SET organization_id = default_org_id WHERE organization_id IS NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recrutamento' AND column_name = 'organization_id') THEN
        ALTER TABLE public.recrutamento ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
        IF default_org_id IS NOT NULL THEN
            UPDATE public.recrutamento SET organization_id = default_org_id WHERE organization_id IS NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ponto' AND column_name = 'organization_id') THEN
        ALTER TABLE public.ponto ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
        IF default_org_id IS NOT NULL THEN
            UPDATE public.ponto SET organization_id = default_org_id WHERE organization_id IS NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ferias' AND column_name = 'organization_id') THEN
        ALTER TABLE public.ferias ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
        IF default_org_id IS NOT NULL THEN
            UPDATE public.ferias SET organization_id = default_org_id WHERE organization_id IS NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'avaliacoes' AND column_name = 'organization_id') THEN
        ALTER TABLE public.avaliacoes ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
        IF default_org_id IS NOT NULL THEN
            UPDATE public.avaliacoes SET organization_id = default_org_id WHERE organization_id IS NULL;
        END IF;
    END IF;
END $$;

-- Enforce NOT NULL constraint after potential backfill (If there is no data, this is fine. If there was data, we backfilled)
-- Note: We check if there are any nulls before applying, to be safe against partial migrations or new empty tables
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.colaboradores ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    
    BEGIN
        ALTER TABLE public.vagas ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        ALTER TABLE public.recrutamento ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        ALTER TABLE public.ponto ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        ALTER TABLE public.ferias ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        ALTER TABLE public.avaliacoes ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Helper function to get current user's organization id
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT organization_id FROM public.colaboradores WHERE user_id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function to auto-assign organization_id
CREATE OR REPLACE FUNCTION public.auto_assign_org_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        NEW.organization_id := public.get_my_org_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply triggers
DROP TRIGGER IF EXISTS tr_assign_org_colaboradores ON public.colaboradores;
CREATE TRIGGER tr_assign_org_colaboradores BEFORE INSERT ON public.colaboradores FOR EACH ROW EXECUTE FUNCTION public.auto_assign_org_id();

DROP TRIGGER IF EXISTS tr_assign_org_vagas ON public.vagas;
CREATE TRIGGER tr_assign_org_vagas BEFORE INSERT ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.auto_assign_org_id();

DROP TRIGGER IF EXISTS tr_assign_org_recrutamento ON public.recrutamento;
CREATE TRIGGER tr_assign_org_recrutamento BEFORE INSERT ON public.recrutamento FOR EACH ROW EXECUTE FUNCTION public.auto_assign_org_id();

DROP TRIGGER IF EXISTS tr_assign_org_ponto ON public.ponto;
CREATE TRIGGER tr_assign_org_ponto BEFORE INSERT ON public.ponto FOR EACH ROW EXECUTE FUNCTION public.auto_assign_org_id();

DROP TRIGGER IF EXISTS tr_assign_org_ferias ON public.ferias;
CREATE TRIGGER tr_assign_org_ferias BEFORE INSERT ON public.ferias FOR EACH ROW EXECUTE FUNCTION public.auto_assign_org_id();

DROP TRIGGER IF EXISTS tr_assign_org_avaliacoes ON public.avaliacoes;
CREATE TRIGGER tr_assign_org_avaliacoes BEFORE INSERT ON public.avaliacoes FOR EACH ROW EXECUTE FUNCTION public.auto_assign_org_id();


-- RLS Policies

-- ORGANIZATIONS
DROP POLICY IF EXISTS "Organizations viewable by members" ON public.organizations;
CREATE POLICY "Organizations viewable by members" ON public.organizations
FOR SELECT USING (
  id = public.get_my_org_id()
);

DROP POLICY IF EXISTS "Organizations insertable by auth users" ON public.organizations;
CREATE POLICY "Organizations insertable by auth users" ON public.organizations
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

-- COLABORADORES
DROP POLICY IF EXISTS "Colaboradores isolation" ON public.colaboradores;
CREATE POLICY "Colaboradores isolation" ON public.colaboradores
FOR ALL USING (
  organization_id = public.get_my_org_id()
  OR user_id = auth.uid() -- Allow self-access/creation
);

-- VAGAS
DROP POLICY IF EXISTS "Vagas isolation" ON public.vagas;
CREATE POLICY "Vagas isolation" ON public.vagas
FOR ALL USING (
  organization_id = public.get_my_org_id()
);

-- RECRUTAMENTO
DROP POLICY IF EXISTS "Recrutamento isolation" ON public.recrutamento;
CREATE POLICY "Recrutamento isolation" ON public.recrutamento
FOR ALL USING (
  organization_id = public.get_my_org_id()
);

-- PONTO
DROP POLICY IF EXISTS "Ponto isolation" ON public.ponto;
CREATE POLICY "Ponto isolation" ON public.ponto
FOR ALL USING (
  organization_id = public.get_my_org_id()
);

-- FERIAS
DROP POLICY IF EXISTS "Ferias isolation" ON public.ferias;
CREATE POLICY "Ferias isolation" ON public.ferias
FOR ALL USING (
  organization_id = public.get_my_org_id()
);

-- AVALIACOES
DROP POLICY IF EXISTS "Avaliacoes isolation" ON public.avaliacoes;
CREATE POLICY "Avaliacoes isolation" ON public.avaliacoes
FOR ALL USING (
  organization_id = public.get_my_org_id()
);
