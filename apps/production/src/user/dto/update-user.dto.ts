import { ApiProperty } from '@nestjs/swagger'
import { IsEmail } from 'class-validator'
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

  @ApiProperty({ example: '80' })
  planLimitNotificationPercentage: number
}
