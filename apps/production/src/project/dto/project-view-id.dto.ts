import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsUUID } from 'class-validator'

export class ProjectViewIdDto {
  @ApiProperty()
  @IsUUID('4')
  @IsNotEmpty()
  readonly viewId: string
}
