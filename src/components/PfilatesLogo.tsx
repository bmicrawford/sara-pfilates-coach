import { PFILATES_BRAND, PFILATES_SITE } from '../lib/diary'
import { PFILATES_LOGO_SRC } from '../lib/diaryPdf'

export function PfilatesBrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? 'mb-4' : 'mb-6'}>
      <img
        src={PFILATES_LOGO_SRC}
        alt={PFILATES_BRAND}
        className={compact ? 'h-9 w-auto' : 'h-11 w-auto'}
      />
      <p className="mt-2 text-sm font-medium text-sage-deep">{PFILATES_SITE}</p>
    </header>
  )
}
