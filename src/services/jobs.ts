import { supabase } from '@/lib/supabase/client'

export interface Job {
  id: string
  titulo: string
  descricao: string
  departamento: string
  requisitos: string
  salario: number
  tipo_contrato: string
  status: 'Aberta' | 'Fechada'
  created_at: string
  candidates_count?: number
  organization_id: string
}

export const getJobs = async () => {
  const { data, error } = await supabase
    .from('vagas')
    .select('*, recrutamento(count)')
    .order('created_at', { ascending: false })

  if (error) throw error

  return data.map((job: any) => ({
    ...job,
    candidates_count: job.recrutamento ? job.recrutamento[0]?.count : 0,
  })) as Job[]
}

export const getJobById = async (id: string) => {
  const { data, error } = await supabase
    .from('vagas')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Job
}

export const createJob = async (
  job: Omit<
    Job,
    'id' | 'created_at' | 'candidates_count' | 'organization_id'
  > & { organization_id?: string },
) => {
  const { data, error } = await supabase
    .from('vagas')
    .insert(job)
    .select()
    .single()

  if (error) throw error
  return data as Job
}

export const updateJob = async (id: string, job: Partial<Job>) => {
  const { data, error } = await supabase
    .from('vagas')
    .update(job)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Job
}

export const deleteJob = async (id: string) => {
  const { error } = await supabase.from('vagas').delete().eq('id', id)

  if (error) throw error
}
