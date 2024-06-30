import { ApiProperty, PickType } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'
import { AnalyticsGET_DTO } from './getData.dto'

export class GetCustomEventMetadata extends PickType(AnalyticsGET_DTO, [
  'pid',
  'period',
  'timeBucket',
  'from',
  'to',
  'filters',
  'timezone',
  'filters',
] as const) {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  event: string
}
