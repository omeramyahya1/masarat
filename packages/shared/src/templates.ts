// Saved passenger trips a company repeats: a route, a bus and its usual driver, the time of day it
// leaves and how long it takes, and the branch it's sold at. A new trip from a template only needs
// its date and passengers (templates.use; templates.manage to keep them).

export const MAX_TEMPLATE_NAME_LENGTH = 80
// Longest trip a template can describe
export const MAX_TEMPLATE_MINUTES = 3 * 24 * 60

export interface TemplateInput {
  name: string
  branchId: number
  originCityId: number
  destinationCityId: number
  // A bus of the company
  vehicleId: number
  driverId: number | null
  // HH:MM, Sudan time
  departureTime: string
  durationMinutes: number
}

export interface TemplateRecord extends TemplateInput {
  id: number
}

export const TIME_OF_DAY = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
