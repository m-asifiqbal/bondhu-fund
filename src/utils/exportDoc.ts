/** Description of a list / report for the shared PDF + Excel exporter (electron/exporter.ts builds the files). */
export interface ExportCol { header: string; kind?: 'text' | 'money' | 'int' | 'date' | 'pct'; width?: number }
/** v = raw value (numbers stay numbers in Excel, ISO dates become real dates); f = text shown in PDFs / for display. */
export interface ExportCell { v: any; f?: string }
export interface ExportSection { title?: string; columns: ExportCol[]; rows: ExportCell[][]; totals?: ExportCell[] }
export interface ExportDoc {
  orgName: string; title: string; subtitle?: string; lang?: 'en' | 'bn'; landscape?: boolean;
  meta?: Array<[string, string]>; summary?: Array<[string, string]>;
  sections: ExportSection[]; receiverName?: string; generatedOn: string;
}

export const cell = (v: any, f?: string): ExportCell => ({ v, f });
