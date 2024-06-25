import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'
import { DEFAULT_TIMEZONE } from '../../user/entities/user.entity'

export enum TimeBucketType {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
  MONTH = 'month',
  YEAR = 'year',
}

export enum ChartRenderMode {
  PERIODICAL = 'periodical',
  CUMULATIVE = 'cumulative',
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export class AnalyticsGET_DTO {
  @ApiProperty()
  @IsNotEmpty()
  pid: string

  @ApiProperty()
  period: string

  @ApiProperty({ enum: TimeBucketType })
  @IsNotEmpty()
  timeBucket: TimeBucketType

  @ApiProperty()
  from: string

  @ApiProperty()
  to: string

  @ApiProperty({
    description:
      'A stringified array of properties to filter [{ column, filter, isExclusive }]',
  })
  filters: string

  @ApiProperty({
    description: 'Timezone to display data in',
    default: DEFAULT_TIMEZONE,
  })
  timezone: string

  @ApiProperty({
    description:
      'Mode in which data in chart should be rendered, may be either periodical or cumulative',
    default: ChartRenderMode.PERIODICAL,
  })
  mode?: ChartRenderMode

  @ApiProperty({ description: 'The id of the view' })
  @IsUUID('4')
  @IsString()
  @IsOptional()
  viewId: string
}
