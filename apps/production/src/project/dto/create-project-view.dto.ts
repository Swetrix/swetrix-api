import { ApiProperty } from '@nestjs/swagger'
import { ProjectViewType } from '../entity/project-view.entity'

export class CreateProjectViewDto {
  @ApiProperty()
  name: string

  @ApiProperty({ description: 'Type of the view', enum: ProjectViewType })
  type: ProjectViewType

  @ApiProperty({ description: 'Page the user viewed (/hello)', nullable: true })
  pg: string | null

  @ApiProperty({ description: 'Name of the custom event (e.g., sign_up)' })
  ev: string

  @ApiProperty({
    description: 'User device (mobile, desktop, tablet, etc.)',
    nullable: true,
  })
  dv: string | null

  @ApiProperty({ description: 'Browser', nullable: true })
  br: string | null

  @ApiProperty({ description: 'Operating system', nullable: true })
  os: string | null

  @ApiProperty({ description: 'Locale (en-UK, en-US)', nullable: true })
  lc: string | null

  @ApiProperty({
    description:
      'Referrer (site from which the user came to the site using Swetrix)',
    nullable: true,
  })
  ref: string | null

  @ApiProperty({ description: 'UTM source', nullable: true })
  so: string | null

  @ApiProperty({ description: 'UTM medium', nullable: true })
  me: string | null

  @ApiProperty({ description: 'UTM campaign', nullable: true })
  ca: string | null

  @ApiProperty({ description: 'Country code', nullable: true })
  cc: string

  @ApiProperty({ description: 'Region/state (Alabama, etc.)', nullable: true })
  rg: string | null

  @ApiProperty({ description: 'City (Berlin, London, etc.)', nullable: true })
  ct: string | null
}
