CREATE TABLE IF NOT EXISTS public.avaliacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    colaborador_id UUID NOT NULL,
    avaliador_id UUID,
    periodo TEXT NOT NULL,
    nota_pontualidade INT2 NOT NULL CHECK (nota_pontualidade BETWEEN 1 AND 5),
    nota_qualidade INT2 NOT NULL CHECK (nota_qualidade BETWEEN 1 AND 5),
    nota_trabalho_equipe INT2 NOT NULL CHECK (nota_trabalho_equipe BETWEEN 1 AND 5),
    observacoes TEXT,
    CONSTRAINT fk_avaliacoes_colaborador FOREIGN KEY (colaborador_id) REFERENCES public.colaboradores(id) ON DELETE CASCADE,
    CONSTRAINT fk_avaliacoes_avaliador FOREIGN KEY (avaliador_id) REFERENCES public.colaboradores(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable read access for authenticated users" ON public.avaliacoes
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Enable insert access for authenticated users" ON public.avaliacoes
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Enable update access for authenticated users" ON public.avaliacoes
    FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Enable delete access for authenticated users" ON public.avaliacoes
    FOR DELETE
    TO authenticated
    USING (true);
