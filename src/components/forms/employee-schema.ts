import * as z from 'zod'

export const employeeSchema = z.object({
  // Dados Pessoais
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  cpf: z.string().min(11, 'CPF deve ter 11 dígitos').max(14, 'CPF inválido'),
  rg: z.string().optional(),
  data_nascimento: z.date({
    required_error: 'Data de nascimento é obrigatória',
  }),
  endereco: z.string().min(5, 'Endereço completo é obrigatório'),
  email: z.string().email('Email inválido'),
  telefone: z.string().min(10, 'Telefone inválido'),
  image_gender: z.enum(['male', 'female'], {
    required_error: 'Selecione um gênero',
  }),

  // Dados Profissionais
  cargo: z.string().min(2, 'Cargo é obrigatório'),
  departamento: z.string().min(2, 'Departamento é obrigatório'),
  role: z.enum(['Admin', 'Gerente', 'Colaborador'], {
    required_error: 'Selecione o nível de acesso',
  }),
  data_admissao: z.date({ required_error: 'Data de admissão é obrigatória' }),
  salario: z.coerce.number().min(1, 'Salário deve ser maior que 0'),
  tipo_contrato: z.string({ required_error: 'Tipo de contrato é obrigatório' }),
  status: z.string().default('Ativo'),
})

export type EmployeeFormValues = z.infer<typeof employeeSchema>
