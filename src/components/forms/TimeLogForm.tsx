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
import { DatePicker } from '@/components/ui/date-picker'
import { useEffect } from 'react'

const formSchema = z.object({
  employee: z.string().min(1, 'Colaborador obrigatório'),
  date: z.date({ required_error: 'Data obrigatória' }),
  entry: z.string().min(1, 'Hora de entrada obrigatória'),
  exit: z.string().min(1, 'Hora de saída obrigatória'),
})

export type TimeLogFormValues = z.infer<typeof formSchema>

interface TimeLogFormProps {
  initialData?: TimeLogFormValues | null
  employeesList: { id: string; name: string }[]
  onSubmit: (data: TimeLogFormValues) => void
  onCancel: () => void
}

export function TimeLogForm({
  initialData,
  employeesList,
  onSubmit,
  onCancel,
}: TimeLogFormProps) {
  const form = useForm<TimeLogFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      employee: '',
      entry: '09:00',
      exit: '18:00',
    },
  })

  useEffect(() => {
    if (initialData) {
      form.reset({
        ...initialData,
        date: new Date(initialData.date),
      })
    }
  }, [initialData, form])

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="employee"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Colaborador</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {employeesList.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
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
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Data</FormLabel>
              <DatePicker date={field.value} setDate={field.onChange} />
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="entry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Entrada</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="exit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Saída</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit">Salvar</Button>
        </div>
      </form>
    </Form>
  )
}
