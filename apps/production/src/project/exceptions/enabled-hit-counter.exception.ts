import { ConflictException } from '@nestjs/common'

export class EnabledHitCounterException extends ConflictException {
  constructor() {
    super('The hit counter is enabled.')
  }
}
