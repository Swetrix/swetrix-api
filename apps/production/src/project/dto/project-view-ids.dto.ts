import { IntersectionType } from '@nestjs/swagger'
import { ProjectIdDto } from './project-id.dto'
import { ProjectViewIdDto } from './project-view-id.dto'

export class ProjectViewIdsDto extends IntersectionType(
  ProjectIdDto,
  ProjectViewIdDto,
) {}
