// Sudanese mobile numbers, required for every account and driver (for SMS later: one-time codes
// and notifications). Stored in the international form, e.g. "+249912345678".

const COUNTRY_CODE = '249'
// The 9 digits after the country code: mobile numbers start with 9 (Zain, MTN) or 1 (Sudani)
const NATIONAL_NUMBER = /^[19][0-9]{8}$/

// Accepts the ways people write a number: "0912345678", "912345678", "+249912345678",
// "00249912345678" or "249912345678", with spaces, dashes, dots or brackets. Null if it isn't a
// Sudanese mobile number.
export function normalizeSudanPhone(value: string): string | null {
  let digits = value.trim().replace(/[\s\-.()]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (!/^[0-9]+$/.test(digits)) return null
  if (digits.startsWith(`00${COUNTRY_CODE}`)) digits = digits.slice(2 + COUNTRY_CODE.length)
  else if (digits.startsWith(COUNTRY_CODE) && digits.length === COUNTRY_CODE.length + 9) {
    digits = digits.slice(COUNTRY_CODE.length)
  } else if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1)
  return NATIONAL_NUMBER.test(digits) ? `+${COUNTRY_CODE}${digits}` : null
}

// "+249912345678" → "+249 91 234 5678"; anything else is shown as stored
export function formatSudanPhone(phone: string): string {
  const match = /^\+249([0-9]{2})([0-9]{3})([0-9]{4})$/.exec(phone)
  return match ? `+249 ${match[1]} ${match[2]} ${match[3]}` : phone
}
