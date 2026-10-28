import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { format, differenceInDays } from 'date-fns'
import { DateRange } from 'react-day-picker'
import { Calendar, Send, History } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { DatePickerWithRange } from '@/components/ui/date-range-picker'
import { useToast } from '@/hooks/use-toast'
import {
  createVacation,
  getVacationsByEmployeeId,
  Vacation,
} from '@/services/vacations'
import { useUserRole } from '@/hooks/use-user-role'

const formSchema = z.object({
  dateRange: z.object(
    {
      from: z.date({ required_error: 'Data inicial é obrigatória' }),
      to: z.date({ required_error: 'Data final é obrigatória' }),
    },
    { required_error: 'Período é obrigatório' },
  ),
  observacoes: z.string().optional(),
})

type VacationFormValues = z.infer<typeof formSchema>

export function CollaboratorVacationView() {
  const { colaboradorId } = useUserRole()
  const { toast } = useToast()
  const [vacations, setVacations] = useState<Vacation[]>([])

  const form = useForm<VacationFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { observacoes: '' },
  })

  const fetchVacations = async () => {
    if (colaboradorId) {
      const data = await getVacationsByEmployeeId(colaboradorId)
      setVacations(data)
    }
  }

  useEffect(() => {
    fetchVacations()
  }, [colaboradorId])

  const onSubmit = async (data: VacationFormValues) => {
    if (!colaboradorId) return
    try {
      const { from, to } = data.dateRange
      await createVacation({
        colaborador_id: colaboradorId,
        data_inicio: format(from, 'yyyy-MM-dd'),
        data_fim: format(to, 'yyyy-MM-dd'),
        observacoes: data.observacoes,
      })
      toast({ title: 'Sucesso', description: 'Solicitação enviada.' })
      form.reset({ observacoes: '' })
      fetchVacations()
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Falha ao enviar.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-min">
      {/* Request Form */}
      <div className="col-span-1 md:col-span-7 bg-sage rounded-[24px] p-8 md:p-12 relative overflow-hidden group">
        <div className="relative z-10 mb-6">
          <h2 className="font-instrument text-4xl mb-2">Solicitar Férias</h2>
          <p className="text-ink/60 font-medium">
            Planeje seu descanso merecido.
          </p>
        </div>

        <div className="relative z-10 bg-white/40 backdrop-blur-sm p-6 rounded-2xl border border-white/20">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="dateRange"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="text-ink font-semibold">
                      Período Desejado
                    </FormLabel>
                    <DatePickerWithRange
                      date={field.value as DateRange}
                      setDate={field.onChange}
                      className="w-full"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="observacoes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-ink font-semibold">
                      Observações
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ex: Viagem marcada..."
                        className="bg-white/50 border-ink/10 focus:border-ink resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full h-12 rounded-xl bg-ink text-white hover:bg-salmon hover:text-ink text-lg font-medium transition-all"
              >
                <Send className="mr-2 h-5 w-5" /> Enviar Solicitação
              </Button>
            </form>
          </Form>
        </div>

        {/* Decor */}
        <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-white/20 rounded-full blur-3xl pointer-events-none group-hover:scale-125 transition-transform duration-700" />
      </div>

      {/* History List */}
      <div className="col-span-1 md:col-span-5 bg-cream border border-ink/5 rounded-[24px] p-8 flex flex-col h-[500px] md:h-auto overflow-hidden">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-periwinkle p-2 rounded-full">
            <History className="w-5 h-5 text-ink" />
          </div>
          <h2 className="font-instrument text-3xl">Minhas Solicitações</h2>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
          {vacations.length === 0 ? (
            <p className="text-ink/40 italic">Nenhuma solicitação ainda.</p>
          ) : (
            vacations.map((req) => {
              const days =
                differenceInDays(
                  new Date(req.data_fim),
                  new Date(req.data_inicio),
                ) + 1
              return (
                <div
                  key={req.id}
                  className="bg-white p-4 rounded-xl border border-ink/5 flex justify-between items-center group hover:border-ink/20 transition-all"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {format(new Date(req.data_inicio), 'dd/MM/yy')}
                      </span>
                      <span className="text-xs text-ink/40">até</span>
                      <span className="font-medium">
                        {format(new Date(req.data_fim), 'dd/MM/yy')}
                      </span>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                      {days} Dias
                    </span>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border
                                    ${req.status === 'Aprovada' ? 'bg-sage/20 border-sage text-ink' : ''}
                                    ${req.status === 'Reprovada' ? 'bg-salmon/20 border-salmon text-ink' : ''}
                                    ${req.status === 'Pendente' ? 'bg-periwinkle/20 border-periwinkle text-ink' : ''}
                                 `}
                  >
                    {req.status}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
