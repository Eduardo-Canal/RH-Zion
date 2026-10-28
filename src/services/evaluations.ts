import { supabase } from '@/lib/supabase/client'

export interface Evaluation {
  id: string
  created_at: string
  colaborador_id: string
  avaliador_id: string | null
  periodo: string
  nota_pontualidade: number
  nota_qualidade: number
  nota_trabalho_equipe: number
  observacoes: string | null
  colaborador?: {
    nome: string
    cargo: string | null
    image_gender: string | null
  }
  avaliador?: { nome: string }
  organization_id: string
}

export interface CreateEvaluationDTO {
  colaborador_id: string
  avaliador_id: string
  periodo: string
  nota_pontualidade: number
  nota_qualidade: number
  nota_trabalho_equipe: number
  observacoes?: string
  organization_id?: string
}

export const getEvaluations = async () => {
  const { data, error } = await supabase
    .from('avaliacoes')
    .select(
      `
      *,
      colaborador:colaboradores!fk_avaliacoes_colaborador(nome, cargo, image_gender),
      avaliador:colaboradores!fk_avaliacoes_avaliador(nome)
    `,
    )
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as unknown as Evaluation[]
}

export const createEvaluation = async (evaluation: CreateEvaluationDTO) => {
  const { data, error } = await supabase
    .from('avaliacoes')
    .insert(evaluation)
    .select()
    .single()

  if (error) throw error
  return data as Evaluation
}

export const deleteEvaluation = async (id: string) => {
  const { error } = await supabase.from('avaliacoes').delete().eq('id', id)

  if (error) throw error
}
