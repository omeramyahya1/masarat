// The cached lists and views both portals read (lib/query.ts). Each hook is one query: every
// component that needs the vehicles (the Vehicles section, the trips list's filters, the trip form,
// the templates) shares the same cached list instead of fetching its own.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- each hook's type is its API
   result's, which only inference spells out */
import { useQuery } from '@tanstack/react-query'
import { api, type MembersAPI } from '@masarat/api-client'
import { queryKeys, unwrap } from './query'

// Reference data (cities, states, rates, charges) changes rarely
const SLOW = 10 * 60_000

// --- Company portal ----------------------------------------------------------------------------

export const useReference = () =>
  useQuery({
    queryKey: queryKeys.reference,
    queryFn: () => unwrap(api.trips.getReferenceData()),
    staleTime: SLOW
  })

export const useVehicles = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.vehicles,
    queryFn: () => unwrap(api.fleet.listVehicles()),
    enabled
  })

export const useDrivers = (enabled = true) =>
  useQuery({ queryKey: queryKeys.drivers, queryFn: () => unwrap(api.fleet.listDrivers()), enabled })

export const useBranches = () =>
  useQuery({ queryKey: queryKeys.branches, queryFn: () => unwrap(api.company.branches()) })

export const useTemplates = (enabled = true) =>
  useQuery({ queryKey: queryKeys.templates, queryFn: () => unwrap(api.templates.list()), enabled })

export const useRoles = () =>
  useQuery({ queryKey: queryKeys.roles, queryFn: () => unwrap(api.company.roles()) })

export const useSuggestions = () =>
  useQuery({ queryKey: queryKeys.suggestions, queryFn: () => unwrap(api.trips.suggestions()) })

// --- Both: accounts ----------------------------------------------------------------------------

export const useMembers = (side: 'company' | 'govt', members: MembersAPI) =>
  useQuery({ queryKey: queryKeys.members(side), queryFn: () => unwrap(members.list()) })

export const useMemberRoles = (side: 'company' | 'govt', members: MembersAPI) =>
  useQuery({ queryKey: queryKeys.memberRoles(side), queryFn: () => unwrap(members.roles()) })

// --- Government portal -------------------------------------------------------------------------

export const useGovtReference = () =>
  useQuery({
    queryKey: queryKeys.govtReference,
    queryFn: () => unwrap(api.govt.getReferenceData()),
    staleTime: SLOW
  })

export const useCompanies = () =>
  useQuery({ queryKey: queryKeys.companies, queryFn: () => unwrap(api.govt.listCompanies()) })
