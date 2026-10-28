import * as z from 'zod'

export const completeProfileSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('Email inválido').optional(),
  cpf: z.string().min(11, 'CPF deve ter 11 dígitos').max(14, 'CPF inválido'),
  phone: z.string().min(10, 'Telefone inválido'),
  address: z.string().min(5, 'Endereço completo é obrigatório'),
  birthDate: z.date({ required_error: 'Data de nascimento é obrigatória' }),
  image_gender: z.enum(['male', 'female'], {
    required_error: 'Selecione uma preferência de avatar',
  }),
})

export type CompleteProfileFormValues = z.infer<typeof completeProfileSchema>
