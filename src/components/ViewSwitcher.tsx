import { LayoutGrid, Table as TableIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface ViewSwitcherProps {
  view: 'cards' | 'table'
  setView: (view: 'cards' | 'table') => void
}

export function ViewSwitcher({ view, setView }: ViewSwitcherProps) {
  return (
    <div className="bg-white/50 backdrop-blur-sm border border-ink/5 rounded-lg p-1 w-fit">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(v) => v && setView(v as 'cards' | 'table')}
      >
        <ToggleGroupItem
          value="cards"
          aria-label="Card View"
          className="data-[state=on]:bg-white data-[state=on]:shadow-sm data-[state=on]:text-ink text-ink/50"
        >
          <LayoutGrid className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="table"
          aria-label="Table View"
          className="data-[state=on]:bg-white data-[state=on]:shadow-sm data-[state=on]:text-ink text-ink/50"
        >
          <TableIcon className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}
