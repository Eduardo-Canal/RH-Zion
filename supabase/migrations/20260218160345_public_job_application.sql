-- Allow anon to select public jobs (only active ones)
CREATE POLICY "Public read access for jobs" ON public.vagas
FOR SELECT TO anon
USING (status = 'Aberta');

-- Allow anon to insert candidates
CREATE POLICY "Public insert access for candidates" ON public.recrutamento
FOR INSERT TO anon
WITH CHECK (true);

-- Create 'curriculos' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('curriculos', 'curriculos', true) 
ON CONFLICT (id) DO NOTHING;

-- Allow public uploads to 'curriculos' bucket
CREATE POLICY "Public upload access for curriculos" ON storage.objects
FOR INSERT TO anon
WITH CHECK (bucket_id = 'curriculos');

-- Allow public read access to 'curriculos' bucket (so admin can view them)
CREATE POLICY "Public read access for curriculos" ON storage.objects
FOR SELECT TO anon
USING (bucket_id = 'curriculos');

-- Also ensure authenticated users can read/write to 'curriculos'
CREATE POLICY "Authenticated access for curriculos" ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'curriculos')
WITH CHECK (bucket_id = 'curriculos');
