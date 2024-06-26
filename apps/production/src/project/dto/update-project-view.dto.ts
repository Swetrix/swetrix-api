import { PartialType, OmitType } from '@nestjs/swagger'
import { CreateProjectViewDto } from './create-project-view.dto'

export class UpdateProjectViewDto extends PartialType(
  OmitType(CreateProjectViewDto, ['type', 'customEvents'] as const),
) {}
