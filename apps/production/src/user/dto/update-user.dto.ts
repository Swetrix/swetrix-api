import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator'
import { TimeFormat } from '../entities/user.entity'

export class UpdateUserProfileDTO {
  @ApiProperty({ example: 'you@example.com', required: true })
  @IsEmail()
  email: string

  @ApiProperty({ example: 'your_password123' })
  password: string

  @ApiProperty({ example: 'week' })
  reportFrequency: string

  @ApiProperty({ example: 'Europe/Kiev' })
  timezone: string

  @ApiProperty({ example: '1234567890' })
  telegramChatId: string | null

  @ApiProperty({ example: '24-hour', enum: TimeFormat })
  timeFormat: string

  @ApiProperty({ required: false, nullable: true })
  @Matches(
    /^https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,10}\/B[a-zA-Z0-9_]{8,10}\/[a-zA-Z0-9_]{24}$/,
    { message: 'Invalid Slack Webhook URL' },
  )
  @IsString()
  @IsOptional()
  slackWebhookUrl?: string | null

  @ApiProperty({ required: false, nullable: true })
  @Matches(/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/, {
    message: 'Invalid Discord Webhook URL',
  })
  @IsString()
  @IsOptional()
  discordWebhookUrl?: string | null
}
