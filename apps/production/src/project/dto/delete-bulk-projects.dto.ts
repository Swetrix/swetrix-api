import { ApiProperty } from '@nestjs/swagger'
import {
  ArrayUnique,
  Matches,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
} from 'class-validator'

const PROJECT_ID_REGEX = /^(?!.*--)[a-zA-Z0-9-]{12}$/
const MAX_PROJECT_IDS_ARRAY_SIZE = 1000
const MIN_PROJECT_IDS_ARRAY_SIZE = 1

export class DeleteBulkProjectsDto {
  @ApiProperty({ type: [String] })
  @ArrayUnique()
  @Matches(PROJECT_ID_REGEX, { each: true })
  @ArrayMaxSize(MAX_PROJECT_IDS_ARRAY_SIZE)
  @ArrayMinSize(MIN_PROJECT_IDS_ARRAY_SIZE)
  @ArrayNotEmpty()
  @IsArray()
  public readonly projectIds: string[]
}
