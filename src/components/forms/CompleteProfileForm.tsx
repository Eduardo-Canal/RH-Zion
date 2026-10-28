import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import { DatePicker } from '@/components/ui/date-picker'
import {
  completeProfileSchema,
  type CompleteProfileFormValues,
} from './complete-profile-schema'
import { Loader2, User, Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CompleteProfileFormProps {
  defaultEmail: string
  onSubmit: (data: CompleteProfileFormValues) => void
  isLoading?: boolean
}

export function CompleteProfileForm({
  defaultEmail,
  onSubmit,
  isLoading,
}: CompleteProfileFormProps) {
  const form = useForm<CompleteProfileFormValues>({
    resolver: zodResolver(completeProfileSchema),
    defaultValues: {
      name: '',
      email: defaultEmail,
      cpf: '',
      phone: '',
      address: '',
      image_gender: 'male',
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Personal Info Section */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-8 w-8 rounded-full bg-salmon/20 flex items-center justify-center text-salmon">
              <User className="h-4 w-4" />
            </div>
            <h3 className="text-lg font-instrument text-ink">
              Informações Pessoais
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                    Nome Completo
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Seu nome completo"
                      {...field}
                      className="bg-cream/50 border-ink/10 h-11 focus:border-salmon/50 focus:ring-salmon/20 rounded-xl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                    Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled
                      className="bg-ink/5 border-ink/5 text-ink/60 h-11 rounded-xl cursor-not-allowed"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="cpf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                    CPF
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="000.000.000-00"
                      {...field}
                      className="bg-cream/50 border-ink/10 h-11 focus:border-salmon/50 focus:ring-salmon/20 rounded-xl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="birthDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                    Data de Nascimento
                  </FormLabel>
                  <DatePicker
                    date={field.value}
                    setDate={field.onChange}
                    className="bg-cream/50 border-ink/10 h-11 focus:border-salmon/50 focus:ring-salmon/20 rounded-xl w-full"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                    Telefone
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="(00) 00000-0000"
                      {...field}
                      className="bg-cream/50 border-ink/10 h-11 focus:border-salmon/50 focus:ring-salmon/20 rounded-xl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                    Endereço Completo
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Rua, Número, Bairro, Cidade - UF"
                      {...field}
                      className="bg-cream/50 border-ink/10 h-11 focus:border-salmon/50 focus:ring-salmon/20 rounded-xl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Avatar Section */}
        <div className="space-y-4 pt-4 border-t border-ink/5">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-full bg-periwinkle/20 flex items-center justify-center text-blue-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <h3 className="text-lg font-instrument text-ink">Personalização</h3>
          </div>

          <FormField
            control={form.control}
            name="image_gender"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel className="text-xs uppercase tracking-wider font-bold text-ink/50">
                  Estilo do Avatar
                </FormLabel>
                <div className="grid grid-cols-2 gap-4">
                  {['male', 'female'].map((gender) => (
                    <div
                      key={gender}
                      onClick={() => field.onChange(gender)}
                      className={cn(
                        'relative flex flex-col items-center gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-all duration-300 hover:shadow-md',
                        field.value === gender
                          ? 'border-salmon bg-salmon/5'
                          : 'border-ink/5 bg-white hover:border-ink/20',
                      )}
                    >
                      <div className="relative h-16 w-16 rounded-full overflow-hidden border border-ink/10">
                        <img
                          src={`https://img.usecurling.com/ppl/thumbnail?gender=${gender}&seed=profile`}
                          alt={gender}
                          className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500"
                        />
                        {field.value === gender && (
                          <div className="absolute inset-0 bg-salmon/20 flex items-center justify-center">
                            <Check className="text-white drop-shadow-md w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <span className="text-sm font-medium capitalize text-ink/80">
                        {gender === 'male' ? 'Masculino' : 'Feminino'}
                      </span>
                    </div>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="pt-4">
          <Button
            type="submit"
            className="w-full h-12 rounded-full bg-ink text-cream hover:bg-salmon hover:text-ink transition-all duration-300 font-medium text-base shadow-lg hover:shadow-xl"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : null}
            Finalizar Cadastro
          </Button>
        </div>
      </form>
    </Form>
  )
}
