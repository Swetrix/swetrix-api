import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsUrl } from 'class-validator'

export class CreateUserWebhookDto {
  @ApiProperty({ example: 'Name of the webhook' })
  @IsString()
  name: string

  @ApiProperty({ example: 'Url of the webhook' })
  @IsUrl()
  url: string
}
