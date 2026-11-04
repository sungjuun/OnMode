import { BrowserMultiFormatOneDReader } from '@zxing/browser'
import { BarcodeFormat, ChecksumException, DecodeHintType, FormatException, NotFoundException } from '@zxing/library'

export const barcodeMiss = (error: unknown) => error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException

export function barcodeReader() {
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]], [DecodeHintType.TRY_HARDER, true],
  ])
  return new BrowserMultiFormatOneDReader(hints, { delayBetweenScanAttempts: 300, delayBetweenScanSuccess: 500, tryPlayVideoTimeout: 5000 })
}
