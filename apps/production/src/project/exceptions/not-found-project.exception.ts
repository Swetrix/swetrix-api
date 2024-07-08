import { NotFoundException } from '@nestjs/common'

export class NotFoundProjectException extends NotFoundException {
  constructor() {
    super('Project not found.')
  }
}
