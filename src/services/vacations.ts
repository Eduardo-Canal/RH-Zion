import { supabase } from '@/lib/supabase/client'

export interface Vacation {
  id: string
  colaborador_id: string
  data_inicio: string
  data_fim: string
  status: 'Pendente' | 'Aprovada' | 'Reprovada'
  observacoes?: string
  colaboradores?: {
    nome: string
  }
  organization_id: string
}

export const getVacations = async () => {
  const { data, error } = await supabase
    .from('ferias')
    .select('*, colaboradores(nome)')
    .order('data_inicio', { ascending: false })

  if (error) throw error
  return data as Vacation[]
}

export const getVacationsByEmployeeId = async (employeeId: string) => {
  const { data, error } = await supabase
    .from('ferias')
    .select('*, colaboradores(nome)')
    .eq('colaborador_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Vacation[]
}

export const createVacation = async (
  vacation: Omit<
    Vacation,
    'id' | 'colaboradores' | 'status' | 'organization_id'
  > & { organization_id?: string },
) => {
  const { data, error } = await supabase
    .from('ferias')
    .insert({ ...vacation, status: 'Pendente' })
    .select('*, colaboradores(nome)')
    .single()

  if (error) throw error
  return data as Vacation
}

export const updateVacation = async (
  id: string,
  vacation: Partial<Vacation>,
) => {
  const { data, error } = await supabase
    .from('ferias')
    .update(vacation)
    .eq('id', id)
    .select('*, colaboradores(nome)')
    .single()

  if (error) throw error
  return data as Vacation
}

export const deleteVacation = async (id: string) => {
  const { error } = await supabase.from('ferias').delete().eq('id', id)

  if (error) throw error
}
