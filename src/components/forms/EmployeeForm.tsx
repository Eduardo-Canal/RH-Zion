import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Upload, X, FileText, User, Briefcase, FileCheck } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DatePicker } from '@/components/ui/date-picker'
import { employeeSchema, type EmployeeFormValues } from './employee-schema'

interface EmployeeFormProps {
  initialData?:
    | (Partial<EmployeeFormValues> & {
        id?: string
        documentos_urls?: { name: string; url: string; size: string }[]
      })
    | null
  onSubmit: (data: EmployeeFormValues, files: File[]) => void
  onCancel: () => void
  isLoading?: boolean
}

export function EmployeeForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading,
}: EmployeeFormProps) {
  const [files, setFiles] = useState<File[]>([])
  const [existingFiles, setExistingFiles] = useState<
    { name: string; url: string; size: string }[]
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      nome: '',
      cpf: '',
      rg: '',
      endereco: '',
      email: '',
      telefone: '',
      image_gender: 'male',
      cargo: '',
      departamento: '',
      role: 'Colaborador',
      salario: 0,
      tipo_contrato: 'CLT',
      status: 'Ativo',
      ...initialData,
    },
  })

  useEffect(() => {
    if (initialData) {
      const cleanData: any = { ...initialData }

      // Ensure dates are Date objects
      if (typeof cleanData.data_nascimento === 'string')
        cleanData.data_nascimento = new Date(cleanData.data_nascimento)
      if (typeof cleanData.data_admissao === 'string')
        cleanData.data_admissao = new Date(cleanData.data_admissao)

      form.reset(cleanData)

      if (initialData.documentos_urls) {
        setExistingFiles(initialData.documentos_urls)
      }
    }
  }, [initialData, form])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      setFiles((prev) => [...prev, ...newFiles])
    }
  }

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index))
  }

  const handleSubmit = (data: EmployeeFormValues) => {
    onSubmit(data, files)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Tabs defaultValue="personal" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-secondary/30 p-1 rounded-xl">
            <TabsTrigger
              value="personal"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <User className="w-4 h-4 mr-2" />
              Pessoal
            </TabsTrigger>
            <TabsTrigger
              value="professional"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <Briefcase className="w-4 h-4 mr-2" />
              Profissional
            </TabsTrigger>
            <TabsTrigger
              value="documents"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <FileCheck className="w-4 h-4 mr-2" />
              Documentos
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="personal"
            className="space-y-4 animate-fade-in-up duration-300"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem className="col-span-1 md:col-span-2">
                    <FormLabel>Nome Completo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ex: João da Silva"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPF</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="000.000.000-00"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RG</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="00.000.000-0"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="data_nascimento"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data de Nascimento</FormLabel>
                    <DatePicker
                      date={field.value}
                      setDate={field.onChange}
                      className="rounded-lg border-input/50 focus:ring-primary/20 w-full"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="image_gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gênero (Avatar)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="rounded-lg border-input/50 focus:ring-primary/20">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="male">Masculino</SelectItem>
                        <SelectItem value="female">Feminino</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="joao@empresa.com"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(00) 00000-0000"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endereco"
                render={({ field }) => (
                  <FormItem className="col-span-1 md:col-span-2">
                    <FormLabel>Endereço Completo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Rua, Número, Bairro, Cidade - UF"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="professional"
            className="space-y-4 animate-fade-in-up duration-300"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cargo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cargo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ex: Desenvolvedor"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="departamento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departamento</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ex: Tecnologia"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Papel no Sistema</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="rounded-lg border-input/50 focus:ring-primary/20">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Colaborador">Colaborador</SelectItem>
                        <SelectItem value="Gerente">Gerente</SelectItem>
                        <SelectItem value="Admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="data_admissao"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data de Admissão</FormLabel>
                    <DatePicker
                      date={field.value}
                      setDate={field.onChange}
                      className="rounded-lg border-input/50 focus:ring-primary/20 w-full"
                    />
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
                      <Input
                        type="number"
                        step="0.01"
                        className="rounded-lg border-input/50 focus:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tipo_contrato"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Contrato</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="rounded-lg border-input/50 focus:ring-primary/20">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="CLT">CLT</SelectItem>
                        <SelectItem value="PJ">PJ</SelectItem>
                        <SelectItem value="Estágio">Estágio</SelectItem>
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
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="rounded-lg border-input/50 focus:ring-primary/20">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Ativo">Ativo</SelectItem>
                        <SelectItem value="Férias">Férias</SelectItem>
                        <SelectItem value="Desligado">Desligado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="documents"
            className="space-y-4 animate-fade-in-up duration-300"
          >
            <div
              className="bg-secondary/10 border-2 border-dashed border-secondary/30 rounded-xl p-8 flex flex-col items-center justify-center text-center space-y-4 hover:bg-secondary/20 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="p-4 bg-white rounded-full shadow-sm">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-lg">Clique para fazer upload</p>
                <p className="text-sm text-muted-foreground">
                  PDF, PNG ou JPG até 5MB
                </p>
              </div>
              <Input
                type="file"
                className="hidden"
                id="file-upload"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".pdf,.png,.jpg,.jpeg"
                multiple
              />
            </div>

            <div className="space-y-3 mt-4">
              {existingFiles.map((file, i) => (
                <div
                  key={`existing-${i}`}
                  className="flex items-center justify-between p-4 border border-input/30 rounded-xl bg-white/50 backdrop-blur-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline hover:text-primary transition-colors"
                      >
                        {file.name}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {file.size}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {files.map((file, i) => (
                <div
                  key={`new-${i}`}
                  className="flex items-center justify-between p-4 border border-input/30 rounded-xl bg-white/50 backdrop-blur-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(i)}
                    className="hover:bg-destructive/10 hover:text-destructive rounded-full"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-3 pt-6 border-t border-border/50">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-xl h-11 border-input/50 hover:bg-secondary/50"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="rounded-xl h-11 px-6 bg-primary hover:bg-primary/90 shadow-md hover:shadow-lg transition-all"
          >
            {isLoading && <span className="animate-spin mr-2">⏳</span>}
            Salvar Colaborador
          </Button>
        </div>
      </form>
    </Form>
  )
}
