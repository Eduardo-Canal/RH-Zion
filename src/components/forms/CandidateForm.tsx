import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useEffect, useState } from 'react'
import { Candidate } from '@/services/recruitment'
import { getJobs, Job } from '@/services/jobs'
import { Loader2 } from 'lucide-react'

const formSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('Email inválido'),
  phone: z.string().min(8, 'Telefone inválido'),
  vaga_id: z.string().min(1, 'Vaga obrigatória'),
  status: z.enum(['Triagem', 'Entrevista', 'Aprovado', 'Reprovado']),
})

export type CandidateFormValues = z.infer<typeof formSchema>

interface CandidateFormProps {
  initialData?: Candidate | null
  onSubmit: (data: CandidateFormValues) => void
  onCancel: () => void
}

export function CandidateForm({
  initialData,
  onSubmit,
  onCancel,
}: CandidateFormProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)

  const form = useForm<CandidateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      vaga_id: '',
      status: 'Triagem',
    },
  })

  useEffect(() => {
    const fetchJobs = async () => {
      setLoadingJobs(true)
      try {
        const data = await getJobs()
        setJobs(
          data.filter(
            (j) => j.status === 'Aberta' || initialData?.vaga_id === j.id,
          ),
        )
      } catch (error) {
        console.error(error)
      } finally {
        setLoadingJobs(false)
      }
    }
    fetchJobs()
  }, [initialData])

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.nome_candidato,
        email: initialData.email || '',
        phone: initialData.telefone || '',
        vaga_id: initialData.vaga_id || '',
        status: (initialData.status as any) || 'Triagem',
      })
    }
  }, [initialData, form])

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do Candidato</FormLabel>
              <FormControl>
                <Input placeholder="Nome Completo" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="candidato@email.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input placeholder="(00) 00000-0000" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="vaga_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vaga</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={loadingJobs}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        loadingJobs ? 'Carregando vagas...' : 'Selecione a vaga'
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.titulo} ({job.departamento})
                    </SelectItem>
                  ))}
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
              <FormLabel>Etapa do Processo</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Triagem">Triagem</SelectItem>
                  <SelectItem value="Entrevista">Entrevista</SelectItem>
                  <SelectItem value="Aprovado">Aprovado</SelectItem>
                  <SelectItem value="Reprovado">Reprovado</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit">Salvar Candidato</Button>
        </div>
      </form>
    </Form>
  )
}
