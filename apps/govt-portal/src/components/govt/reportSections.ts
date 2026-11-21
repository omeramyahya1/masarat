// The parts of the dashboard a PDF report can include
export const REPORT_SECTIONS = ['kpis', 'chart', 'cargo', 'tax', 'breakdown', 'progress'] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]
