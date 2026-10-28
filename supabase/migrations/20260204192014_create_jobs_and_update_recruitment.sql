-- Create Vagas table
CREATE TABLE IF NOT EXISTS public.vagas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    descricao TEXT,
    departamento TEXT,
    requisitos TEXT,
    salario NUMERIC,
    tipo_contrato TEXT,
    status TEXT DEFAULT 'Aberta',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Update Recrutamento table (Candidates)
ALTER TABLE public.recrutamento ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.recrutamento ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE public.recrutamento ADD COLUMN IF NOT EXISTS vaga_id UUID REFERENCES public.vagas(id) ON DELETE SET NULL;

-- Enable RLS for Vagas
ALTER TABLE public.vagas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to authenticated users" ON public.vagas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_recrutamento_vaga_id ON public.recrutamento(vaga_id);
