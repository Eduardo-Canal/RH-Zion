import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEffect } from 'react'
import { Job } from '@/services/jobs'

const formSchema = z.object({
  titulo: z.string().min(2, 'Título obrigatório'),
  descricao: z.string().optional(),
  departamento: z.string().min(2, 'Departamento obrigatório'),
  requisitos: z.string().optional(),
  salario: z.coerce.number().min(0, 'Salário deve ser positivo'),
  tipo_contrato: z.string().min(1, 'Selecione o tipo de contrato'),
  status: z.enum(['Aberta', 'Fechada']),
})

export type JobFormValues = z.infer<typeof formSchema>

interface JobFormProps {
  initialData?: Job | null
  onSubmit: (data: JobFormValues) => void
  onCancel: () => void
}

export function JobForm({ initialData, onSubmit, onCancel }: JobFormProps) {
  const form = useForm<JobFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      titulo: '',
      descricao: '',
      departamento: '',
      requisitos: '',
      salario: 0,
      tipo_contrato: '',
      status: 'Aberta',
    },
  })

  useEffect(() => {
    if (initialData) {
      form.reset({
        titulo: initialData.titulo,
        descricao: initialData.descricao || '',
        departamento: initialData.departamento,
        requisitos: initialData.requisitos || '',
        salario: initialData.salario,
        tipo_contrato: initialData.tipo_contrato,
        status: initialData.status,
      })
    }
  }, [initialData, form])

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="titulo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Título da Vaga</FormLabel>
              <FormControl>
                <Input placeholder="Ex: Desenvolvedor Frontend" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="departamento"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Departamento</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Tecnologia" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="salario"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Salário (R$)</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="tipo_contrato"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo de Contrato</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="CLT">CLT</SelectItem>
                    <SelectItem value="PJ">PJ</SelectItem>
                    <SelectItem value="Estágio">Estágio</SelectItem>
                    <SelectItem value="Temporário">Temporário</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Aberta">Aberta</SelectItem>
                    <SelectItem value="Fechada">Fechada</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="descricao"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descrição</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Descreva as responsabilidades..."
                  className="resize-none h-20"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="requisitos"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Requisitos</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Liste os requisitos..."
                  className="resize-none h-20"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit">Salvar Vaga</Button>
        </div>
      </form>
    </Form>
  )
}
