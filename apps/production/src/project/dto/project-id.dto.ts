import { ApiProperty } from '@nestjs/swagger'
import { Matches, IsNotEmpty } from 'class-validator'

const PROJECT_ID_REGEX = /^(?!.*--)[a-zA-Z0-9-]{12}$/

export class ProjectIdDto {
  @ApiProperty()
  @Matches(PROJECT_ID_REGEX)
  @IsNotEmpty()
  readonly projectId: string
}
