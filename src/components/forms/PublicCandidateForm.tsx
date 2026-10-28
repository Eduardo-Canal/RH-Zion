import { useState } from 'react'
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
import { Loader2, UploadCloud, FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const formSchema = z.object({
  name: z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('Email inválido'),
  phone: z.string().optional(),
})

export type PublicCandidateFormValues = z.infer<typeof formSchema>

interface PublicCandidateFormProps {
  onSubmit: (data: PublicCandidateFormValues, file: File) => Promise<void>
  isLoading?: boolean
}

export function PublicCandidateForm({
  onSubmit,
  isLoading = false,
}: PublicCandidateFormProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const form = useForm<PublicCandidateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    validateAndSetFile(selectedFile)
  }

  const validateAndSetFile = (selectedFile: File | undefined) => {
    setFileError(null)

    if (selectedFile) {
      if (
        ![
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ].includes(selectedFile.type)
      ) {
        setFileError('Apenas arquivos PDF, DOC ou DOCX são permitidos.')
        setFile(null)
        return
      }
      if (selectedFile.size > 5 * 1024 * 1024) {
        setFileError('O arquivo deve ter no máximo 5MB.')
        setFile(null)
        return
      }
      setFile(selectedFile)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files?.[0]
    validateAndSetFile(droppedFile)
  }

  const handleSubmit = async (data: PublicCandidateFormValues) => {
    if (!file) {
      setFileError('O currículo é obrigatório.')
      return
    }

    await onSubmit(data, file)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-ink/80 font-medium">
                Nome Completo *
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Seu nome"
                  {...field}
                  className="rounded-xl border-ink/10 bg-cream/30 focus:bg-white transition-all h-12"
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
              <FormLabel className="text-ink/80 font-medium">Email *</FormLabel>
              <FormControl>
                <Input
                  placeholder="seu@email.com"
                  {...field}
                  className="rounded-xl border-ink/10 bg-cream/30 focus:bg-white transition-all h-12"
                />
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
              <FormLabel className="text-ink/80 font-medium">
                Telefone (Opcional)
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="(00) 00000-0000"
                  {...field}
                  className="rounded-xl border-ink/10 bg-cream/30 focus:bg-white transition-all h-12"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2 pt-2">
          <FormLabel
            className={cn(
              'text-ink/80 font-medium',
              fileError && 'text-destructive',
            )}
          >
            Currículo (PDF, DOC, DOCX) *
          </FormLabel>

          {!file ? (
            <div
              className={cn(
                'border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 group',
                isDragging
                  ? 'border-salmon bg-salmon/5'
                  : 'border-ink/10 hover:border-salmon/50 hover:bg-cream/50',
                fileError && 'border-destructive/50 bg-destructive/5',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('cv-upload')?.click()}
            >
              <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-3 text-ink/40 group-hover:text-salmon transition-colors">
                <UploadCloud className="h-5 w-5" />
              </div>
              <p className="text-sm text-ink/60 font-medium">
                Clique para enviar ou arraste aqui
              </p>
              <p className="text-xs text-ink/40 mt-1">Máximo 5MB</p>
              <Input
                id="cv-upload"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-white border border-ink/10 rounded-xl shadow-sm">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 bg-sage/20 rounded-lg flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-green-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-ink/40">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-ink/40 hover:text-destructive shrink-0"
                onClick={() => setFile(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {fileError && (
            <p className="text-sm font-medium text-destructive mt-1">
              {fileError}
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full rounded-full h-14 text-base font-medium bg-ink text-cream hover:bg-salmon hover:text-ink transition-all mt-4 shadow-lg hover:shadow-xl"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Enviando...
            </>
          ) : (
            'Confirmar Candidatura'
          )}
        </Button>
      </form>
    </Form>
  )
}
