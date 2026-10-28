-- Add observacoes column to ferias table
ALTER TABLE public.ferias ADD COLUMN IF NOT EXISTS observacoes TEXT;
