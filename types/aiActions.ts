export type ParsedActionType = 'CALL' | 'MEETING' | 'EMAIL' | 'TASK';

export interface ParsedAction {
  title: string;
  type: ParsedActionType;
  date?: string;
  contactName?: string;
  companyName?: string;
  /** 0-1 */
  confidence: number;
}
