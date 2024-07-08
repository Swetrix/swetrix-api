import { ApiProperty } from '@nestjs/swagger'
import { Matches, IsString, IsNotEmpty } from 'class-validator'

export class ProjectIdParamsDto {
  @ApiProperty()
  @Matches(/^(?!.*--)[a-zA-Z0-9-]{12}$/, {
    message: 'Incorrect project ID format.',
  })
  @IsString()
  @IsNotEmpty()
  public readonly projectId: string
}
