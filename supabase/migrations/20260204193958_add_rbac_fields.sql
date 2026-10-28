ALTER TABLE public.colaboradores 
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Colaborador',
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Add constraint for role values
ALTER TABLE public.colaboradores 
DROP CONSTRAINT IF EXISTS valid_roles;

ALTER TABLE public.colaboradores 
ADD CONSTRAINT valid_roles CHECK (role IN ('Admin', 'Gerente', 'Colaborador'));

-- Update existing records to have a default role if needed (already handled by default)
-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_colaboradores_user_id ON public.colaboradores(user_id);
