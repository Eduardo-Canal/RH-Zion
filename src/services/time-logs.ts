import { supabase } from '@/lib/supabase/client'
import { format } from 'date-fns'

export interface TimeLog {
  id: string
  colaborador_id: string
  data: string
  hora_entrada: string
  hora_saida: string | null
  colaboradores?: {
    nome: string
  }
  organization_id: string
}

export const getTimeLogs = async (colaboradorId?: string) => {
  let query = supabase
    .from('ponto')
    .select('*, colaboradores(nome)')
    .order('data', { ascending: false })
    .order('hora_entrada', { ascending: false })

  if (colaboradorId) {
    query = query.eq('colaborador_id', colaboradorId)
  }

  const { data, error } = await query

  if (error) throw error
  return data as TimeLog[]
}

export const createTimeLog = async (
  log: Omit<TimeLog, 'id' | 'colaboradores' | 'organization_id'> & {
    organization_id?: string
  },
) => {
  const { data, error } = await supabase
    .from('ponto')
    .insert(log)
    .select('*, colaboradores(nome)')
    .single()

  if (error) throw error
  return data as TimeLog
}

export const updateTimeLog = async (id: string, log: Partial<TimeLog>) => {
  const { data, error } = await supabase
    .from('ponto')
    .update(log)
    .eq('id', id)
    .select('*, colaboradores(nome)')
    .single()

  if (error) throw error
  return data as TimeLog
}

export const deleteTimeLog = async (id: string) => {
  const { error } = await supabase.from('ponto').delete().eq('id', id)

  if (error) throw error
}

// Helper for employee clock-in
export const clockIn = async (colaboradorId: string) => {
  const today = format(new Date(), 'yyyy-MM-dd')
  const now = format(new Date(), 'HH:mm')

  // Check if already clocked in today
  const { data: existing } = await supabase
    .from('ponto')
    .select('*')
    .eq('colaborador_id', colaboradorId)
    .eq('data', today)
    .single()

  if (existing) {
    throw new Error('Já existe um registro de ponto para hoje.')
  }

  const { data, error } = await supabase
    .from('ponto')
    .insert({
      colaborador_id: colaboradorId,
      data: today,
      hora_entrada: now,
      hora_saida: null,
    })
    .select()
    .single()

  if (error) throw error
  return data as TimeLog
}

// Helper for employee clock-out
export const clockOut = async (colaboradorId: string) => {
  const today = format(new Date(), 'yyyy-MM-dd')
  const now = format(new Date(), 'HH:mm')

  // Find today's record
  const { data: existing } = await supabase
    .from('ponto')
    .select('*')
    .eq('colaborador_id', colaboradorId)
    .eq('data', today)
    .is('hora_saida', null)
    .single()

  if (!existing) {
    throw new Error(
      'Não foi encontrado registro de entrada pendente para hoje.',
    )
  }

  const { data, error } = await supabase
    .from('ponto')
    .update({
      hora_saida: now,
    })
    .eq('id', existing.id)
    .select()
    .single()

  if (error) throw error
  return data as TimeLog
}

export const getTodayLog = async (colaboradorId: string) => {
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data, error } = await supabase
    .from('ponto')
    .select('*')
    .eq('colaborador_id', colaboradorId)
    .eq('data', today)
    .maybeSingle()

  if (error) throw error
  return data as TimeLog | null
}
