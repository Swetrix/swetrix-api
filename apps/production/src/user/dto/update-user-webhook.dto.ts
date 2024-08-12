import { IsString, IsUrl, IsOptional } from 'class-validator'

export class UpdateUserWebhookDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsUrl()
  url?: string
}
