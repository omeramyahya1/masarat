import type { TFunction } from 'i18next'
import { tripCargoTypes, type TripReferenceData } from '@masarat/shared/fleet'
import type { CertificateRecord, PaymentRecord, TripDetails } from '@masarat/shared/billing'
import type { Formatters } from '../../lib/format'
import { documentFrame } from './documentFrame'
import { DocumentSheet, Field, Latin, Section } from './documentParts'

interface ReceiptPageProps {
  details: TripDetails
  payment: PaymentRecord
  certificate: CertificateRecord
  reference: TripReferenceData
  // Arabic translations and formatters: the document is always in Arabic
  ar: TFunction
  fa: Formatters
}

// The electronic payment receipt (إيصال سداد إلكتروني) for the trip's taxes and fees
function ReceiptPage({
  details,
  payment,
  certificate,
  reference,
  ar,
  fa
}: ReceiptPageProps): React.JSX.Element {
  const { trip, vehicleCapacity } = details
  const city = (id: number): string => fa.city(reference.cities.find((c) => c.id === id))

  return (
    <DocumentSheet
      frame={documentFrame('receipt', certificate, ar, fa)}
      pageLabel={ar('certificate.page', { page: fa.number(1), count: fa.number(1) })}
    >
      <Section title={ar('certificate.sections.vehicle')}>
        <Field label={ar('certificate.fields.plate')}>{fa.plate(trip.plateNumber)}</Field>
        <Field label={ar('certificate.fields.vehicleType')}>
          {ar(`vehicleTypes.${trip.vehicleType}`)}
        </Field>
        <Field label={ar('certificate.fields.capacity')}>
          {fa.quantity(vehicleCapacity, trip.cargoUnit)}
        </Field>
      </Section>

      <Section title={ar('certificate.sections.trip')}>
        <Field label={ar('certificate.fields.manifestNo')}>
          <Latin>{certificate.manifestNo}</Latin>
        </Field>
        <Field label={ar('certificate.fields.departureAt')}>{fa.dateTime(trip.departureAt)}</Field>
        <Field label={ar('certificate.fields.origin')}>{city(trip.originCityId)}</Field>
        <Field label={ar('certificate.fields.destination')}>{city(trip.destinationCityId)}</Field>
        {trip.category === 'passenger' ? (
          <>
            <Field label={ar('certificate.passengers.ticketPrice')}>
              {trip.ticketPrice !== null ? fa.currency(trip.ticketPrice) : '—'}
            </Field>
            <Field label={ar('trips.tax.tickets')}>{fa.number(trip.cargoQuantity)}</Field>
          </>
        ) : (
          <>
            <Field label={ar('certificate.fields.cargoType')}>
              {fa.list(tripCargoTypes(trip).map((c) => ar(`cargoTypes.${c}`)))}
            </Field>
            <Field label={ar('certificate.fields.quantity')}>
              {fa.quantity(trip.cargoQuantity, trip.cargoUnit)}
            </Field>
          </>
        )}
        <Field label={ar('certificate.fields.distance')}>
          {ar('units.km', { value: fa.number(trip.distanceKm) })}
        </Field>
      </Section>

      <Section title={ar('certificate.sections.tax')}>
        <Field label={ar('certificate.fields.tripCost')} wide>
          {fa.currency(trip.tripCost)}
        </Field>
        {trip.taxes.map((line) => (
          <Field key={line.code} wide label={fa.taxLine(line)}>
            {fa.currency(line.amount)}
          </Field>
        ))}
        <Field label={ar('certificate.fields.taxAmount')} wide>
          {fa.currency(payment.amount)}
        </Field>
        <Field label={ar('certificate.fields.paymentStatus')}>
          <span className="text-brand-700">{ar('certificate.paid')}</span>
        </Field>
        <Field label={ar('certificate.fields.billId')}>
          <Latin>{payment.billId}</Latin>
        </Field>
        {payment.paidAt && (
          <Field label={ar('certificate.fields.paidAt')}>{fa.dateTime(payment.paidAt)}</Field>
        )}
        {payment.paymentRef && (
          <Field label={ar('certificate.fields.paymentRef')}>
            <Latin>{payment.paymentRef}</Latin>
          </Field>
        )}
        <Field label={ar('certificate.fields.validUntil')}>{fa.date(certificate.validUntil)}</Field>
      </Section>
    </DocumentSheet>
  )
}

export default ReceiptPage
