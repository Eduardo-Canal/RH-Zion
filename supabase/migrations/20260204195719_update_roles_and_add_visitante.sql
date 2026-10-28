-- Update the constraint on colaboradores table to include 'visitante'
ALTER TABLE public.colaboradores 
DROP CONSTRAINT IF EXISTS valid_roles;

ALTER TABLE public.colaboradores 
ADD CONSTRAINT valid_roles CHECK (role IN ('Admin', 'Gerente', 'Colaborador', 'visitante'));
