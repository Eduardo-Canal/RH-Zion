import * as z from 'zod'

export const evaluationSchema = z.object({
  colaboradorId: z
    .string({ required_error: 'Selecione um colaborador' })
    .min(1, 'Selecione um colaborador'),
  avaliadorId: z
    .string({ required_error: 'Selecione um avaliador' })
    .min(1, 'Selecione um avaliador'),
  periodo: z.string().min(2, 'Informe o período (ex: Jan/2024)'),
  notaPontualidade: z.coerce.number().min(1).max(5),
  notaQualidade: z.coerce.number().min(1).max(5),
  notaTrabalhoEquipe: z.coerce.number().min(1).max(5),
  observacoes: z.string().optional(),
})

export type EvaluationFormValues = z.infer<typeof evaluationSchema>
