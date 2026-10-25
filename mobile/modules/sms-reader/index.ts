import { requireNativeModule } from 'expo';

export type Sms = { id: string; address: string; body: string; date: number };

const SmsReader = requireNativeModule('SmsReader');

export function getInbox(limit = 3000, sinceMs = 0): Promise<Sms[]> {
  return SmsReader.getInbox(limit, sinceMs);
}
