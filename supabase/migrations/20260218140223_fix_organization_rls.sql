-- Add created_by column to organizations to track ownership
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid();

-- Update policies for organizations to allow creators to view their organizations
-- This fixes the issue where insert().select() fails because the user is not yet a member of the organization
DROP POLICY IF EXISTS "Organizations viewable by members" ON public.organizations;
CREATE POLICY "Organizations viewable by members" ON public.organizations
FOR SELECT USING (
  id = public.get_my_org_id() 
  OR 
  created_by = auth.uid()
);

-- Ensure insert policy allows authenticated users to create organizations
DROP POLICY IF EXISTS "Organizations insertable by auth users" ON public.organizations;
CREATE POLICY "Organizations insertable by auth users" ON public.organizations
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);
