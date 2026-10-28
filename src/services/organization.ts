import { supabase } from '@/lib/supabase/client'

export interface Organization {
  id: string
  nome: string
  created_at: string
  created_by?: string
}

export const createOrganization = async (name: string) => {
  const { data, error } = await supabase
    .from('organizations')
    .insert({ nome: name })
    .select()
    .single()

  if (error) throw error
  return data as Organization
}

export const getOrganization = async (id: string) => {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Organization
}
