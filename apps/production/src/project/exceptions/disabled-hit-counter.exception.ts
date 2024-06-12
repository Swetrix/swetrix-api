import { ConflictException } from '@nestjs/common'

export class DisabledHitCounterException extends ConflictException {
  constructor() {
    super('The hit counter is disabled.')
  }
}
