import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  max?: number
  value?: number
  onChange?: (value: number) => void
  readOnly?: boolean
  className?: string
}

export function StarRating({
  max = 5,
  value = 0,
  onChange,
  readOnly = false,
  className,
}: StarRatingProps) {
  const [hoverValue, setHoverValue] = React.useState<number | null>(null)

  const handleMouseEnter = (index: number) => {
    if (!readOnly) {
      setHoverValue(index)
    }
  }

  const handleMouseLeave = () => {
    if (!readOnly) {
      setHoverValue(null)
    }
  }

  const handleClick = (index: number) => {
    if (!readOnly && onChange) {
      onChange(index)
    }
  }

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      onMouseLeave={handleMouseLeave}
    >
      {Array.from({ length: max }).map((_, i) => {
        const index = i + 1
        const isFilled =
          hoverValue !== null ? index <= hoverValue : index <= value

        return (
          <Star
            key={index}
            className={cn(
              'h-5 w-5 transition-all duration-200',
              readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110',
              isFilled
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-transparent text-muted-foreground/30',
            )}
            onClick={() => handleClick(index)}
            onMouseEnter={() => handleMouseEnter(index)}
          />
        )
      })}
    </div>
  )
}
