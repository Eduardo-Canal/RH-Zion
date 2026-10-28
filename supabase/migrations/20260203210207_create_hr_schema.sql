-- Create storage bucket for documents if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Policies for storage
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "Auth Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');
CREATE POLICY "Auth Update" ON storage.objects FOR UPDATE WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');
CREATE POLICY "Auth Delete" ON storage.objects FOR DELETE USING (bucket_id = 'documents' AND auth.role() = 'authenticated');

-- Create Tables
CREATE TABLE IF NOT EXISTS public.colaboradores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    nome TEXT NOT NULL,
    cpf TEXT,
    rg TEXT,
    data_nascimento DATE,
    endereco TEXT,
    email TEXT,
    telefone TEXT,
    cargo TEXT,
    departamento TEXT,
    data_admissao DATE,
    salario NUMERIC,
    tipo_contrato TEXT,
    status TEXT DEFAULT 'Ativo',
    documentos_urls JSONB DEFAULT '[]'::jsonb,
    image_gender TEXT DEFAULT 'male'
);

CREATE TABLE IF NOT EXISTS public.recrutamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    nome_candidato TEXT NOT NULL,
    vaga TEXT NOT NULL,
    status TEXT NOT NULL,
    image_gender TEXT DEFAULT 'male'
);

CREATE TABLE IF NOT EXISTS public.ponto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    colaborador_id UUID REFERENCES public.colaboradores(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    hora_entrada TEXT,
    hora_saida TEXT
);

CREATE TABLE IF NOT EXISTS public.ferias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    colaborador_id UUID REFERENCES public.colaboradores(id) ON DELETE CASCADE,
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    status TEXT DEFAULT 'Pendente'
);

-- RLS Policies
ALTER TABLE public.colaboradores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to authenticated users" ON public.colaboradores FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.recrutamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to authenticated users" ON public.recrutamento FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.ponto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to authenticated users" ON public.ponto FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.ferias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to authenticated users" ON public.ferias FOR ALL TO authenticated USING (true) WITH CHECK (true);
