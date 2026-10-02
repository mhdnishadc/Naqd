// All amounts are integer halalas (1 SAR = 100 halalas). Never use floats for stored money.
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** "1,250.50", "١٢٥٠٫٥" -> 125050. Returns null if not a valid positive-or-zero amount. */
export function parseAmount(input: string): number | null {
  let s = (input || '').trim()
  if (!s) return null
  s = s.replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/[٬,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2))
}

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt = (halalas: number | null | undefined) => nf.format((halalas ?? 0) / 100)

/** Plain "1250.50" for CSV / editing */
export const plain = (halalas: number) => (halalas / 100).toFixed(2)

export const todayISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
export const monthISO = (d = new Date()) => todayISO().slice(0, 7) // yyyy-mm for <input type=month>
export const monthStart = (ym: string) => `${ym}-01`
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
export const uuid = () => crypto.randomUUID()
