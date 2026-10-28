import { useUserRole } from '@/hooks/use-user-role'
import { CollaboratorVacationView } from '@/components/vacations/CollaboratorVacationView'
import { ManagerVacationView } from '@/components/vacations/ManagerVacationView'

export default function Ferias() {
  const { isEmployee, isAdmin, isManager, loading } = useUserRole()

  if (loading) return null

  return (
    <div className="min-h-screen bg-cream font-sans text-ink pb-12">
      <nav className="sticky top-0 left-0 w-full z-40 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none bg-cream/5 backdrop-blur-sm md:bg-transparent">
        <div className="pointer-events-auto">
          <span className="text-xl font-medium tracking-tight font-instrument">
            Férias & Ausências.
          </span>
        </div>
      </nav>

      <div className="px-4 md:px-6 lg:px-8 pt-6 max-w-[1600px] mx-auto animate-fade-in">
        {isEmployee && <CollaboratorVacationView />}
        {(isAdmin || isManager) && <ManagerVacationView />}
      </div>
    </div>
  )
}
