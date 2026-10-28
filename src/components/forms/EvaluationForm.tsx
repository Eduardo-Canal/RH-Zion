import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, ChevronsUpDown } from 'lucide-react'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { StarRating } from '@/components/ui/star-rating'
import {
  evaluationSchema,
  type EvaluationFormValues,
} from './evaluation-schema'
import { cn } from '@/lib/utils'

interface EmployeeOption {
  id: string
  nome: string
}

interface EvaluationFormProps {
  employees: EmployeeOption[]
  onSubmit: (data: EvaluationFormValues) => void
  onCancel: () => void
  isLoading?: boolean
}

export function EvaluationForm({
  employees,
  onSubmit,
  onCancel,
  isLoading,
}: EvaluationFormProps) {
  const form = useForm<EvaluationFormValues>({
    resolver: zodResolver(evaluationSchema),
    defaultValues: {
      periodo: '',
      notaPontualidade: 3,
      notaQualidade: 3,
      notaTrabalhoEquipe: 3,
      observacoes: '',
    },
  })

  // Popover states
  const [openColaborador, setOpenColaborador] = useState(false)
  const [openAvaliador, setOpenAvaliador] = useState(false)

  const RatingField = ({ name, label }: { name: any; label: string }) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-3">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <StarRating
              value={field.value}
              onChange={field.onChange}
              className="mt-1"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="colaboradorId"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Colaborador (Avaliado)</FormLabel>
                <Popover
                  open={openColaborador}
                  onOpenChange={setOpenColaborador}
                >
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          'w-full justify-between',
                          !field.value && 'text-muted-foreground',
                        )}
                      >
                        {field.value
                          ? employees.find((e) => e.id === field.value)?.nome
                          : 'Selecione o colaborador'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar colaborador..." />
                      <CommandList>
                        <CommandEmpty>
                          Nenhum colaborador encontrado.
                        </CommandEmpty>
                        <CommandGroup>
                          {employees.map((employee) => (
                            <CommandItem
                              key={employee.id}
                              value={employee.nome}
                              onSelect={() => {
                                form.setValue('colaboradorId', employee.id)
                                setOpenColaborador(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  employee.id === field.value
                                    ? 'opacity-100'
                                    : 'opacity-0',
                                )}
                              />
                              {employee.nome}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="avaliadorId"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Avaliador</FormLabel>
                <Popover open={openAvaliador} onOpenChange={setOpenAvaliador}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          'w-full justify-between',
                          !field.value && 'text-muted-foreground',
                        )}
                      >
                        {field.value
                          ? employees.find((e) => e.id === field.value)?.nome
                          : 'Selecione o avaliador'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar avaliador..." />
                      <CommandList>
                        <CommandEmpty>
                          Nenhum colaborador encontrado.
                        </CommandEmpty>
                        <CommandGroup>
                          {employees.map((employee) => (
                            <CommandItem
                              key={employee.id}
                              value={employee.nome}
                              onSelect={() => {
                                form.setValue('avaliadorId', employee.id)
                                setOpenAvaliador(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  employee.id === field.value
                                    ? 'opacity-100'
                                    : 'opacity-0',
                                )}
                              />
                              {employee.nome}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="periodo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Período (Ex: Q1 2024, Janeiro 2024)</FormLabel>
              <FormControl>
                <Input placeholder="Período da avaliação" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 border rounded-lg bg-muted/10">
          <RatingField name="notaPontualidade" label="Pontualidade" />
          <RatingField name="notaQualidade" label="Qualidade" />
          <RatingField name="notaTrabalhoEquipe" label="Trabalho em Equipe" />
        </div>

        <FormField
          control={form.control}
          name="observacoes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Observações</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Comentários adicionais sobre o desempenho..."
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <span className="animate-spin mr-2">⏳</span>}
            Salvar Avaliação
          </Button>
        </div>
      </form>
    </Form>
  )
}
